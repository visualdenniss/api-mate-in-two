const { connectToDb, getDb } = require("./db");
const { Board } = require("./toFen");

const getPuzzle = (req, res) => {
  connectToDb((err) => {
    if (err) {
      console.error("Failed to connect to database:", err);
      return res.status(500).json({ error: "Database connection failed" });
    }

    const db = getDb();
    const puzzlesCollection = db.collection("problems");

    puzzlesCollection
      .aggregate([{ $sample: { size: 1 } }])
      .toArray()
      .then((randomPuzzle) => {
        if (randomPuzzle.length === 0) {
          return res.status(404).json({ error: "No puzzles found" });
        }

        const puzzle = randomPuzzle[0];
        const puzzleAuthor = puzzle.authors;
        const puzzleId = puzzle.id;
        const puzzleDbID = puzzle._id; // use _id since it's a MongoDB ObjectId
        const puzzleSource = puzzle.source;

        var board = new Board();
        const algebraic = puzzle.algebraic;
        board.fromAlgebraic(algebraic);
        const fen = board.toFen().replace(/s/g, "n").replace(/S/g, "N");

        const matePuzzle = {
          puzzleAuthor,
          puzzleId,
          puzzleSource,
          fen,
          puzzleDbID,
        };

        res.status(200).json(matePuzzle);
      })
      .catch((error) => {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      });
  });
};

module.exports = { getPuzzle };
