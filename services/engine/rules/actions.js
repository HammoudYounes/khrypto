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

    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
        throw new Error("Invalid coordinates!");
    }

    const piece = gameState.board[y][x];

    let laserShouldFire = true;



    switch (type) {
        case 'PLACE':

            if (gameState.reserves[playerId] <= 0) {
                throw new Error("Not enough pyramids in reserve.");
            }

            if (piece || !checkPlacementConstraints(gameState, x, y, playerId)) {
                throw new Error("Not allowed to place a pyramid here.");
            }

            if (![0, 1, 2, 3].includes(action.orientation)) {
                throw new Error("Invalid orientation.");
            }

            gameState.board[y][x] = new Pyramid(playerId, action.orientation);

            gameState.reserves[playerId] -= 1;
            break;

        case 'SWAP':
            if (!piece) {
                throw new Error("No piece at selected position.");
            }
            if (piece.player !== playerId) { throw new Error("You can only move your own pieces."); }
            if (!piece.canSwap) {
                throw new Error("Only Scarabs can swap.");
            }

            const { targetX, targetY } = action;

            if (!isValidCoordinate(targetX, targetY)) { throw new Error("Invalid target coordinates."); }

            const targetPiece = gameState.board[targetY][targetX];

            if (!targetPiece) { throw new Error("Target cell is empty."); }

            if (targetPiece.player !== playerId) { throw new Error("Cannot swap with opponent's pieces."); }

            if (!['Sphinx', 'Pharaoh'].includes(targetPiece.type)) { throw new Error("Can only swap with Sphinx or Pharaoh."); }

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

        case 'MOVE':
            if (!piece) {
                throw new Error("No piece at selected position.");
            }
            if (piece.player !== playerId) {
                throw new Error("You can only move your own pieces.");
            }
            // Vérification du type de pièce
            if (piece.type === 'Sphinx' || piece.type === 'Pharaoh') {
                throw new Error("Le Sphinx et le Pharaon ne peuvent pas se déplacer !");
            }

            const { destX, destY } = action;

            if (!isValidCoordinate(destX, destY)) {
                throw new Error("Destination hors du plateau.");
            }

            const dx = Math.abs(destX - x);
            const dy = Math.abs(destY - y);
            const isAdjacent = (dx === 1 && dy === 0) || (dx === 0 && dy === 1);

            if (!isAdjacent) {
                throw new Error("Déplacement invalide : Vous ne pouvez bouger que d'une case orthogonalement.");
            }

            if (gameState.board[destY][destX] !== null) {
                throw new Error("La case de destination est occupée !");
            }

            gameState.board[destY][destX] = piece; // Place la pièce sur la nouvelle case
            gameState.board[y][x] = null;          // Vide l'ancienne case

            console.log(`Joueur ${playerId} déplace ${piece.type} de (${x},${y}) vers (${destX},${destY})`);
            break;

        case 'ROTATE':
            if (!piece) {
                throw new Error("No piece at selected position.");
            }
            if (piece.player !== playerId) { throw new Error("You can only move your own pieces."); }
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

                if (gameState.turnCount === 100) {
                    gameState.winner[0] = gameState.winner[1] = true;
                }
                else if (piece.type === 'Pharaoh') {
                    // Win Condition
                    let winningPlayer = (piece.player + 1) % 2;
                    gameState.winner[winningPlayer] = true;
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