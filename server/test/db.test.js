const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

function loadModule(filename, dependencies, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", filename), "utf8"),
    {
      module,
      require(name) {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
      },
      process: { env: { MONGO_URL: "mongodb://database.invalid/puzzles" } },
      console: { log() {}, error() {} },
      ...globals,
    },
    { filename: `server/${filename}` },
  );
  return module.exports;
}

function loadDatabase(connect) {
  let attempts = 0;
  const api = loadModule("db.js", {
    mongodb: {
      MongoClient: {
        connect: (...args) => connect(++attempts, ...args),
      },
    },
    dotenv: { config() {} },
  });
  return { api, attempts: () => attempts };
}

function makeClient(database = {}) {
  let closes = 0;
  return {
    db: () => database,
    async close() { closes++; },
    closes: () => closes,
  };
}

function connect(api) {
  return new Promise((resolve, reject) => {
    api.connectToDb((error) => error ? reject(error) : resolve(api.getDb()));
  });
}

function callRoute(handler, request) {
  return new Promise((resolve, reject) => {
    let status;
    try {
      handler(request, {
        status(value) { status = value; return this; },
        json(body) { resolve({ status, body }); return this; },
      });
    } catch (error) {
      reject(error);
    }
  });
}

const tests = [
  ["concurrent first requests share one client", async () => {
    let release;
    const ready = new Promise((resolve) => { release = resolve; });
    const clients = [];
    const fixture = loadDatabase(() => ready.then(() => {
      const client = makeClient();
      clients.push(client);
      return client;
    }));
    const requests = Array.from({ length: 20 }, () => connect(fixture.api));
    assert.equal(fixture.api.getDb(), undefined);
    release();
    const databases = await Promise.all(requests);
    assert.equal(fixture.attempts(), 1);
    assert.equal(clients.length, 1);
    assert.ok(databases.every((database) => database === databases[0]));
  }],
  ["later requests reuse the connected database asynchronously", async () => {
    const client = makeClient();
    const fixture = loadDatabase(async () => client);
    const database = await connect(fixture.api);
    for (let i = 0; i < 10; i++) {
      assert.equal(await connect(fixture.api), database);
    }
    let synchronous = true;
    const delivered = new Promise((resolve, reject) => {
      fixture.api.connectToDb((error) => {
        if (error) return reject(error);
        try { assert.equal(synchronous, false); resolve(); }
        catch (failure) { reject(failure); }
      });
    });
    synchronous = false;
    await delivered;
    assert.equal(fixture.attempts(), 1);
    assert.equal(client.closes(), 0);
  }],
  ["failed initialization notifies all waiters and permits one shared retry", async () => {
    const failure = new Error("Connection unavailable");
    const client = makeClient();
    const fixture = loadDatabase(async (attempt) => {
      if (attempt === 1) throw failure;
      return client;
    });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => connect(fixture.api)),
    );
    assert.ok(results.every((result) => result.status === "rejected" && result.reason === failure));
    assert.equal(fixture.attempts(), 1);
    assert.equal(fixture.api.getDb(), undefined);
    await Promise.all(Array.from({ length: 10 }, () => connect(fixture.api)));
    assert.equal(fixture.attempts(), 2);
    assert.equal(fixture.api.getDb(), client.db());
  }],
  ["request callback failures do not discard the shared connection", async () => {
    const fixture = loadDatabase(async () => makeClient());
    await connect(fixture.api);
    const failure = new Error("Request failed");
    await new Promise((resolve, reject) => {
      fixture.api.connectToDb((error) => {
        if (!error) throw failure;
        if (error !== failure) return reject(error);
        resolve();
      });
    });
    await connect(fixture.api);
    assert.equal(fixture.attempts(), 1);
  }],
  ["database selection failure closes the client before retry", async () => {
    const failure = new Error("Database unavailable");
    const failed = makeClient();
    failed.db = () => { throw failure; };
    const healthy = makeClient();
    const fixture = loadDatabase(async (attempt) => attempt === 1 ? failed : healthy);
    await assert.rejects(connect(fixture.api), (error) => error === failure);
    assert.equal(failed.closes(), 1);
    assert.equal(fixture.api.getDb(), undefined);
    assert.equal(await connect(fixture.api), healthy.db());
    assert.equal(fixture.attempts(), 2);
  }],
  ["shutdown closes once and prevents new connections", async () => {
    const client = makeClient();
    const fixture = loadDatabase(async () => client);
    await connect(fixture.api);
    await Promise.all([fixture.api.closeDb(), fixture.api.closeDb()]);
    assert.equal(client.closes(), 1);
    assert.equal(fixture.api.getDb(), undefined);
    await assert.rejects(connect(fixture.api), /closing/);
    assert.equal(fixture.attempts(), 1);
  }],
  ["shutdown waits for an in-flight initialization", async () => {
    let release;
    const client = makeClient();
    const ready = new Promise((resolve) => { release = resolve; });
    const fixture = loadDatabase(() => ready.then(() => client));
    const request = connect(fixture.api);
    const closed = fixture.api.closeDb();
    release();
    await Promise.all([request, closed]);
    assert.equal(fixture.attempts(), 1);
    assert.equal(client.closes(), 1);
    assert.equal(fixture.api.getDb(), undefined);
  }],
  ["both routes preserve responses and malformed-query handling", async () => {
    const puzzle = {
      id: "123", _id: "fixture-123", authors: ["Test composer"],
      source: { name: "Fixture" }, algebraic: { white: ["Ka1", "Qc1"], black: ["Kh8"] },
    };
    const client = makeClient({
      collection(name) {
        assert.equal(name, "problems");
        return {
          aggregate: () => ({ toArray: async () => [puzzle] }),
          findOne: async ({ id }) => id === puzzle.id ? puzzle : null,
        };
      },
    });
    const fixture = loadDatabase(async () => client);
    const utils = require("../utils");
    const dependencies = { "./db": fixture.api, "./utils": utils };
    const { getPuzzles } = loadModule("getPuzzles.js", dependencies);
    const { getPuzzle } = loadModule("getPuzzle.js", dependencies);
    const [list, detail] = await Promise.all([
      callRoute(getPuzzles, { query: {} }),
      callRoute(getPuzzle, { params: { id: "123" } }),
    ]);
    assert.equal(list.status, 200);
    assert.equal(detail.status, 200);
    assert.deepEqual(list.body, [detail.body]);
    assert.equal(detail.body.puzzleId, "123");
    assert.equal(typeof detail.body.fen, "string");
    assert.equal((await callRoute(getPuzzle, { params: { id: "missing" } })).status, 404);
    assert.equal((await callRoute(getPuzzles, { query: { exclude: ["123"] } })).status, 500);
    assert.equal((await callRoute(getPuzzles, { query: {} })).status, 200);
    assert.equal(fixture.attempts(), 1);
  }],
  ["process shutdown drains HTTP requests before closing MongoDB", async () => {
    const events = [];
    const processStub = new EventEmitter();
    processStub.env = {};
    let drained;
    const app = {
      use() {}, get() {},
      listen() { return { close(callback) { events.push("drain"); drained = callback; } }; },
    };
    const express = () => app;
    express.json = () => () => {};
    loadModule("index.js", {
      express, cors: () => () => {}, dotenv: { config() {} },
      "body-parser": { json: () => () => {} },
      "./getPuzzles": { getPuzzles() {} }, "./getPuzzle": { getPuzzle() {} },
      "./db": { async closeDb() { events.push("database close"); } },
    }, { process: processStub });
    processStub.emit("SIGTERM");
    processStub.emit("SIGINT");
    assert.deepEqual(events, ["drain"]);
    await drained();
    assert.deepEqual(events, ["drain", "database close"]);
  }],
];

(async () => {
  const filter = process.argv[2];
  for (const [name, run] of tests) {
    if (filter && !name.includes(filter)) continue;
    let timeout;
    try {
      await Promise.race([
        run(),
        new Promise((resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Test timed out")), 2000);
        }),
      ]);
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}: ${error.message}`);
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  }
})();
