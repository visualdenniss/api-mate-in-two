const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();

let dbConnection;

module.exports = {
  connectToDb: (cb) => {
    MongoClient.connect(process.env.MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
      .then((client) => {
        dbConnection = client.db();
        return cb(null); // Updated to call cb with null on success
      })
      .catch((err) => {
        console.log(err);
        return cb(err);
      });
  },
  getDb: () => dbConnection,
};
