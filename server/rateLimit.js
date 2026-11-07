const { isIP } = require("node:net");
const { rateLimit, ipKeyGenerator, MemoryStore } = require("express-rate-limit");

const CLIENT_KEY = Symbol("rateLimitClient");
const COOLDOWNS = [60_000, 120_000, 240_000, 480_000, 900_000];
const STRIKE_RETENTION_MS = 60 * 60_000;
const MAX_COOLDOWNS = 10_000;

const DEFAULT_LIMITS = Object.freeze({
  globalBurst: { windowMs: 1_000, limit: 25 },
  globalMinute: { windowMs: 60_000, limit: 300 },
  burst: { windowMs: 10_000, limit: 10 },
  sustained: { windowMs: 60_000, limit: 60 },
  batches: { windowMs: 60_000, limit: 10 },
});

const sendRetry = (res, status, milliseconds, error = "Too many requests") => {
  const retryAfter = Math.max(1, Math.ceil(milliseconds / 1000));
  res.setHeader("Retry-After", String(retryAfter));
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ error, retryAfter });
};

const createRateProtection = ({
  render = process.env.RENDER === "true",
  limits = DEFAULT_LIMITS,
  now = () => Date.now(),
  maxCooldowns = MAX_COOLDOWNS,
} = {}) => {
  const cooldowns = new Map();
  const stores = [];

  const cleanup = setInterval(() => {
    const time = now();
    for (const [key, state] of cooldowns) {
      if (state.expiresAt <= time) cooldowns.delete(key);
    }
  }, 60_000);
  cleanup.unref();

  const identifyClient = (req, res, next) => {
    // Render public ingress is behind Cloudflare, which overwrites this header.
    // Outside Render, ignore forwarded headers and use the actual socket peer.
    const address = render
      ? req.headers["cf-connecting-ip"]
      : req.socket.remoteAddress;
    if (
      typeof address !== "string" ||
      address.length > 45 ||
      address.includes("%") ||
      !isIP(address)
    ) {
      return sendRetry(res, 503, 5_000, "Client address unavailable");
    }
    // Normalize IPv4-mapped addresses and group IPv6 addresses by /56.
    req[CLIENT_KEY] = ipKeyGenerator(address, 56);
    next();
  };

  const enforceCooldown = (req, res, next) => {
    const key = req[CLIENT_KEY];
    const state = cooldowns.get(key);
    const time = now();
    if (state && state.expiresAt <= time) {
      cooldowns.delete(key);
    } else if (state && state.blockedUntil > time) {
      // Retries during a cooldown neither extend it nor consume the global quota.
      return sendRetry(res, 429, state.blockedUntil - time);
    }
    next();
  };

  const makeLimiter = (name, global = false) => {
    const store = new MemoryStore();
    stores.push(store);
    const property = `rateLimit_${name}`;
    return rateLimit({
      ...limits[name],
      store,
      identifier: name,
      requestPropertyName: property,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      keyGenerator: global ? () => "global" : (req) => req[CLIENT_KEY],
      handler(req, res) {
        const time = now();
        const windowRemaining = req[property].resetTime.getTime() - time;
        if (global) return sendRetry(res, 429, windowRemaining);

        const key = req[CLIENT_KEY];
        let previous = cooldowns.get(key);
        if (previous && previous.expiresAt <= time) {
          cooldowns.delete(key);
          previous = undefined;
        }
        // Other requests may have passed the early check before this one blocked.
        if (previous && previous.blockedUntil > time) {
          return sendRetry(res, 429, previous.blockedUntil - time);
        }
        if (!previous && cooldowns.size >= maxCooldowns) {
          // Keep existing cooldowns intact and never grow memory without a bound.
          return sendRetry(res, 503, 60_000, "Server busy");
        }
        const strikes = Math.min((previous?.strikes || 0) + 1, COOLDOWNS.length);
        const wait = Math.max(COOLDOWNS[strikes - 1], windowRemaining);
        cooldowns.set(key, {
          strikes,
          blockedUntil: time + wait,
          expiresAt: time + STRIKE_RETENTION_MS,
        });
        return sendRetry(res, 429, wait);
      },
    });
  };

  // Admission limits precede per-client stores, bounding new identities per window.
  const globalBurst = makeLimiter("globalBurst", true);
  const globalMinute = makeLimiter("globalMinute", true);
  const burst = makeLimiter("burst");
  const sustained = makeLimiter("sustained");
  const batches = makeLimiter("batches");

  return {
    middleware: [identifyClient, enforceCooldown, globalBurst, globalMinute, burst, sustained],
    batches,
    shutdown() {
      clearInterval(cleanup);
      for (const store of stores) store.shutdown();
      cooldowns.clear();
    },
  };
};

module.exports = { createRateProtection, DEFAULT_LIMITS };
