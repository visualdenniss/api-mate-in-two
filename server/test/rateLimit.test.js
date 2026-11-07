const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const { test } = require("node:test");
const express = require("express");
const cors = require("cors");
const { createRateProtection, DEFAULT_LIMITS } = require("../rateLimit");
const { isValidPuzzleId } = require("../validation");

const CLIENT_A = "198.51.100.1";
const CLIENT_B = "203.0.113.2";
const CLIENT_C = "192.0.2.3";

async function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const protection = createRateProtection({
    render: true,
    ...options,
    limits: { ...DEFAULT_LIMITS, ...options.limits },
  });
  const app = express();
  let databaseCalls = 0;
  app.use(cors({ exposedHeaders: ["Retry-After", "RateLimit", "RateLimit-Policy"] }));
  app.use(protection.middleware);
  app.get("/", protection.batches, (req, res) => {
    databaseCalls++;
    res.json([]);
  });
  app.get("/:id", (req, res) => {
    if (!isValidPuzzleId(req.params.id)) return res.status(400).json({ error: "Invalid puzzle ID" });
    databaseCalls++;
    res.json({ id: req.params.id });
  });
  const server = http.createServer(app);
  t.after(async () => {
    protection.shutdown();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const request = (ip = CLIENT_A, path = "/123", { method = "GET", headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1", port: server.address().port, path, method, agent: false,
        headers: { ...(ip ? { "cf-connecting-ip": ip } : {}), ...headers },
      }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : undefined });
          } catch (error) {
            reject(error);
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(2000, () => req.destroy(new Error("Local test request timed out")));
      req.end();
    });
  const pipeline = (count) => new Promise((resolve, reject) => {
    let response = "";
    const socket = net.createConnection({ host: "127.0.0.1", port: server.address().port });
    socket.setEncoding("utf8");
    socket.setTimeout(2000, () => socket.destroy(new Error("Local pipeline test timed out")));
    socket.on("error", reject);
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("end", () => resolve(response));
    socket.on("connect", () => {
      let requests = "";
      for (let i = 0; i < count; i++) {
        requests += `GET /123 HTTP/1.1\r\nHost: localhost\r\nCF-Connecting-IP: ${CLIENT_A}\r\nConnection: ${i === count - 1 ? "close" : "keep-alive"}\r\n\r\n`;
      }
      socket.write(requests);
    });
  });
  return { request, pipeline, calls: () => databaseCalls };
}

test("burst overflow returns a readable 429 before database work and isolates clients", async (t) => {
  const app = await setup(t);
  for (let i = 0; i < 10; i++) assert.equal((await app.request()).status, 200);
  const blocked = await app.request();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers["retry-after"], "60");
  assert.equal(blocked.headers["cache-control"], "no-store");
  assert.deepEqual(blocked.body, { error: "Too many requests", retryAfter: 60 });
  assert.equal(blocked.headers["access-control-allow-origin"], "*");
  assert.match(blocked.headers["access-control-expose-headers"], /Retry-After/);
  assert.equal(app.calls(), 10);
  assert.equal((await app.request(CLIENT_B)).status, 200);
});

test("sustained quota stops traffic that stays below the burst quota", async (t) => {
  const app = await setup(t, { limits: {
    globalBurst: { windowMs: 1_000, limit: 1000 },
    burst: { windowMs: 10_000, limit: 1000 },
  } });
  for (let i = 0; i < 60; i++) assert.equal((await app.request()).status, 200);
  assert.equal((await app.request()).status, 429);
  assert.equal(app.calls(), 60);
});

test("simultaneous pipelined requests cannot turn one burst into multiple strikes", async (t) => {
  const app = await setup(t);
  const response = await app.pipeline(20);
  const statuses = [...response.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((match) => Number(match[1]));
  const waits = [...response.matchAll(/Retry-After: (\d+)/gi)].map((match) => Number(match[1]));
  assert.equal(statuses.length, 20);
  assert.ok(statuses.every((status) => status === 200 || status === 429));
  assert.ok(app.calls() <= 10);
  assert.ok(waits.length > 0);
  assert.ok(waits.every((wait) => wait === 60));
});

test("puzzle batches have their own stricter quota", async (t) => {
  const app = await setup(t, { limits: { burst: { windowMs: 10_000, limit: 100 } } });
  for (let i = 0; i < 10; i++) {
    const response = await app.request(CLIENT_A, "/");
    assert.equal(response.status, 200);
    assert.match(response.headers.ratelimit, /batches/);
  }
  assert.equal((await app.request(CLIENT_A, "/")).status, 429);
  assert.equal((await app.request(CLIENT_A, "/123")).status, 429);
  assert.equal(app.calls(), 10);
});

test("cooldowns escalate, stop at fifteen minutes, then decay after a quiet hour", async (t) => {
  const app = await setup(t, { limits: { burst: { windowMs: 10_000, limit: 1 } } });
  for (const seconds of [60, 120, 240, 480, 900, 900]) {
    assert.equal((await app.request()).status, 200);
    const blocked = await app.request();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.retryAfter, seconds);
    t.mock.timers.tick(seconds * 1000 + 1);
  }
  t.mock.timers.tick(60 * 60_000 + 1);
  assert.equal((await app.request()).status, 200);
  assert.equal((await app.request()).body.retryAfter, 60);
});

