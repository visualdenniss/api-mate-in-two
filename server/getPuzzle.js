const {connectToDb, getDb} = require('./db')

const {
    parseSquare,
    __setv,
    Piece,
    ParsePiece,
    FairyHelper,
    Board,
    xfen2spritedecl,
    __fairyHelper,
    board
} = require('./toFen')


const getPuzzle = async (req,res) => {
    try {

        connectToDb((err)=>{
            if(!err){
                db = getDb()
            }

            let puzzles = []
            db.collection('problems')
            .find()
            .forEach(puzzle => puzzles.push(puzzle))
            .then(()=>{
                let random = Math.floor(Math.random()*1000)

                const puzzle = puzzles[random]
                const puzzleAuthor = puzzle.authors
                const puzzleId = puzzle.id
                const puzzleSource = puzzle.source 

                var board = new Board();
                const algebraic = puzzle.algebraic
                board.fromAlgebraic(algebraic);
                const fen = board.toFen().replace(/s/g, 'n').replace(/S/g, 'N');
                

                const matePuzzle = {
                    puzzleAuthor,
                    puzzleId,
                    puzzleSource,
                    fen
                }

                res.status(200).json(matePuzzle)
            })
        })

    } catch (error) {
        console.log(error);
    }
}

module.exports = {
    getPuzzle
}