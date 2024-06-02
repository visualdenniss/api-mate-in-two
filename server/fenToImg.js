const FTI = require("fen-to-image");

async function fenToImg(req, res) {
  try {
    const { fen } = req.body; // Extract FEN string from request body
    if (!fen) {
      return res.status(400).send("FEN string is required.");
    }

    const buffer = await FTI({
      fen,
      color: "white", // The color of the side you want to see!
    });

    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": buffer.length,
    });
    res.end(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = fenToImg;
