const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const { getPuzzles } = require('./getPuzzles');
const { getPuzzle } = require('./getPuzzle');
const { closeDb } = require('./db');
const { createRateProtection } = require('./rateLimit');
// const { getAllAuthorList } = require("./getAllAuthorList");

const rateProtection = createRateProtection();
app.use(cors({ exposedHeaders: ['Retry-After', 'RateLimit', 'RateLimit-Policy'] }));
app.use(rateProtection.middleware);

// routes

app.get('/', rateProtection.batches, getPuzzles);
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
    } finally {
      rateProtection.shutdown();
    }
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
