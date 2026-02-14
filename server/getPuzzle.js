const { connectToDb, getDb } = require("./db");
const { processPuzzleData } = require("./utils");

// Function to fetch a puzzle by its ID from the database
const fetchPuzzleById = (puzzlesCollection, puzzleId) => {
  return puzzlesCollection.findOne({ id: puzzleId });
};

// Function to handle sending the response
const sendResponse = (res, matePuzzle) => {
  res.status(200).json(matePuzzle);
};

const getPuzzle = (req, res) => {
  const puzzleId = req.params.id;

  connectToDb((err) => {
    if (err) {
      console.error("Failed to connect to database:", err);
      return res.status(500).json({ error: "Database connection failed" });
    }

    const db = getDb();
    const puzzlesCollection = db.collection("problems");

    fetchPuzzleById(puzzlesCollection, puzzleId)
      .then((puzzle) => {
        try {
          const matePuzzle = processPuzzleData(puzzle);
          sendResponse(res, matePuzzle);
        } catch (error) {
          res.status(404).json({ error: error.message });
        }
      })
      .catch((error) => handleError(res, error));
  });
};

module.exports = { getPuzzle };
