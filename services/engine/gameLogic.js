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

    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
        throw new Error("Invalid coordinates!");
    }

    const piece = gameState.board[y][x];



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
            break;

        case 'SWAP':
            if (!piece) {
                console.log("No piece at selected position."); return;
            }
            if (piece.player !== playerId) { console.log("You can only move your own pieces."); return; }
            if (!piece.canSwap) {
                console.log("Only Scarabs can swap."); return;
            }

            const { targetX, targetY } = action;

            if (!isValidCoordinate(targetX, targetY)) { console.log("Invalid target coordinates."); return; }

            const targetPiece = gameState.board[targetY][targetX];

            if (!targetPiece) { console.log("Target cell is empty."); return; }

            if (targetPiece.player !== playerId) { console.log("Cannot swap with opponent's pieces."); return; }

            if (!['Sphinx', 'Pharaoh'].includes(targetPiece.type)) { console.log("Can only swap with Sphinx or Pharaoh."); return; }

            const lastSwapTurn = gameState.swapHistory[playerId][targetPiece.type];
            const turnsPassed = gameState.turnCount - lastSwapTurn;

            if (turnsPassed < 8) {
                const turnsRemaining = Math.ceil((8 - turnsPassed) / 2);
                console.log(`Swap with ${targetPiece.type} is cooling down. Wait ${turnsRemaining} more of your turns.`);
                return;
            }

            gameState.board[y][x] = targetPiece;
            gameState.board[targetY][targetX] = piece;

            gameState.swapHistory[playerId][targetPiece.type] = gameState.turnCount;

            if (targetPiece.type === 'Sphinx') {
                laserShouldFire = false;
            }

            break;

        case 'ROTATE':
            if (!piece) {
                console.log("No piece at selected position."); return;
            }
            if (piece.player !== playerId) { console.log("You can only move your own pieces."); return; }
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


}


function fireLaser(gameState, playerId,laserShouldFire) { }


module.exports = { applyAction };