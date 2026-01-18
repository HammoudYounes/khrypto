const { DIRECTIONS } = require('./pieces/Piece');
const { Pyramid } = require('./pieces/Pyramid');

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

    let laserShouldFire = true;



    switch (type) {
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

    }


    gameState.canPassTurn = true;
    return laserShouldFire;

}


function computeLaserPath(gameState, playerId, laserShouldFire) {
    if (!laserShouldFire) {
        return null;
    }

    let path = [];
    let hitCoords = [];

    let sphinxPiece = null;
    let sphinxPos = null;

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const p = gameState.board[r][c];
            if (p && p.type === 'Sphinx' && p.player === playerId) {
                sphinxPiece = p;
                sphinxPos = { x: c, y: r };
                break;
            }
        }
    }

    if (!sphinxPiece) return { path: [], hitCoords: null };

    // Init Laser
    let cx = sphinxPos.x;
    let cy = sphinxPos.y;
    let dir = sphinxPiece.orientation;
    const dx = [0, 1, 0, -1];
    const dy = [-1, 0, 1, 0];

    cx += dx[dir];
    cy += dy[dir];

    let laserActive = true;

    while (laserActive && isValidCoordinate(cx, cy)) {
        path.push({ x: cx, y: cy });

        const target = gameState.board[cy][cx];

        if (target) {
            const result = target.acceptLaser(dir);

            if (result.action === 'BLOCK') {
                laserActive = false;
            }
            else if (result.action === 'REFLECT') {
                dir = result.newDirection;
            }
            else if (result.action === 'PASS') {
                hitCoords.push({ x: cx, y: cy });
            }
        }

        if (laserActive) {
            cx += dx[dir];
            cy += dy[dir];
        }
    }

    return { path, hitCoords };

}

function applyDestructions(gameState, hitCoords) {
    if (hitCoords && hitCoords.length > 0) {
        hitCoords.forEach(coord => {
            const { x, y } = coord;
            const piece = gameState.board[y][x];

            if (piece) {
                console.log(`[Laser] Destroying ${piece.type} at (${x}, ${y})`);

                if (piece.type === 'Pharaoh') {
                    // Win Condition
                    gameState.winner = (piece.player + 1) % 2;
                }
                else if (piece.type === 'Pyramid') {
                    const beneficiary = (piece.player + 1) % 2;

                    const unlockTurn = gameState.turnCount + 4;

                    console.log(`Pyramid captured! Sent to P${beneficiary} reserve (Available turn ${unlockTurn})`);

                    gameState.pendingReserves[beneficiary].push(unlockTurn);
                }

                gameState.board[y][x] = null;
            }
        });
    }

}


module.exports = { applyAction, computeLaserPath, applyDestructions };