const { Board } = require("./toFen");

// Function to convert algebraic notation to FEN format
function convertToFen(algebraic) {
  const board = new Board();
  board.fromAlgebraic(algebraic);
  return board.toFen().replace(/s/g, "n").replace(/S/g, "N");
}

// Function to process puzzle data and convert to desired format
const processPuzzleData = (puzzle) => {
  if (!puzzle) throw new Error("Puzzle not found");

  const {
    authors: puzzleAuthor,
    id: puzzleId,
    _id: puzzleDbID,
    source: puzzleSource,
    algebraic,
  } = puzzle;

  const fen = convertToFen(algebraic);

  return { puzzleAuthor, puzzleId, puzzleSource, fen, puzzleDbID };
};

// Function to process multiple puzzle data and convert to desired format
const processMultiplePuzzleData = (puzzles) => {
  if (puzzles.length === 0) throw new Error("No puzzles found");

  return puzzles.map((puzzle) => {
    const {
      authors: puzzleAuthor,
      id: puzzleId,
      _id: puzzleDbID,
      source: puzzleSource,
      algebraic,
    } = puzzle;
    const fen = convertToFen(algebraic);
    return { puzzleAuthor, puzzleId, puzzleSource, fen, puzzleDbID };
  });
};

// Function to handle errors
const handleError = (res, error, message = "Internal Server Error") => {
  console.error(error);
  res.status(500).json({ error: message });
};

module.exports = {
  convertToFen,
  processPuzzleData,
  processMultiplePuzzleData,
  handleError,
};
