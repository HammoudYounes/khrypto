/**
 * interactionManager.js
 * Manages user interactions: clicks, drag & drop, piece selection
 */

import { state } from './gameState.js';
import { sendMoveAction, sendSwapAction, sendRotateAction, sendPlaceAction } from './networkManager.js';
import { updateVisualSelection, updateRotationButtons } from './boardRenderer.js';

// ========== DRAG & DROP SETUP ==========

export function initDraggableReserve() {
    // Determine which player ID the bottom/top panels represent
    let bottomPlayerId = 0;
    let topPlayerId = 1;
    if (state.gameMode === 'online' && state.myPlayerId === 1) {
        bottomPlayerId = 1;
        topPlayerId = 0;
    } else if (state.gameMode === 'online' && state.myPlayerId === 0) {
        bottomPlayerId = 0;
        topPlayerId = 1;
    }

    const p1Img = document.querySelector('.current-player .piece-image');
    if (p1Img) setupDraggableItem(p1Img, bottomPlayerId);

    const p2Img = document.querySelector('.opposing-player .piece-image');
    if (p2Img) setupDraggableItem(p2Img, topPlayerId);
}

export function setupDraggableItem(img, playerId) {
    img.setAttribute('draggable', true);
    img.style.cursor = 'grab';

    img.addEventListener('dragstart', (event) => {
        // In online mode, only allow dragging on your turn
        if (state.gameMode === 'online' && state.currentGameState && state.currentGameState.turn !== state.myPlayerId) {
            event.preventDefault();
            return;
        }

        deselectReserve();

        const actionType = img.closest('.player-info-sec') ? 'PLACE' : 'SWAP';
        event.dataTransfer.setData('actionType', 'PLACE');
        event.dataTransfer.setData('playerId', playerId.toString());

        const currentOrientation = state.reserveOrientations[playerId];
        event.dataTransfer.setData('orientation', currentOrientation.toString());

        event.dataTransfer.effectAllowed = 'copy';
        console.log(`Drag started: Pyramide Joueur ${playerId + 1} (ID: ${playerId})`);
    });

    img.addEventListener('click', () => {
        if (state.gameMode === 'online' && state.currentGameState && state.currentGameState.turn !== state.myPlayerId) {
            return;
        }
        
        if (state.selectedReservePieceId === playerId) {
            deselectReserve();
        } else {
            selectReserve(playerId);
        }
    });
}

// ========== CELL CLICK HANDLING ==========

export function cellClickListner(boardElement) {
    boardElement.addEventListener('click', (event) => {
        const clickedCell = event.target.closest('.case');

        if (!clickedCell) {
            deselect();
            return;
        }

        const y = parseInt(clickedCell.dataset.row, 10);
        const x = parseInt(clickedCell.dataset.col, 10);

        console.log(`Selected Cell : Row ${y}, Col ${x}`);

        handleCellClick(x, y);
    });

}

function handleCellClick(x, y) {
    if (!state.currentGameState) return;

    // In online mode, block all actions when it's not your turn
    if (state.gameMode === 'online' && state.currentGameState.turn !== state.myPlayerId) return;

    const clickedPiece = state.currentGameState.board[y][x];

    const currentPlayerId = state.currentGameState.turn;

    if (state.selectedReservePieceId !== null) {
        if (!clickedPiece) {
            const orientation = state.reserveOrientations[state.selectedReservePieceId];
            sendPlaceAction(x, y, orientation, state.selectedReservePieceId);
        }
        deselectReserve();
        return;
    }

    if (!state.selectedPiece) {
        if (clickedPiece && clickedPiece.player === currentPlayerId) {
            selectPiece(x, y);
            updateRotationButtons(clickedPiece);
        }
        return;
    }

    if (state.selectedPiece.x === x && state.selectedPiece.y === y) {
        deselect();
        return;
    }

    if (!clickedPiece) {
        const dx = Math.abs(x - state.selectedPiece.x);
        const dy = Math.abs(y - state.selectedPiece.y);
        const isAdjacent = (dx === 1 && dy === 0) || (dx === 0 && dy === 1);

        if (isAdjacent) {
            sendMoveAction(state.selectedPiece.x, state.selectedPiece.y, x, y);
        }
        deselect();
        return;
    }

    const originPiece = state.currentGameState.board[state.selectedPiece.y][state.selectedPiece.x];

    if (originPiece && (originPiece.type === 'Scarab')) {
        if (clickedPiece && clickedPiece.player === currentPlayerId &&
            (clickedPiece.type === 'Sphinx' || clickedPiece.type === 'Pharaoh')) {
            sendSwapAction(state.selectedPiece.x, state.selectedPiece.y, x, y, currentPlayerId);
            deselect();
            return;
        }
    }

    if (clickedPiece && clickedPiece.player === currentPlayerId) {
        selectPiece(x, y);
        updateRotationButtons(clickedPiece);
    } else {
        deselect();
    }
}

// ========== SELECTION LOGIC ==========

export function selectPiece(x, y) {
    state.selectedPiece = { x, y };
    state.selectedReservePieceId = null;
    updateVisualSelection();
}

export function deselect() {
    state.selectedPiece = null;
    state.selectedReservePieceId = null;
    updateVisualSelection();
}

export function selectReserve(playerId) {
    state.selectedReservePieceId = playerId;
    state.selectedPiece = null;
    updateVisualSelection();
}

export function deselectReserve() {
    state.selectedReservePieceId = null;
    updateVisualSelection();
}

// ========== ROTATION BUTTON LISTENERS ==========

export function initRotationButtons() {
    const btnRotateLeft = document.getElementById('btn-rotate-left');
    const btnRotateRight = document.getElementById('btn-rotate-right');

    btnRotateLeft.addEventListener('click', () => {
        if (state.gameMode === 'online' && state.currentGameState && state.currentGameState.turn !== state.myPlayerId) return;
        if (state.selectedPiece) {
            sendRotateAction(state.selectedPiece.x, state.selectedPiece.y, -1);
            deselect();
        }
    });

    btnRotateRight.addEventListener('click', () => {
        if (state.gameMode === 'online' && state.currentGameState && state.currentGameState.turn !== state.myPlayerId) return;
        if (state.selectedPiece) {
            sendRotateAction(state.selectedPiece.x, state.selectedPiece.y, 1);
            deselect();
        }
    });
}