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
import { TokenManager } from "../js/tokenManager.js";

// ========== INITIALIZATION ==========

const boardElement = document.getElementById('board');

export const gameId = sessionStorage.getItem("gameId") || localStorage.getItem("activeGameId");

let hasJoined = false; // Guards against re-emitting game:join on initial connect

document.addEventListener('DOMContentLoaded', async () => {
    await initializeConnection();

    // Read online player assignment from sessionStorage (set by matchmaking)
    // Fall back to activeGameId/activePlayerId when rejoining after a leave
    const isRejoin = !sessionStorage.getItem("gameId") && !!localStorage.getItem("activeGameId");
    if (isRejoin) {
        state.gameMode = 'online';
        state.myPlayerId = parseInt(localStorage.getItem("activePlayerId") || '0', 10);
    } else {
        state.gameMode = sessionStorage.getItem("gameMode") || 'local';
        const storedPlayerId = sessionStorage.getItem("playerId");
        state.myPlayerId = storedPlayerId !== null ? parseInt(storedPlayerId, 10) : null;
    }

    console.log(`[GamePage] Mode: ${state.gameMode}, My Player ID: ${state.myPlayerId}`);

    // Display player usernames in online mode
    if (state.gameMode === 'online') {
        const myUsername = sessionStorage.getItem("myUsername") || localStorage.getItem("activeMyUsername") || 'You';
        const opponentUsername = sessionStorage.getItem("opponentUsername") || localStorage.getItem("activeOpponentUsername") || 'Opponent';
        const myElo = sessionStorage.getItem("myElo") || localStorage.getItem("activeMyElo");
        const opponentElo = sessionStorage.getItem("opponentElo") || localStorage.getItem("activeOpponentElo");

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
    const resolvedGameId = sessionStorage.getItem("gameId") || localStorage.getItem("activeGameId");

    if (resolvedGameId) {
        console.log(`[GamePage] ${isRejoin ? 'Rejoining' : 'Joining'} game:`, resolvedGameId);
        socket.emit('game:join', { gameId: resolvedGameId, playerId: state.myPlayerId });
        localStorage.setItem('activeGameId', resolvedGameId);
        localStorage.setItem('activePlayerId', String(state.myPlayerId));
        if (state.gameMode === 'online') {
            localStorage.setItem('activeMyUsername', sessionStorage.getItem('myUsername') || '');
            localStorage.setItem('activeOpponentUsername', sessionStorage.getItem('opponentUsername') || '');
            localStorage.setItem('activeMyElo', sessionStorage.getItem('myElo') || '');
            localStorage.setItem('activeOpponentElo', sessionStorage.getItem('opponentElo') || '');
        }
        hasJoined = true;
    } else {
        console.error("No Game ID found. Redirecting to home...");
        window.location.href = "../index.html";
    }

    notificationManager.init();

    // Load inventory emotes and player avatar
    const token = TokenManager.getAccessToken();
    if (token) {
        loadInventoryForGame(token);
    } else {
        renderBrokie();
    }
});

// ========== INVENTORY / EMOTES / AVATAR ==========

async function loadInventoryForGame(token) {
    try {
        const res = await fetch('/api/market/inventory', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) { renderBrokie(); return; }
        const data = await res.json();
        const inventory = data.inventory || [];

        const emotes = inventory.filter(i => i.type === 'emote');
        const equippedPic = inventory.find(i => i.type === 'profile_picture' && i.equipped);

        renderEmotePicker(emotes);
        if (equippedPic) renderMyAvatar(equippedPic.assetPath);

        // Load opponent avatar for online games
        if (state.gameMode === 'online') {
            const opponentUsername = sessionStorage.getItem('opponentUsername') || localStorage.getItem('activeOpponentUsername');
            if (opponentUsername) loadOpponentAvatar(opponentUsername);
        }
    } catch (err) {
        console.error('[Game] Failed to load inventory:', err);
        renderBrokie();
    }
}

async function loadOpponentAvatar(username) {
    try {
        const res = await fetch(`/api/market/avatar/${encodeURIComponent(username)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.assetPath) {
            const avatar = document.getElementById('p2-avatar');
            if (avatar) {
                avatar.src = `/api/market/${data.assetPath}`;
                avatar.classList.add('loaded');
            }
        }
    } catch (err) {
        console.error('[Game] Failed to load opponent avatar:', err);
    }
}

function renderEmotePicker(emotes) {
    const picker = document.getElementById('emotePicker');
    if (!picker) return;
    picker.innerHTML = '';

    if (emotes.length === 0) {
        renderBrokie();
        return;
    }

    emotes.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'emote-btn';
        btn.title = item.name;
        const img = document.createElement('img');
        img.src = `/api/market/${item.assetPath}`;
        img.alt = item.name;
        btn.appendChild(img);
        btn.addEventListener('click', () => sendEmote(item));
        picker.appendChild(btn);
    });
}

function renderBrokie() {
    const picker = document.getElementById('emotePicker');
    if (!picker) return;
    picker.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'brokie-placeholder';
    div.innerHTML = '<span class="brokie-icon">💸</span>No emotes — open lootboxes in the shop!';
    picker.appendChild(div);
}

function renderMyAvatar(assetPath) {
    // Current player is always p1-avatar (bottom panel)
    const avatar = document.getElementById('p1-avatar');
    if (!avatar) return;
    avatar.src = `/api/market/${assetPath}`;
    avatar.classList.add('loaded');
}

function sendEmote(item) {
    if (!socket.connected) return;
    const senderUsername = sessionStorage.getItem('myUsername') || localStorage.getItem('activeMyUsername') || sessionStorage.getItem('username') || 'You';
    socket.emit('engine:emoji-send', {
        gameId: gameId,
        assetPath: item.assetPath,
        rarity: item.rarity,
        senderUsername
    });
}

function appendEmoteMessage(assetPath, senderUsername, rarity) {
    const display = document.getElementById('emoteDisplay');
    const empty = document.getElementById('emoteEmpty');
    if (!display) return;
    if (empty) empty.style.display = 'none';

    const msg = document.createElement('div');
    msg.className = `emote-msg emote-msg-rarity-${rarity || 'common'}`;

    const img = document.createElement('img');
    img.className = 'emote-msg-img';
    img.src = `/api/market/${assetPath}`;
    img.alt = senderUsername;

    const sender = document.createElement('span');
    sender.className = 'emote-msg-sender';
    sender.textContent = senderUsername;

    msg.appendChild(img);
    msg.appendChild(sender);
    display.appendChild(msg);
    display.scrollTop = display.scrollHeight;
}

socket.on('engine:emoji-receive', (data) => {
    appendEmoteMessage(data.assetPath, data.senderUsername || 'Opponent', data.rarity);
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
    localStorage.removeItem('activeGameId');
    localStorage.removeItem('activePlayerId');
    localStorage.removeItem('activeGameExpiresAt');
    localStorage.removeItem('activeMyUsername');
    localStorage.removeItem('activeOpponentUsername');
    localStorage.removeItem('activeMyElo');
    localStorage.removeItem('activeOpponentElo');
    // Clear game session keys
    sessionStorage.removeItem('myUsername');
    sessionStorage.removeItem('opponentUsername');
    sessionStorage.removeItem('myElo');
    sessionStorage.removeItem('opponentElo');
    sessionStorage.removeItem('myCoins');
    sessionStorage.removeItem('opponentCoins');
    // Clear cached profile stats so profileManager refetches fresh data from server
    sessionStorage.removeItem('elo');
    sessionStorage.removeItem('coins');
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
        localStorage.setItem("activeMyElo", stats[0].elo);
        localStorage.setItem("activeOpponentElo", stats[1].elo);
    } else if (state.myPlayerId === 1) {
        sessionStorage.setItem("myElo", stats[1].elo);
        sessionStorage.setItem("opponentElo", stats[0].elo);
        sessionStorage.setItem("myCoins", stats[1].deltaCoins);
        sessionStorage.setItem("opponentCoins", stats[0].deltaCoins);
        localStorage.setItem("activeMyElo", stats[1].elo);
        localStorage.setItem("activeOpponentElo", stats[0].elo);
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
    const activeGameId = localStorage.getItem('activeGameId');
    const activePlayerId = localStorage.getItem('activePlayerId');
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

// A player left
socket.on('game:player_left', () => {
    console.log('[Game] A player left the game');
    const modal = document.getElementById('gameOverModal');
    if (modal && modal.style.display === 'flex') {
        // Game already over — opponent left the results screen, just disable restart
        const restartBtn = document.getElementById('restartBtn');
        const voteStatus = document.getElementById('voteStatus');
        if (restartBtn) restartBtn.style.display = 'none';
        if (voteStatus) { voteStatus.style.display = 'block'; voteStatus.textContent = 'Opponent left.'; }
    } else {
        alert('A player has left the game.');
        goHome();
    }
});

// Emote panel burger toggle (small screens)
const emoteToggleBtn = document.getElementById('emoteToggleBtn');
const chatMovesSec = document.querySelector('.chat-moves-sec');
if (emoteToggleBtn && chatMovesSec) {
    emoteToggleBtn.addEventListener('click', () => {
        chatMovesSec.classList.toggle('emote-open');
    });
    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (chatMovesSec.classList.contains('emote-open') &&
            !chatMovesSec.contains(e.target) &&
            !emoteToggleBtn.contains(e.target)) {
            chatMovesSec.classList.remove('emote-open');
        }
    });
}

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