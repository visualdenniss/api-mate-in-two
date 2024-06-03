const { connectToDb, getDb } = require("./db");

const getAllAuthorList = (req, res) => {
  connectToDb((err) => {
    if (err) {
      console.error("Failed to connect to database:", err);
      return res.status(500).json({ error: "Database connection failed" });
    }

    const db = getDb();
    const puzzlesCollection = db.collection("problems");

    // Fetch all puzzles from the database
    puzzlesCollection.find().toArray((err, puzzles) => {
      if (err) {
        console.error("Error fetching puzzles:", err);
        return res.status(500).json({ error: "Failed to fetch puzzles" });
      }

      // Create an object to store the count of problems for each author
      const authorCounts = {};

      // Iterate through each puzzle to count authors
      puzzles.forEach((puzzle) => {
        if (puzzle.authors && Array.isArray(puzzle.authors)) {
          puzzle.authors.forEach((author) => {
            if (authorCounts[author]) {
              authorCounts[author]++;
            } else {
              authorCounts[author] = 1;
            }
          });
        }
      });

      // Convert the author counts object to an array of objects
      const composerList = Object.keys(authorCounts).map((composerName) => ({
        composerName,
        Problems: authorCounts[composerName],
      }));

      // Sort the composer list by the number of problems in descending order
      composerList.sort((a, b) => b.Problems - a.Problems);

      // Send the sorted composer list as the response
      res.status(200).json(composerList);
    });
  });
};

module.exports = {
  getAllAuthorList,
};
