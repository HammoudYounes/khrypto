const { DIRECTIONS } = require('./pieces/Piece'); 

const BOARD_SIZE = 10;

function isValidPos(x, y) {
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

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
            if (!piece.canSwap) throw new Error("Only Scarabs can swap.");

            const { targetX, targetY } = action;

            if (!isValidPos(targetX, targetY)) throw new Error("Invalid target coordinates.");

            const targetPiece = gameState.board[targetY][targetX];

            if (!targetPiece) throw new Error("Target cell is empty.");

            if (targetPiece.player !== playerId) throw new Error("Cannot swap with opponent's pieces.");

            if (!['Sphinx', 'Pharaoh'].includes(targetPiece.type)) throw new Error("Can only swap with Sphinx or Pharaoh.");

            const lastSwapTurn = gameState.swapHistory[playerId][targetPiece.type];
            const turnsPassed = gameState.turnCount - lastSwapTurn;

            if (turnsPassed < 8) {
                const turnsRemaining = Math.ceil((8 - turnsPassed) / 2);
                throw new Error(`Swap with ${targetPiece.type} is cooling down. Wait ${turnsRemaining} more of your turns.`);
            }

            gameState.board[y][x] = targetPiece; 
            gameState.board[targetY][targetX] = piece;

            gameState.swapHistory[playerId][targetPiece.type] = gameState.turnCount;

            if (targetPiece.type === 'Sphinx') {
                laserShouldFire = false;
            }

            break;


    }

}


function fireLaser(gameState, playerId,laserShouldFire) { }


module.exports = { applyAction };