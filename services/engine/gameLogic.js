const { DIRECTIONS } = require('./pieces/Piece'); 

const BOARD_SIZE = 10;



function applyAction(gameState, action, playerId) {

    if (gameState.turn !== playerId) {
        throw new Error("Not your turn!");
    }

    const { type, x, y } = action;

    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
        throw new Error("Invalid coordinates!");
    }

    const piece = gameState.board[y][x];

    if (!piece) throw new Error("No piece at selected position.");
    if (piece.player !== playerId) throw new Error("You can only move your own pieces.");
    switch (type){
        case 'SWAP':
            break;

        case 'ROTATE':
            // RULE: Pharaoh cannot rotate
            if (piece.type === 'Pharaoh') {
                throw new Error("The Pharaoh cannot rotate!");
            }

            const { direction } = action;
            if (direction !== 1 && direction !== -1) {
                throw new Error("Invalid rotation direction (1 or -1 required).");
            }

            piece.rotate(direction);
            break;

        default:
            throw new Error("Unknown action type.");
    }
    // Fire the laser immediately after the action
    fireLaser(gameState, playerId);

    // If the game is not over, switch turns
    if (gameState.winner === null) {
        gameState.turn = (gameState.turn + 1) % 2;
    }

}


function fireLaser(gameState, playerId) {}


module.exports = { applyAction };