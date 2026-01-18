const { DIRECTIONS } = require('./pieces/Piece'); 
const {Pyramid} = require('./pieces/Pyramid');

const BOARD_SIZE = 10;


// Helper to check that the coordinate are not out of board
function isValidCoordinate(x, y) {
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

// Helper to check placement constraints rule for the pyramid
function checkPlacementConstraints(gameState, x, y, playerId) {
    const orthogonalDirs = [
        { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, 
        { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
    ];

    for (const dir of orthogonalDirs) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;

        if (isValidCoordinate(nx, ny)) {
            const neighbor = gameState.board[ny][nx];
            if (neighbor) {
                if (neighbor.type === 'Sphinx') return false;
                if (neighbor.type === 'Pharaoh' && neighbor.player === playerId) return false;
            }
        }
    }
    return true;
}


function applyAction(gameState, action, playerId) {

    if (gameState.turn !== playerId) {
        throw new Error("Not your turn!");
    }

    const { type, x, y } = action;
    const piece = gameState.board[y][x];

    //if (!piece) throw new Error("No piece at selected position.");
    //if (piece.player !== playerId) throw new Error("You can only move your own pieces.");
    switch (type){
        case 'PLACE':

            if (gameState.reserves[playerId] <= 0) {
                console.log("Not enough pyramid in reserve")
                return;
            }

            if (piece || !checkPlacementConstraints(gameState, x, y, playerId)) {
                console.log("Not allowed to place it here")
                return;
            }
            
            gameState.board[y][x] = new Pyramid(playerId, action.orientation); 
            
            gameState.reserves[playerId] -= 1;
            
        case 'SWAP':
            break;

        
    }

}


function fireLaser(gameState, playerId) {}


module.exports = { applyAction };