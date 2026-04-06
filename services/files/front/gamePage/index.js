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
    initPlayerControls,
    showReconnectOverlay,
    hideReconnectOverlay
} from './offboardUI.js';
import {
    animateLaserSequence
} from './laserAnimator.js';
import {
    cellClickListner,
    initDraggableReserve,
    initRotationButtons
} from './interactionManager.js';

import { notificationManager } from "../js/notificationManager.js";

// ========== INITIALIZATION ==========

const boardElement = document.getElementById('board');

export const gameId = sessionStorage.getItem("gameId") || sessionStorage.getItem("activeGameId");

let hasJoined = false; // Guards against re-emitting game:join on initial connect

document.addEventListener('DOMContentLoaded', async () => {
    await initializeConnection();

    // Read online player assignment from sessionStorage (set by matchmaking)
    // Fall back to activeGameId/activePlayerId when rejoining after a leave
    const isRejoin = !sessionStorage.getItem("gameId") && !!sessionStorage.getItem("activeGameId");
    if (isRejoin) {
        state.gameMode = 'online';
        state.myPlayerId = parseInt(sessionStorage.getItem("activePlayerId") || '0', 10);
    } else {
        state.gameMode = sessionStorage.getItem("gameMode") || 'local';
        const storedPlayerId = sessionStorage.getItem("playerId");
        state.myPlayerId = storedPlayerId !== null ? parseInt(storedPlayerId, 10) : null;
    }

    console.log(`[GamePage] Mode: ${state.gameMode}, My Player ID: ${state.myPlayerId}`);

    // Display player usernames in online mode
    if (state.gameMode === 'online') {
        const myUsername = sessionStorage.getItem("myUsername") || 'You';
        const opponentUsername = sessionStorage.getItem("opponentUsername") || 'Opponent';
        const myElo = sessionStorage.getItem("myElo");
        const opponentElo = sessionStorage.getItem("opponentElo");

        // "current-player" panel is at the bottom, "opposing-player" at the top
        const currentPlayerLabel = document.querySelector('.current-player p');
        const opposingPlayerLabel = document.querySelector('.opposing-player p');

        if (state.myPlayerId === 0) {
            currentPlayerLabel.firstChild.textContent = myUsername + " ";
            opposingPlayerLabel.firstChild.textContent = opponentUsername + " ";
            updateEloDisplays(myElo, opponentElo);
        } else {
            // Player 1 (red) — swap reserve pyramid colors
            currentPlayerLabel.firstChild.textContent = myUsername + " ";
            opposingPlayerLabel.firstChild.textContent = opponentUsername + " ";
            updateEloDisplays(myElo, opponentElo);

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
    const resolvedGameId = sessionStorage.getItem("gameId") || sessionStorage.getItem("activeGameId");

    if (resolvedGameId) {
        console.log(`[GamePage] ${isRejoin ? 'Rejoining' : 'Joining'} game:`, resolvedGameId);
        socket.emit('game:join', { gameId: resolvedGameId, playerId: state.myPlayerId });
        sessionStorage.setItem('activeGameId', resolvedGameId);
        sessionStorage.setItem('activePlayerId', String(state.myPlayerId));
        hasJoined = true;
    } else {
        console.error("No Game ID found. Redirecting to home...");
        window.location.href = "../index.html";
    }

    notificationManager.init();

});

// ========== RESERVE LISTENERS ==========

function initReserveListeners() {
    let bottomPlayerId = 0;
    let topPlayerId = 1;

    if (state.gameMode === 'online' && state.myPlayerId === 1) {
        bottomPlayerId = 1;
        topPlayerId = 0;
    }

    initPlayerControls(bottomPlayerId, 'p1-reserve-piece', 'btn-p1-left', 'btn-p1-right');
    initPlayerControls(topPlayerId, 'p2-reserve-piece', 'btn-p2-left', 'btn-p2-right');
}

// ========== SOCKET EVENT HANDLERS ==========

socket.on('game:init', (gameState) => {
    console.log("State received from server!", gameState);
    // Close game-over modal if it's open (e.g. after restart vote)
    document.getElementById('gameOverModal').style.display = 'none';

    // Synchronize the DOM with the stored Elo ratings upon game start or rematch
    if (state.gameMode === 'online') {
        const latestMyElo = sessionStorage.getItem("myElo");
        const latestOppElo = sessionStorage.getItem("opponentElo");
        updateEloDisplays(latestMyElo, latestOppElo);
    }

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
    sessionStorage.removeItem('activeGameId');
    sessionStorage.removeItem('activePlayerId');
    sessionStorage.removeItem('activeGameExpiresAt');
    hideReconnectOverlay();
    setTimeout(() => {
        gameOverManager(winner);
    }, 3000);
})

socket.on('game:stats_update', (stats) => {
    console.log("[GamePage] Stats updated:", stats);

    if (state.myPlayerId === 0) {
        sessionStorage.setItem("myElo", stats[0].elo);
        sessionStorage.setItem("opponentElo", stats[1].elo);
        sessionStorage.setItem("myCoins", stats[0].deltaCoins);
        sessionStorage.setItem("opponentCoins", stats[1].deltaCoins);
    } else if (state.myPlayerId === 1) {
        sessionStorage.setItem("myElo", stats[1].elo);
        sessionStorage.setItem("opponentElo", stats[0].elo);
        sessionStorage.setItem("myCoins", stats[1].deltaCoins);
        sessionStorage.setItem("opponentCoins", stats[0].deltaCoins);
    }
});

socket.on('game:player_disconnected', ({ playerId, timeoutSeconds }) => {
    if (playerId === state.myPlayerId) {
        showReconnectOverlay('You disconnected. Reconnecting...', null);
    } else {
        showReconnectOverlay('Opponent disconnected', timeoutSeconds);
    }
});

socket.on('game:player_reconnected', () => {
    hideReconnectOverlay();
});

// Socket.IO auto-reconnect — re-join the game if we were in one
socket.on('connect', () => {
    if (!hasJoined) return;
    const activeGameId = sessionStorage.getItem('activeGameId');
    const activePlayerId = sessionStorage.getItem('activePlayerId');
    if (activeGameId && activePlayerId !== null) {
        console.log('[GamePage] Reconnected — rejoining game:', activeGameId);
        socket.emit('game:join', {
            gameId: activeGameId,
            playerId: parseInt(activePlayerId)
        });
    }
});

socket.on('game:error', (data) => {
    alert(data.message);
});

// Restart vote progress (online only)
socket.on('game:restart_vote', (data) => {
    console.log(`[Game] Restart vote: ${data.votes}/${data.needed}`);
    updateRestartVoteStatus(data);
});

// Header leave button
document.getElementById('leaveBtn').addEventListener('click', () => {
    if (state.gameMode === 'online') {
        if (confirm('Leave the game? You have 60 seconds to rejoin before your opponent wins.')) {
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

// ========== ELO DISPLAY LOGIC ==========

function computeEloChange(playerElo, opponentElo, result, K = 20) {
    const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
    return Math.round(K * (result - expected));
}

function updateEloDisplays(myElo, opponentElo) {
    const p1EloSpan = document.getElementById('p1-elo');
    const p2EloSpan = document.getElementById('p2-elo');
    const p1PotentialDiv = document.getElementById('p1-elo-potential');
    const p2PotentialDiv = document.getElementById('p2-elo-potential');

    if (myElo && p1EloSpan) p1EloSpan.textContent = `(${myElo})`;
    if (opponentElo && p2EloSpan) p2EloSpan.textContent = `(${opponentElo})`;

    if (myElo && opponentElo && p1PotentialDiv && p2PotentialDiv) {
        const mE = parseInt(myElo);
        const oE = parseInt(opponentElo);

        const myWin = computeEloChange(mE, oE, 1);
        const myDraw = computeEloChange(mE, oE, 0.5);
        const myLoss = computeEloChange(mE, oE, 0);

        const oppWin = computeEloChange(oE, mE, 1);
        const oppDraw = computeEloChange(oE, mE, 0.5);
        const oppLoss = computeEloChange(oE, mE, 0);

        const formatPotential = (win, draw, loss) => `Potential: <span class="elo-win">W: ${win > 0 ? '+' + win : win}</span> | <span class="elo-draw">D: ${draw > 0 ? '+' + draw : draw}</span> | <span class="elo-loss">L: ${loss > 0 ? '+' + loss : loss}</span>`;

        p1PotentialDiv.style.display = 'block';
        p2PotentialDiv.style.display = 'block';
        p1PotentialDiv.innerHTML = formatPotential(myWin, myDraw, myLoss);
        p2PotentialDiv.innerHTML = formatPotential(oppWin, oppDraw, oppLoss);
    } else {
        if (p1PotentialDiv) p1PotentialDiv.style.display = 'none';
        if (p2PotentialDiv) p2PotentialDiv.style.display = 'none';
    }
}