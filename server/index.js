const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const bodyParser = require('body-parser'); // Import bodyParser for parsing POST request bodies
const { getPuzzles } = require('./getPuzzles');
const { getPuzzle } = require('./getPuzzle');
const { closeDb } = require('./db');
// const { getAllAuthorList } = require("./getAllAuthorList");

// Middleware for parsing JSON bodies
app.use(bodyParser.json());
app.use(cors());
app.use(express.json());

// routes

app.get('/', getPuzzles);
app.get('/:id', getPuzzle);

const port = process.env.PORT || 8000;

const server = app.listen(port, () => console.log(`Server is listening on port ${port}...`));

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async (error) => {
    try {
      await closeDb();
      if (error) throw error;
    } catch (shutdownError) {
      console.error('Failed to shut down cleanly:', shutdownError);
      process.exitCode = 1;
    }
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
