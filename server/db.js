const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();

let dbConnection;
let connectionPromise;
let closePromise;
let closing = false;

const getConnection = () => {
  if (closing) return Promise.reject(new Error("Database connection is closing"));

  if (!connectionPromise) {
    // Share initialization as well as the connected client across requests.
    connectionPromise = MongoClient.connect(process.env.MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
      .then(async (client) => {
        try {
          dbConnection = client.db();
          return client;
        } catch (error) {
          await client.close();
          throw error;
        }
      })
      .catch((error) => {
        connectionPromise = undefined;
        throw error;
      });
  }

  return connectionPromise;
};

const closeDb = () => {
  if (!closePromise) {
    closing = true;
    closePromise = (async () => {
      let client;
      try {
        client = await connectionPromise;
      } catch {
        return;
      }
      if (client) await client.close();
      dbConnection = undefined;
    })();
  }
  return closePromise;
};

module.exports = {
  connectToDb: (cb) => {
    return getConnection()
      .then(() => cb(null))
      .catch((err) => {
        console.log(err);
        return cb(err);
      });
  },
  getDb: () => dbConnection,
  closeDb,
};
