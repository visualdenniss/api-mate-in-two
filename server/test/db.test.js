const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const validation = require("../validation");

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

function loadLogging(lines) {
  return loadModule("logging.js", {}, {
    console: { error(line) { lines.push(line); } },
  });
}

function loadDatabase(connect, logging = { logError() {} }) {
  let attempts = 0;
  const api = loadModule("db.js", {
    mongodb: {
      MongoClient: {
        connect: (...args) => connect(++attempts, ...args),
      },
    },
    dotenv: { config() {} },
    "./logging": logging,
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
    const logged = [];
    const fixture = loadDatabase(async (attempt) => {
      if (attempt === 1) throw failure;
      return client;
    }, loadLogging(logged));
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => connect(fixture.api)),
    );
    assert.ok(results.every((result) => result.status === "rejected" && result.reason === failure));
    assert.equal(fixture.attempts(), 1);
    assert.equal(fixture.api.getDb(), undefined);
    await Promise.all(Array.from({ length: 10 }, () => connect(fixture.api)));
    assert.equal(fixture.attempts(), 2);
    assert.equal(fixture.api.getDb(), client.db());
    assert.deepEqual(logged.map((line) => JSON.parse(line)), [
      { event: "database_connection_failed", type: "Error" },
    ]);
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
  ["connection setup enforces finite pool, queue and network budgets", async () => {
    let options;
    const fixture = loadDatabase(async (attempt, uri, clientOptions) => {
      options = clientOptions;
      return makeClient();
    });
    await connect(fixture.api);
    const expected = {
      maxPoolSize: 10, minPoolSize: 0, maxConnecting: 2,
      waitQueueTimeoutMS: 2000, serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000, socketTimeoutMS: 10000,
    };
    for (const [key, value] of Object.entries(expected)) assert.equal(options[key], value);

    // Exercise the installed driver's option parser without opening a connection.
    const { MongoClient } = require("mongodb");
    const client = new MongoClient(
      "mongodb://database.invalid/puzzles?maxPoolSize=0&waitQueueTimeoutMS=0&socketTimeoutMS=0",
      options,
    );
    try {
      for (const [key, value] of Object.entries(expected)) assert.equal(client.options[key], value);
    } finally {
      await client.close();
    }
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
    const dependencies = { "./db": fixture.api, "./utils": utils, "./validation": validation };
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
    assert.equal((await callRoute(getPuzzle, { params: { id: "999" } })).status, 404);
    assert.equal((await callRoute(getPuzzles, { query: { exclude: ["123"] } })).status, 400);
    assert.equal((await callRoute(getPuzzles, { query: {} })).status, 200);
    assert.equal(fixture.attempts(), 1);
  }],
  ["invalid puzzle IDs are rejected before any database access", async () => {
    let connections = 0;
    let databaseReads = 0;
    const { getPuzzle } = loadModule("getPuzzle.js", {
      "./db": {
        connectToDb() { connections++; throw new Error("Unexpected database connection"); },
        getDb() { databaseReads++; throw new Error("Unexpected database access"); },
      },
      "./utils": require("../utils"),
      "./validation": validation,
    });
    const invalidIds = [
      undefined, null, 123, 0, -1, true, false, [], ["123"], {}, { $ne: null },
      new String("123"), { toString() { throw new Error("Unexpected ID coercion"); } },
      "", "0", "00", "0123", "-123", "+123", "1.0", "1e3", "0x7b",
      " 123", "123 ", "\t123", "123\n", "123\r", "123\r\n", "1\n23",
      "123\u2028", "123\u2029", "123\0", "123abc", "../123", "1/2",
      "%31%32%33", "$ne", '{"$ne":null}', "１２３", "١٢٣",
      "1".repeat(13), "1".repeat(100000),
    ];
    for (const id of invalidIds) {
      const response = await callRoute(getPuzzle, { params: { id } });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, "Invalid puzzle ID");
    }
    assert.equal(connections, 0);
    assert.equal(databaseReads, 0);
  }],
  ["valid puzzle IDs reach the query unchanged and retain missing-puzzle responses", async () => {
    const queriedIds = [];
    const client = makeClient({
      collection(name) {
        assert.equal(name, "problems");
        return {
          async findOne(query) {
            assert.deepEqual(Object.keys(query), ["id"]);
            queriedIds.push(query.id);
            return null;
          },
        };
      },
    });
    const fixture = loadDatabase(async () => client);
    const { getPuzzle } = loadModule("getPuzzle.js", {
      "./db": fixture.api, "./utils": require("../utils"), "./validation": validation,
    });
    const validIds = ["1", "9", "123", "100000000000", "999999999999"];
    for (const id of validIds) {
      const response = await callRoute(getPuzzle, { params: { id } });
      assert.equal(response.status, 404);
      assert.equal(response.body.error, "Puzzle not found");
    }
    assert.deepEqual(queriedIds, validIds);
    assert.equal(fixture.attempts(), 1);
  }],
  ["invalid exclusion lists are rejected before any database access", async () => {
    let connections = 0;
    let databaseReads = 0;
    const { getPuzzles } = loadModule("getPuzzles.js", {
      "./db": {
        connectToDb() { connections++; throw new Error("Unexpected database connection"); },
        getDb() { databaseReads++; throw new Error("Unexpected database access"); },
      },
      "./utils": require("../utils"),
      "./validation": validation,
    });
    const parseQuery = require("express")().get("query parser fn");
    const invalidLists = [
      null, 0, 123, true, false, [], ["123"], ["123", "456"], {}, { $ne: null },
      new String("123"), { split() { throw new Error("Unexpected input coercion"); } },
      "", "0", "0123", "123,0", "123,0456", "123,,456", ",123", "123,",
      "123, 456", "123 ,456", "123,456\n", "123,456\r\n", "123,\t456",
      "123,456\0", "123,456\u2028", "123,456\u2029", "123,1.0", "123,1e3",
      "123,-1", "123,+1", "123,abc", "$ne", '{"$ne":null}', "[123,456]",
      "123,１２３", "123,١٢٣", "123,%34%35%36", "1".repeat(13),
      Array(501).fill("1").join(","), "1".repeat(6500), "1,".repeat(100000),
      ...["exclude=123&exclude=456", "exclude[]=123", "exclude[$ne]=123"]
        .map((query) => parseQuery(query).exclude),
    ];
    for (const exclude of invalidLists) {
      const response = await callRoute(getPuzzles, { query: { exclude } });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, "Invalid exclude list");
    }
    assert.equal(connections, 0);
    assert.equal(databaseReads, 0);
  }],
  ["valid exclusion lists preserve literal string IDs and optional-list behavior", async () => {
    const received = [];
    const puzzle = { id: "123", algebraic: { white: ["Ka1"], black: ["Kh8"] } };
    const client = makeClient({
      collection(name) {
        assert.equal(name, "problems");
        return {
          aggregate(pipeline) {
            const match = pipeline.find((stage) => stage.$match);
            received.push(match ? Array.from(match.$match.id.$nin) : []);
            return { toArray: async () => [puzzle] };
          },
        };
      },
    });
    const fixture = loadDatabase(async () => client);
    const { getPuzzles } = loadModule("getPuzzles.js", {
      "./db": fixture.api, "./utils": require("../utils"), "./validation": validation,
    });
    const parseQuery = require("express")().get("query parser fn");
    const boundaryIds = Array(500).fill("999999999999");
    const cases = [
      [{}, []],
      [{ exclude: undefined }, []],
      [{ exclude: "1" }, ["1"]],
      [{ exclude: "123,456" }, ["123", "456"]],
      [{ exclude: "123,123" }, ["123", "123"]],
      [{ exclude: boundaryIds.join(",") }, boundaryIds],
      [parseQuery("exclude=%31%32%33%2C456"), ["123", "456"]],
    ];
    for (const [query, expected] of cases) {
      const response = await callRoute(getPuzzles, { query });
      assert.equal(response.status, 200);
      assert.deepEqual(received[received.length - 1], expected);
    }
    assert.equal(fixture.attempts(), 1);
  }],
  ["exclusions filter stored IDs before sampling, regardless of response aliases", async () => {
    const requestLogs = [];
    const puzzles = [
      { id: "123" },
      { id: "456", puzzleId: "789" },
      { id: "789", puzzleId: "123" },
    ].map((puzzle) => ({ ...puzzle, algebraic: { white: ["Ka1"], black: ["Kh8"] } }));
    const client = makeClient({
      collection() {
        return {
          aggregate(pipeline) {
            let selected = puzzles;
            for (const stage of pipeline) {
              if (stage.$match) {
                for (const [field, condition] of Object.entries(stage.$match)) {
                  // MongoDB $nin also matches documents missing the queried field.
                  selected = selected.filter((puzzle) => !condition.$nin.includes(puzzle[field]));
                }
              }
              if (stage.$sample) selected = selected.slice(0, stage.$sample.size);
            }
            return { toArray: async () => selected };
          },
        };
      },
    });
    const fixture = loadDatabase(async () => client);
    const { getPuzzles } = loadModule("getPuzzles.js", {
      "./db": fixture.api, "./utils": require("../utils"), "./validation": validation,
    }, {
      console: {
        log(...args) { requestLogs.push(args); },
        error(...args) { requestLogs.push(args); },
      },
    });
    const response = await callRoute(getPuzzles, { query: { exclude: "123,456" } });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map((puzzle) => puzzle.puzzleId), ["789"]);
    assert.deepEqual(requestLogs, []);
  }],
  ["error logs retain safe diagnostics without private or malformed metadata", async () => {
    const logged = [];
    const { logError } = loadLogging(logged);
    const privateDetails = "mongodb+srv://fixture-user:fixture-password@cluster.invalid/puzzles";
    const failure = Object.assign(new Error(privateDetails), {
      name: "MongoServerError", code: 50,
      cause: { uri: privateDetails, path: "$PRIVATE_ROOT/server/db.js", exclude: ["123", "456"] },
    });
    logError("database_query_failed", failure);
    logError("database_connection_failed", { name: "MongoNetworkError", code: "ECONNRESET" });
    logError(privateDetails, { name: privateDetails, code: privateDetails });
    logError("shutdown_failed", null);
    logError("shutdown_failed", { get name() { throw new Error(privateDetails); } });
    for (const code of [NaN, Infinity, -1, 2_147_483_648, 1.5, {}, [50]]) {
      logError("database_query_failed", { name: "Error", code });
    }
    assert.deepEqual(logged.slice(0, 5).map((line) => JSON.parse(line)), [
      { event: "database_query_failed", type: "MongoServerError", code: 50 },
      { event: "database_connection_failed", type: "MongoNetworkError", code: "ECONNRESET" },
      { event: "operation_failed", type: "Error" },
      { event: "shutdown_failed", type: "Error" },
      { event: "shutdown_failed", type: "Error" },
    ]);
    for (const line of logged.slice(5)) {
      assert.deepEqual(JSON.parse(line), { event: "database_query_failed", type: "Error" });
    }
    for (const secret of [privateDetails, "fixture-password", "$PRIVATE_ROOT", "exclude", "stack", "cause"]) {
      assert.equal(logged.join("\n").includes(secret), false);
    }
  }],
  ["connection failures log once without raw errors from either request handler", async () => {
    const logged = [];
    const rawLogs = [];
    const failure = new Error("mongodb://fixture-user:fixture-password@database.invalid/puzzles");
    const fixture = loadDatabase(async () => { throw failure; }, loadLogging(logged));
    const dependencies = {
      "./db": fixture.api, "./utils": require("../utils"), "./validation": validation,
    };
    const globals = { console: {
      log(...args) { rawLogs.push(args); },
      error(...args) { rawLogs.push(args); },
    } };
    const { getPuzzles } = loadModule("getPuzzles.js", dependencies, globals);
    const { getPuzzle } = loadModule("getPuzzle.js", dependencies, globals);
    const responses = await Promise.all([
      callRoute(getPuzzles, { query: {} }),
      callRoute(getPuzzle, { params: { id: "123" } }),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 500);
      assert.equal(response.body.error, "Database connection failed");
    }
    assert.deepEqual(logged.map((line) => JSON.parse(line)), [
      { event: "database_connection_failed", type: "Error" },
    ]);
    assert.deepEqual(rawLogs, []);
  }],
  ["both puzzle queries enforce server time limits regardless of client parameters", async () => {
    const queries = [];
    const puzzle = { id: "123", algebraic: { white: ["Ka1"], black: ["Kh8"] } };
    const client = makeClient({
      collection() {
        return {
          async findOne(filter, options) {
            queries.push({ operation: "detail", options });
            return puzzle;
          },
          aggregate(pipeline, options) {
            queries.push({ operation: "list", options });
            return { toArray: async () => [puzzle] };
          },
        };
      },
    });
    const fixture = loadDatabase(async () => client);
    const dependencies = {
      "./db": fixture.api, "./utils": require("../utils"), "./validation": validation,
    };
    const { getPuzzle } = loadModule("getPuzzle.js", dependencies);
    const { getPuzzles } = loadModule("getPuzzles.js", dependencies);
    assert.equal((await callRoute(getPuzzle, {
      params: { id: "123" }, query: { maxTimeMS: "0" },
    })).status, 200);
    for (const query of [{}, { exclude: "456" }, { exclude: "456", maxTimeMS: "0" }]) {
      assert.equal((await callRoute(getPuzzles, { query })).status, 200);
    }
    assert.deepEqual(queries.map((query) => query.operation), ["detail", "list", "list", "list"]);
    for (const query of queries) assert.equal(query.options.maxTimeMS, 5000);
    assert.equal(fixture.attempts(), 1);
  }],
  ["database timeout failures stay controlled and do not discard a healthy client", async () => {
    const failures = [
      Object.assign(new Error("Private query timeout details"), { name: "MongoServerError", code: 50 }),
      Object.assign(new Error("Private pool timeout details"), { name: "MongoWaitQueueTimeoutError" }),
      Object.assign(new Error("Private socket timeout details"), { name: "MongoNetworkTimeoutError" }),
    ];
    for (const failure of failures) {
      let fail = true;
      const puzzle = { id: "123", algebraic: { white: ["Ka1"], black: ["Kh8"] } };
      const client = makeClient({
        collection() {
          return {
            async findOne() { if (fail) throw failure; return puzzle; },
            aggregate: () => ({ toArray: async () => { if (fail) throw failure; return [puzzle]; } }),
          };
        },
      });
      const fixture = loadDatabase(async () => client);
      const utils = loadModule("utils.js", {
        "./toFen": require("../toFen"), "./logging": { logError() {} },
      });
      const dependencies = { "./db": fixture.api, "./utils": utils, "./validation": validation };
      const { getPuzzles } = loadModule("getPuzzles.js", dependencies);
      const { getPuzzle } = loadModule("getPuzzle.js", dependencies);
      const responses = await Promise.all([
        callRoute(getPuzzles, { query: {} }),
        callRoute(getPuzzle, { params: { id: "123" } }),
      ]);
      for (const response of responses) {
        assert.equal(response.status, 500);
        assert.equal(response.body.error, "Internal Server Error");
        assert.equal(JSON.stringify(response.body).includes(failure.message), false);
      }
      fail = false;
      assert.equal((await callRoute(getPuzzle, { params: { id: "123" } })).status, 200);
      assert.equal((await callRoute(getPuzzles, { query: {} })).status, 200);
      assert.equal(fixture.attempts(), 1);
      assert.equal(client.closes(), 0);
    }
  }],
  ["database query failures return controlled errors from both routes", async () => {
    const failure = Object.assign(new Error("Private database failure details"), {
      name: "MongoServerError", code: 50,
    });
    const logged = [];
    const client = makeClient({
      collection() {
        return {
          aggregate: () => ({ toArray: async () => { throw failure; } }),
          findOne: async () => { throw failure; },
        };
      },
    });
    const fixture = loadDatabase(async () => client);
    const utils = loadModule("utils.js", {
      "./toFen": require("../toFen"), "./logging": loadLogging(logged),
    });
    const dependencies = { "./db": fixture.api, "./utils": utils, "./validation": validation };
    const { getPuzzles } = loadModule("getPuzzles.js", dependencies);
    const { getPuzzle } = loadModule("getPuzzle.js", dependencies);
    const responses = await Promise.all([
      callRoute(getPuzzles, { query: {} }),
      callRoute(getPuzzle, { params: { id: "123" } }),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 500);
      assert.equal(response.body.error, "Internal Server Error");
      assert.equal(JSON.stringify(response.body).includes(failure.message), false);
    }
    assert.deepEqual(logged.map((line) => JSON.parse(line)), Array(2).fill({
      event: "database_query_failed", type: "MongoServerError", code: 50,
    }));
    assert.equal(logged.join("\n").includes(failure.message), false);
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
      "./getPuzzles": { getPuzzles() {} }, "./getPuzzle": { getPuzzle() {} },
      "./db": { async closeDb() { events.push("database close"); } },
      "./logging": { logError() {} },
      "./rateLimit": {
        createRateProtection() {
          return { middleware: [], batches() {}, shutdown() { events.push("rate-limit shutdown"); } };
        },
      },
    }, { process: processStub });
    processStub.emit("SIGTERM");
    processStub.emit("SIGINT");
    assert.deepEqual(events, ["drain"]);
    await drained();
    assert.deepEqual(events, ["drain", "database close", "rate-limit shutdown"]);
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
