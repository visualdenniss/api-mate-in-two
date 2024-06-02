const { connectToDb, getDb } = require("./db");
const { processPuzzleData, handleError } = require("./utils");

// Function to fetch a random puzzle from the database
const fetchRandomPuzzles = (puzzlesCollection) => {
  return puzzlesCollection.aggregate([{ $sample: { size: 30 } }]).toArray();
};

// Function to handle sending the response
const sendResponse = (res, matePuzzles) => {
  res.status(200).json(matePuzzles);
};

const getPuzzles = (req, res) => {
  connectToDb((err) => {
    if (err) {
      console.error("Failed to connect to database:", err);
      return res.status(500).json({ error: "Database connection failed" });
    }

    const db = getDb();
    const puzzlesCollection = db.collection("problems");

    fetchRandomPuzzles(puzzlesCollection)
      .then((randomPuzzles) => {
        try {
          const matePuzzles = processPuzzleData(randomPuzzles);
          sendResponse(res, matePuzzles);
        } catch (error) {
          res.status(404).json({ error: error.message });
        }
      })
      .catch((error) => handleError(res, error));
  });
};

module.exports = { getPuzzles };
