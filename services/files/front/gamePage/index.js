/**
 * index.js
 * Main entry point - orchestrates all managers and handles socket events
 */

import { state } from './gameState.js';
import { socket } from './networkManager.js';
import {
    initBoard,
    updatePieces,
    updateVisualSelection
} from './boardRenderer.js';
import {
    updatePyramidReserve,
    updateCooldownDisplay,
    updateTurnIndicator,
    gameOverManager,
    initPlayerControls
} from './offboardUI.js';
import {
    animateLaserSequence
} from './laserAnimator.js';
import {
    cellClickListner,
    initDraggableReserve,
    initRotationButtons
} from './interactionManager.js';

// ========== INITIALIZATION ==========

const boardElement = document.getElementById('board');

export const gameId = sessionStorage.getItem("gameId");

if (gameId) {
    console.log("Found Game ID in storage:", gameId);
    socket.emit('game:join', { gameId: gameId });
    sessionStorage.removeItem('gameId'); 
} else {
    console.error("No Game ID found. Redirecting to home...");
    window.location.href = "../index.html";
}


// Initialize UI
initBoard();
initDraggableReserve();
initReserveListeners();
initRotationButtons();

// Setup interaction listeners
cellClickListner(boardElement);

// ========== RESERVE LISTENERS ==========

function initReserveListeners() {
    initPlayerControls(0, 'p1-reserve-piece', 'btn-p1-left', 'btn-p1-right');
    initPlayerControls(1, 'p2-reserve-piece', 'btn-p2-left', 'btn-p2-right');
}

// ========== SOCKET EVENT HANDLERS ==========

socket.on('game:init', (gameState) => {
    console.log("State received from server!", gameState);
    finalizeTurn(gameState)
});

socket.on('game:action_response', (gameState) => {
    console.log("State received from server!", gameState);
    if (gameState.boardAfterMove) {
        updatePieces(gameState.boardAfterMove);
    }

    if (gameState.laserResult && gameState.laserResult.path && gameState.laserResult.path.length > 0) {
        animateLaserSequence(gameState.laserResult, state.currentGameState.turn === 0 ? "green" : "red").then(() => {
            finalizeTurn(gameState.finalState);
        });
    }
    else {
        finalizeTurn(gameState.finalState);
    }
});

socket.on('game:over', (winner) => {
    setTimeout(() => {
        gameOverManager(winner);
    }, 3000);
})

socket.on('game:error', (data) => {
    alert(data.message);
});

// ========== TURN FINALIZATION ==========

function finalizeTurn(gameState) {
    state.currentGameState = gameState;
    updatePieces(gameState.board);
    updatePyramidReserve(gameState.reserves);
    updateCooldownDisplay(gameState);
    updateTurnIndicator(gameState);
    updateVisualSelection();
}