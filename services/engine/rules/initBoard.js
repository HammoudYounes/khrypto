
const { Sphinx } = require('./pieces/Sphinx');
const { Pharaoh } = require('./pieces/Pharaoh');
const { Anubis } = require('./pieces/Anubis');
const { Pyramid } = require('./pieces/Pyramid');
const { Scarab } = require('./pieces/Scarab');
const BOARD_SIZE = 10;

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function initializeBoard() {
    const board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));

    // --- PLAYER 1 SETUP (Top of board, Rows 0-4) ---

    const p1SphinxCol = getRandomInt(0, 9);
    const p1SphinxOri = p1SphinxCol < 5 ? 1 : 3;
    board[0][p1SphinxCol] = new Sphinx(1, p1SphinxOri);


    const p2SphinxCol = 9 - p1SphinxCol;

    const forbiddenCols = [0, 9, p1SphinxCol, p2SphinxCol];
    let p1PharaohCol;
    do {
        p1PharaohCol = getRandomInt(1, 8); 
    } while (forbiddenCols.includes(p1PharaohCol));

    board[2][p1PharaohCol] = new Pharaoh(1, 2); 


    board[4][p1PharaohCol] = new Anubis(1, 2);

    board[2][p2SphinxCol] = new Anubis(1, 2);


    const p1ScarabCol = getRandomInt(0, 9);
    const p1ScarabOri = getRandomInt(0, 3);
    board[3][p1ScarabCol] = new Scarab(1, p1ScarabOri);



    // --- PLAYER 0 SETUP (Symmetry) ---
    
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 10; c++) {
            const piece = board[r][c];
            if (piece) {
                const mirrorRow = 9 - r;
                const mirrorCol = 9 - c;
                const mirrorOri = (piece.orientation + 2) % 4;
                
                let newPiece;
                switch(piece.constructor.name) {
                    case 'Sphinx': newPiece = new Sphinx(0, mirrorOri); break;
                    case 'Pharaoh': newPiece = new Pharaoh(0, mirrorOri); break;
                    case 'Anubis': newPiece = new Anubis(0, mirrorOri); break;
                    case 'Scarab': newPiece = new Scarab(0, mirrorOri); break;
                    case 'Pyramid': newPiece = new Pyramid(0, mirrorOri); break;
                }
                
                if (newPiece) {
                    board[mirrorRow][mirrorCol] = newPiece;
                }
            }
        }
    }

    return board;
}
module.exports = { initializeBoard };