test("retries neither extend a cooldown nor use another client's global quota", async (t) => {
  const app = await setup(t, { limits: {
    burst: { windowMs: 10_000, limit: 1 },
    globalMinute: { windowMs: 60_000, limit: 3 },
  } });
  assert.equal((await app.request()).status, 200);
  assert.equal((await app.request()).status, 429);
  t.mock.timers.tick(30_000);
  for (let i = 0; i < 40; i++) {
    const response = await app.request();
    assert.equal(response.status, 429);
    assert.equal(response.body.retryAfter, 30);
  }
  assert.equal((await app.request(CLIENT_B)).status, 200);
  t.mock.timers.tick(30_001);
  assert.equal((await app.request()).status, 200);
});

test("global burst overload does not put an individual visitor in a cooldown", async (t) => {
  const app = await setup(t, { limits: { globalBurst: { windowMs: 1_000, limit: 2 } } });
  assert.equal((await app.request(CLIENT_A)).status, 200);
  assert.equal((await app.request(CLIENT_B)).status, 200);
  const blocked = await app.request(CLIENT_C);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.retryAfter, 1);
  t.mock.timers.tick(1001);
  assert.equal((await app.request(CLIENT_C)).status, 200);
});

test("global minute budget remains effective after the global burst window resets", async (t) => {
  const app = await setup(t, { limits: {
    globalBurst: { windowMs: 1_000, limit: 100 },
    globalMinute: { windowMs: 60_000, limit: 2 },
  } });
  assert.equal((await app.request(CLIENT_A)).status, 200);
  assert.equal((await app.request(CLIENT_B)).status, 200);
  t.mock.timers.tick(1001);
  assert.equal((await app.request(CLIENT_C)).status, 429);
  t.mock.timers.tick(59_000);
  assert.equal((await app.request(CLIENT_C)).status, 200);
});

test("outside Render, forged IP headers cannot change the socket client's quota", async (t) => {
  const app = await setup(t, { render: false, limits: { burst: { windowMs: 10_000, limit: 1 } } });
  assert.equal((await app.request(CLIENT_A, "/123", {
    headers: { "x-forwarded-for": CLIENT_A, "true-client-ip": CLIENT_A },
  })).status, 200);
  assert.equal((await app.request(CLIENT_B, "/123", {
    headers: { "x-forwarded-for": CLIENT_B, "true-client-ip": CLIENT_B },
  })).status, 429);
});

test("on Render, forged X-Forwarded-For values do not replace the edge address", async (t) => {
  const app = await setup(t, { limits: { burst: { windowMs: 10_000, limit: 1 } } });
  assert.equal((await app.request(CLIENT_A, "/123", { headers: { "x-forwarded-for": CLIENT_B } })).status, 200);
  assert.equal((await app.request(CLIENT_A, "/123", { headers: { "x-forwarded-for": CLIENT_C } })).status, 429);
});

test("IPv6 rotation inside a /56 and IPv4-mapped aliases cannot create fresh quotas", async (t) => {
  const app = await setup(t, { limits: { burst: { windowMs: 10_000, limit: 1 } } });
  assert.equal((await app.request("2001:db8:1234:5600::1")).status, 200);
  assert.equal((await app.request("2001:db8:1234:56ff::2")).status, 429);
  assert.equal((await app.request("2001:db8:1234:5700::1")).status, 200);
  assert.equal((await app.request(CLIENT_A)).status, 200);
  assert.equal((await app.request(`::ffff:${CLIENT_A}`)).status, 429);
});

test("missing or malformed trusted edge addresses fail before database work", async (t) => {
  const app = await setup(t);
  for (const address of [undefined, "invalid", "1".repeat(46), "fe80::1%eth0", `${CLIENT_A}, ${CLIENT_B}`]) {
    assert.equal((await app.request(address || null)).status, 503);
  }
  assert.equal(app.calls(), 0);
});

test("failed requests and HEAD requests count, while CORS preflights do not", async (t) => {
  const app = await setup(t, { limits: { burst: { windowMs: 10_000, limit: 2 } } });
  for (let i = 0; i < 3; i++) {
    assert.equal((await app.request(CLIENT_A, "/123", {
      method: "OPTIONS", headers: { Origin: "https://example.org", "Access-Control-Request-Method": "GET" },
    })).status, 204);
  }
  assert.equal((await app.request(CLIENT_A, "/bad")).status, 400);
  assert.equal((await app.request(CLIENT_A, "/123", { method: "HEAD" })).status, 200);
  assert.equal((await app.request(CLIENT_A, "/123", { method: "HEAD" })).status, 429);
  assert.equal(app.calls(), 1);
});

test("cooldown storage stays bounded without evicting active blocks", async (t) => {
  const app = await setup(t, { maxCooldowns: 1, limits: { burst: { windowMs: 10_000, limit: 1 } } });
  assert.equal((await app.request(CLIENT_A)).status, 200);
  assert.equal((await app.request(CLIENT_A)).status, 429);
  assert.equal((await app.request(CLIENT_B)).status, 200);
  assert.equal((await app.request(CLIENT_B)).status, 503);
  assert.equal((await app.request(CLIENT_A)).status, 429);
  assert.equal(app.calls(), 2);
});
