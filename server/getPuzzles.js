const { connectToDb, getDb } = require("./db");
const { handleError, processMultiplePuzzleData } = require("./utils");

// Function to fetch a random puzzle from the database
const fetchRandomPuzzles = (puzzlesCollection, exclude = []) => {
  if (exclude.length > 0) {
    console.log(exclude);
    return puzzlesCollection
      .aggregate([
        { $match: { puzzleId: { $nin: exclude } } },
        { $sample: { size: 30 } },
      ])
      .toArray();
  } else {
    return puzzlesCollection.aggregate([{ $sample: { size: 30 } }]).toArray();
  }
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
    const exclude = req.query.exclude ? req.query.exclude.split(",") : [];
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
