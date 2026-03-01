/**
 * boardRenderer.js
 * Handles the rendering of the game board (grid and pieces)
 */

import { state } from './gameState.js';
import { sendPlaceAction } from './networkManager.js';
import { calculateCooldown } from './offboardUI.js';

// Helper: map grid position based on player perspective
// For Player 1 in online mode, flip the board so their pieces are at the bottom
function mapGridPosition(row, col) {
    if (state.gameMode === 'online' && state.myPlayerId === 1) {
        return { gridRow: 10 - row, gridCol: 10 - col };
    }
    return { gridRow: row + 1, gridCol: col + 1 };
}

// Helper to get board element
function getBoardElement() {
    return document.getElementById('board');
}

// ========== BOARD INITIALIZATION ==========

export function initBoard() {
    const boardElement = getBoardElement();
    boardElement.innerHTML = '';

    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
            const pieceDiv = document.createElement('div');
            pieceDiv.classList.add('case');

            pieceDiv.dataset.row = row;
            pieceDiv.dataset.col = col;

            // Map to visual grid position (flipped for Player 1)
            const { gridRow, gridCol } = mapGridPosition(row, col);
            pieceDiv.style.gridRowStart = gridRow;
            pieceDiv.style.gridColumnStart = gridCol;

            // Allows hovering by another element
            pieceDiv.addEventListener('dragover', (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                pieceDiv.classList.add('drag-hover');
            });

            // Clean up when there is no more element hovering over the cell
            pieceDiv.addEventListener('dragleave', () => {
                pieceDiv.classList.remove('drag-hover');
            });


            // Manage the drop of a pyramid after a drag and drop action (PLACE)
            pieceDiv.addEventListener('drop', (event) => {
                event.preventDefault();
                pieceDiv.classList.remove('drag-hover');

                const actionType = event.dataTransfer.getData('actionType');
                const originPlayerId = event.dataTransfer.getData('playerId');
                const orientationStr = event.dataTransfer.getData('orientation');

                if (actionType === 'PLACE' && originPlayerId !== null) {
                    const x = parseInt(pieceDiv.dataset.col, 10);
                    const y = parseInt(pieceDiv.dataset.row, 10);

                    const playerId = parseInt(originPlayerId, 10);

                    const orientation = orientationStr ? parseInt(orientationStr, 10) : 0;

                    sendPlaceAction(x, y, orientation, playerId);
                }
            });

            boardElement.appendChild(pieceDiv);
        }
    }
}

// ========== PIECE RENDERING ==========

export function updatePieces(boardData) {
    const boardElement = getBoardElement();
    const cells = boardElement.children;

    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {

            const index = row * 10 + col;
            const cell = cells[index];
            const pieceData = boardData[row][col];

            cell.innerHTML = '';

            if (pieceData) {
                const img = createPieceImage(pieceData);
                cell.appendChild(img);
            }
        }
    }
}

export function createPieceImage(pieceData) {
    const pieceIMG = document.createElement('img');
    const color = pieceData.player === 0 ? 'green' : 'red';
    const type = pieceData.type.toLowerCase();

    pieceIMG.src = `assets/${color}_${type}.png`;
    pieceIMG.alt = `${color} ${type}`;
    pieceIMG.classList.add('piece-image');
    pieceIMG.classList.add(type);

    let degree = 0;
    let scaleY = 1;
    let scale = 1;
    let translateY = 0;

    // For Player 1's flipped board, remap orientation by +2 (mod 4)
    // This is equivalent to viewing from the opposite side of the board
    // and correctly handles the sphinx's special scaleY rendering
    let orientation = pieceData.orientation;
    if (state.gameMode === 'online' && state.myPlayerId === 1) {
        orientation = (orientation + 2) % 4;
    }

    if (["anubis", "scarab"].includes(type)) {
        scale = 1.5;
    } else if (type === "pharaoh") {
        scale = 1.25;
        translateY = 7;
    }

    if (type === "pharaoh") {
        degree = 0;
    }
    else if (type === "sphinx") {
        switch (orientation) {
            case 0: degree = -90; break;
            case 1: degree = 0; break;
            case 2: degree = 90; break;
            case 3: degree = 180; break;
        }

        if (orientation === 3) {
            scaleY = scaleY * -1;
        }
    }
    else if (type === "scarab") {
        degree = 90 * (orientation) - 45;
    }
    else if (type === "pyramid") {
        degree = 90 * (orientation) - 90;
    }
    else {
        degree = 90 * (orientation) - 180;
    }

    pieceIMG.style.transform = `rotate(${degree}deg) scaleY(${scaleY}) scale(${scale}) translateY(${translateY}%)`;

    return pieceIMG;
}

