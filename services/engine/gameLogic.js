const { DIRECTIONS } = require('./pieces/Piece'); 

const BOARD_SIZE = 10;



function applyAction(gameState, action, playerId) {

    if (gameState.turn !== playerId) {
        throw new Error("Not your turn!");
    }

    const { type, x, y } = action;
    const piece = gameState.board[y][x];

    if (!piece) throw new Error("No piece at selected position.");
    if (piece.player !== playerId) throw new Error("You can only move your own pieces.");
    switch (type){
        case 'SWAP':
            break;

        
    }

}


function fireLaser(gameState, playerId) {}


module.exports = { applyAction };