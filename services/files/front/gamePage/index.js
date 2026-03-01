/**
 * index.js
 * Main entry point - orchestrates all managers and handles socket events
 */

import { state } from './gameState.js';
import { socket } from './networkManager.js';
import { initializeConnection } from "./networkManager.js";

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
    updateRestartVoteStatus,
    leaveGame,
    goHome,
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

document.addEventListener('DOMContentLoaded', async () => {
    await initializeConnection();

    // Read online player assignment from sessionStorage (set by matchmaking)
    state.gameMode = sessionStorage.getItem("gameMode") || 'local';
    const storedPlayerId = sessionStorage.getItem("playerId");
    state.myPlayerId = storedPlayerId !== null ? parseInt(storedPlayerId, 10) : null;

    console.log(`[GamePage] Mode: ${state.gameMode}, My Player ID: ${state.myPlayerId}`);

    // Display player usernames in online mode
    if (state.gameMode === 'online') {
        const myUsername = sessionStorage.getItem("myUsername") || 'You';
        const opponentUsername = sessionStorage.getItem("opponentUsername") || 'Opponent';

        // "current-player" panel is at the bottom, "opposing-player" at the top
        const currentPlayerLabel = document.querySelector('.current-player p');
        const opposingPlayerLabel = document.querySelector('.opposing-player p');

        if (state.myPlayerId === 0) {
            currentPlayerLabel.textContent = myUsername;
            opposingPlayerLabel.textContent = opponentUsername;
        } else {
            // Player 1 (red) — swap reserve pyramid colors
            currentPlayerLabel.textContent = myUsername;
            opposingPlayerLabel.textContent = opponentUsername;

            // Swap reserve pyramid images to match player colors
            const p1Img = document.getElementById('p1-reserve-piece');
            const p2Img = document.getElementById('p2-reserve-piece');
            p1Img.src = 'assets/red_pyramid.png';
            p1Img.alt = 'red_pyramid';
            p2Img.src = 'assets/green_pyramid.png';
            p2Img.alt = 'green_pyramid';
        }
    }

    // A. Initialiser l'UI (Graphismes)
    initBoard();

    initDraggableReserve();
    initReserveListeners();
    initRotationButtons();

    // Setup listeners
    cellClickListner(boardElement);

    // B. Rejoindre la partie (Une fois connecté)
    const gameId = sessionStorage.getItem("gameId");

    if (gameId) {
        console.log("Found Game ID in storage:", gameId);
        socket.emit('game:join', { gameId: gameId, playerId: state.myPlayerId });
    } else {
        console.error("No Game ID found. Redirecting to home...");
        window.location.href = "../index.html";
    }
});

// ========== RESERVE LISTENERS ==========

function initReserveListeners() {
    if (state.gameMode === 'online' && state.myPlayerId === 1) {
        // Player 1: bottom panel = Player 1, top panel = Player 0
        initPlayerControls(1, 'p1-reserve-piece', 'btn-p1-left', 'btn-p1-right');
        initPlayerControls(0, 'p2-reserve-piece', 'btn-p2-left', 'btn-p2-right');
    } else {
        initPlayerControls(0, 'p1-reserve-piece', 'btn-p1-left', 'btn-p1-right');
        initPlayerControls(1, 'p2-reserve-piece', 'btn-p2-left', 'btn-p2-right');
    }
}

// ========== SOCKET EVENT HANDLERS ==========

socket.on('game:init', (gameState) => {
    console.log("State received from server!", gameState);
    // Close game-over modal if it's open (e.g. after restart vote)
    document.getElementById('gameOverModal').style.display = 'none';
    finalizeTurn(gameState);
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

// Restart vote progress (online only)
socket.on('game:restart_vote', (data) => {
    console.log(`[Game] Restart vote: ${data.votes}/${data.needed}`);
    updateRestartVoteStatus(data);
});

// A player left — both go home
socket.on('game:player_left', () => {
    console.log('[Game] A player left the game');
    alert('A player has left the game.');
    goHome();
});

// Header leave button
document.getElementById('leaveBtn').addEventListener('click', () => {
    if (state.gameMode === 'online') {
        if (confirm('Leave the game? Both players will be returned to the homepage.')) {
            leaveGame();
        }
    } else {
        goHome();
    }
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