export function removePieceFromBoard(x, y) {
    const cell = document.querySelector(`.case[data-row='${y}'][data-col='${x}']`);
    if (cell) {
        cell.innerHTML = '';

        // Optional: add css animation for the disappearance
    }
}

// ========== ROTATION BUTTONS ==========

export function updateRotationButtons(piece) {
    const btnRotateLeft = document.getElementById('btn-rotate-left');
    const btnRotateRight = document.getElementById('btn-rotate-right');

    btnRotateLeft.disabled = true;
    btnRotateRight.disabled = true;

    if (!piece) return;

    if (piece.type === 'Pharaoh') {
        console.log("Pharaon sélectionné : Rotation impossible");
        return;
    }

    btnRotateLeft.disabled = false;
    btnRotateRight.disabled = false;
}

// ========== VISUAL SELECTION & VALID MOVES ==========

export function updateVisualSelection() {
    const allCases = document.querySelectorAll('.case');
    allCases.forEach(c => {
        c.classList.remove('selected');
        c.classList.remove('valid-move');
        c.classList.remove('swap-target');
    });

    if (!state.selectedPiece) {
        updateRotationButtons(null);
        return;
    }

    if (state.selectedPiece) {
        const cell = document.querySelector(`.case[data-row='${state.selectedPiece.y}'][data-col='${state.selectedPiece.x}']`);
        if (cell) {
            cell.classList.add('selected');
        }
    }

    if (state.currentGameState && state.currentGameState.board) {
        const piece = state.currentGameState.board[state.selectedPiece.y][state.selectedPiece.x];

        updateRotationButtons(piece);
        if (piece) {
            if (piece.type === 'Scarab') {
                showValidMoves(state.selectedPiece.x, state.selectedPiece.y);
                highlightSwapTargets(piece.player);
            } else if (piece.type === 'Anubis' || piece.type === 'Pyramid' || piece.type === 'Scarab') {
                showValidMoves(state.selectedPiece.x, state.selectedPiece.y);
            }
        }
    }
}

export function showValidMoves(x, y) {
    const directions = [
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 }
    ];

    directions.forEach(dir => {
        const targetX = x + dir.dx;
        const targetY = y + dir.dy;

        if (targetX >= 0 && targetX < 10 && targetY >= 0 && targetY < 10) {
            const targetPiece = state.currentGameState.board[targetY][targetX];
            if (!targetPiece) {
                const targetCell = document.querySelector(`.case[data-row='${targetY}'][data-col='${targetX}']`);
                if (targetCell) {
                    targetCell.classList.add('valid-move');
                }
            }
        }
    });
}

export function highlightSwapTargets(playerId) {
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const targetPiece = state.currentGameState.board[y][x];

            if (targetPiece) {
                if (targetPiece.player === playerId &&
                    (targetPiece.type === 'Sphinx' || targetPiece.type === 'Pharaoh')) {

                    const cooldown = calculateCooldown(state.currentGameState, playerId, targetPiece.type);
                    if (cooldown === 0) {
                        const cell = document.querySelector(`.case[data-row='${y}'][data-col='${x}']`);
                        if (cell) cell.classList.add('swap-target');
                    }
                }
            }
        }
    }
}
