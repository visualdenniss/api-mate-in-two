const { connectToDb, getDb, QUERY_TIMEOUT_MS } = require("./db");
const { handleError, processMultiplePuzzleData } = require("./utils");
const { parseExcludedIds } = require("./validation");

// Function to fetch a random puzzle from the database
const fetchRandomPuzzles = (puzzlesCollection, exclude = []) => {
  if (exclude.length > 0) {
    return puzzlesCollection
      .aggregate(
        [
          { $match: { id: { $nin: exclude } } },
          { $sample: { size: 30 } },
        ],
        { maxTimeMS: QUERY_TIMEOUT_MS },
      )
      .toArray();
  } else {
    return puzzlesCollection
      .aggregate([{ $sample: { size: 30 } }], { maxTimeMS: QUERY_TIMEOUT_MS })
      .toArray();
  }
};

// Function to handle sending the response
const sendResponse = (res, matePuzzles) => {
  res.status(200).json(matePuzzles);
};

const getPuzzles = (req, res) => {
  const exclude = parseExcludedIds(req.query.exclude);
  if (exclude === null) {
    return res.status(400).json({ error: "Invalid exclude list" });
  }

  connectToDb((err) => {
    if (err) {
      return res.status(500).json({ error: "Database connection failed" });
    }

    const db = getDb();
    const puzzlesCollection = db.collection("problems");
    fetchRandomPuzzles(puzzlesCollection, exclude)
      .then((randomPuzzles) => {
        try {
          const matePuzzles = processMultiplePuzzleData(randomPuzzles);
          sendResponse(res, matePuzzles);
        } catch (error) {
          res.status(404).json({ error: error.message });
        }
      })
      .catch((error) => handleError(res, error));
  });
};

module.exports = { getPuzzles };
