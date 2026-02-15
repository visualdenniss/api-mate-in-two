const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const bodyParser = require('body-parser'); // Import bodyParser for parsing POST request bodies
const { getPuzzles } = require('./getPuzzles');
const { getPuzzle } = require('./getPuzzle');
// const { getAllAuthorList } = require("./getAllAuthorList");

// Middleware for parsing JSON bodies
app.use(bodyParser.json());
app.use(cors());
app.use(express.json());

// routes

app.get('/', getPuzzles);
app.get('/:id', getPuzzle);

const port = process.env.PORT || 8000;

app.listen(port, () => console.log(`Server is listening on port ${port}...`));
