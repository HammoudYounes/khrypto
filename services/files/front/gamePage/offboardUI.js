/**
 * offboardUI.js
 * Gère le rendu des éléments hors plateau (HUD, réserves, cooldowns, modal)
 */

import { state } from './gameState.js';
import { socket } from './networkManager.js';
import { gameId } from './index.js';

// ========== PYRAMID RESERVE ==========

export function updatePyramidReserve(reserves) {
    const bottomPlayerId = (state.gameMode === 'online' && state.myPlayerId === 1) ? 1 : 0;
    const topPlayerId = (state.gameMode === 'online' && state.myPlayerId === 1) ? 0 : 1;

    const countBottom = document.getElementById("p1-pyramid-count");
    const countTop = document.getElementById("p2-pyramid-count");

    if (countBottom) countBottom.innerHTML = reserves[bottomPlayerId].toString();
    if (countTop) countTop.innerHTML = reserves[topPlayerId].toString();
}

export function initPlayerControls(playerId, imgId, btnLeftId, btnRightId) {
    const img = document.getElementById(imgId);
    const btnLeft = document.getElementById(btnLeftId);
    const btnRight = document.getElementById(btnRightId);

    if (!img || !btnLeft || !btnRight) return;

    const updateVisual = () => {
        const orientation = state.reserveOrientations[playerId];
        let degree = (90 * orientation) - 90;
        // Flip the preview for Player 1's perspective
        if (state.gameMode === 'online' && state.myPlayerId === 1) {
            degree += 180;
        }
        img.style.transform = `rotate(${degree}deg)`;
    };

    updateVisual();

    btnLeft.addEventListener('click', () => {
        state.reserveOrientations[playerId] = (state.reserveOrientations[playerId] - 1 + 4) % 4;
        updateVisual();
    });

    btnRight.addEventListener('click', () => {
        state.reserveOrientations[playerId] = (state.reserveOrientations[playerId] + 1) % 4;
        updateVisual();
    });
}

// ========== COOLDOWN DISPLAY ==========

export function updateCooldownDisplay(gameState) {
    if (!gameState.swapHistory) return;

    const bottomPlayerId = (state.gameMode === 'online' && state.myPlayerId === 1) ? 1 : 0;
    const topPlayerId = (state.gameMode === 'online' && state.myPlayerId === 1) ? 0 : 1;

    const bottomSphinx = calculateCooldown(gameState, bottomPlayerId, 'Sphinx');
    const bottomPharaoh = calculateCooldown(gameState, bottomPlayerId, 'Pharaoh');
    const topSphinx = calculateCooldown(gameState, topPlayerId, 'Sphinx');
    const topPharaoh = calculateCooldown(gameState, topPlayerId, 'Pharaoh');

    document.getElementById('p1-sphinx-cooldown').textContent = bottomSphinx;
    document.getElementById('p1-pharaoh-cooldown').textContent = bottomPharaoh;
    document.getElementById('p2-sphinx-cooldown').textContent = topSphinx;
    document.getElementById('p2-pharaoh-cooldown').textContent = topPharaoh;
}

export function calculateCooldown(gameState, playerId, type) {
    const lastSwapTurn = gameState.swapHistory[playerId][type];
    const turnsPassed = gameState.turnCount - lastSwapTurn;
    if (turnsPassed < 8) {
        return Math.ceil((8 - turnsPassed) / 2);
    }
    return 0;
}

// ========== TURN INDICATOR ==========

export function updateTurnIndicator(gameState) {
    const p1Container = document.querySelector('.current-player');
    const p2Container = document.querySelector('.opposing-player');

    // Clear previous
    p1Container.classList.remove('turn-active');
    p2Container.classList.remove('turn-active');

    // Determine if it's MY turn (bottom panel) or opponent's (top panel)
    let isMyTurn;
    if (state.gameMode === 'online') {
        isMyTurn = gameState.turn === state.myPlayerId;
    } else {
        // Local/AI: Player 0 = bottom panel
        isMyTurn = gameState.turn === 0;
    }

    if (isMyTurn) {
        p1Container.classList.add('turn-active');
    } else {
        p2Container.classList.add('turn-active');
    }
}

// ========== GAME OVER MODAL ==========

export function gameOverManager(winners) {
    const modal = document.getElementById('gameOverModal');
    const messageElement = document.getElementById('victoryMessage');
    const restartBtn = document.getElementById('restartBtn');
    const leaveModalBtn = document.getElementById('leaveModalBtn');
    const voteStatus = document.getElementById('voteStatus');

    const isForfeit = !!winners.forfeit;
    const opponentUsername = sessionStorage.getItem('opponentUsername') || localStorage.getItem('activeOpponentUsername') || 'Opponent';
    let message = "";

    if (isForfeit) {
        const iWon = (winners[0] === true && state.myPlayerId === 0) ||
                     (winners[1] === true && state.myPlayerId === 1);
        message = iWon
            ? `${opponentUsername} disconnected — You win!`
            : `You left — ${opponentUsername} wins!`;
    } else if (winners[0] === true && winners[1] === true) {
        message = "Equality!";
    } else if (state.gameMode === 'online') {
        const winnerPlayerId = winners[0] === true ? 0 : 1;
        const iWon = winnerPlayerId === state.myPlayerId;
        message = iWon ? 'You win!' : `${opponentUsername} wins!`;
    } else if (winners[0] === true) {
        message = "Player 1 Win!";
    } else if (winners[1] === true) {
        message = "Player 2 Win!";
    }

    messageElement.innerText = message;
    modal.style.display = "flex";

    // Reset vote status and button visibility
    voteStatus.style.display = 'none';
    voteStatus.textContent = '';
    restartBtn.disabled = false;
    restartBtn.style.display = '';

    // Online: show "Vote Restart" unless it was a forfeit (opponent left — no one to vote with)
    if (state.gameMode === 'online' && !isForfeit) {
        restartBtn.textContent = 'Vote Restart';
        leaveModalBtn.style.display = 'inline-block';
    } else if (isForfeit) {
        restartBtn.style.display = 'none';
        leaveModalBtn.style.display = 'inline-block';
    } else {
        restartBtn.textContent = 'Play again';
        leaveModalBtn.style.display = 'inline-block';
    }

    restartBtn.onclick = function () {
        console.log("Restart requested...");
        socket.emit("game:restart", { gameId: gameId });

        if (state.gameMode === 'online') {
            restartBtn.disabled = true;
            restartBtn.textContent = 'Voted ✓';
            voteStatus.style.display = 'block';
            voteStatus.textContent = 'Waiting for opponent to vote...';
        } else {
            modal.style.display = "none";
        }
    };

    leaveModalBtn.onclick = function () {
        leaveGame();
    };
}

/**
 * Update vote status when a restart vote comes in
 */
export function updateRestartVoteStatus(data) {
    const voteStatus = document.getElementById('voteStatus');
    if (voteStatus) {
        voteStatus.style.display = 'block';
        voteStatus.textContent = `Restart votes: ${data.votes}/${data.needed}`;
    }
}

/**
 * Leave the game — kicks both players
 */
export function leaveGame() {
    localStorage.setItem('activeGameExpiresAt', String(Date.now() + 60000));
    socket.emit("game:leave", { gameId: gameId });
    goHome();
}

/**
 * Redirect to home and clean session.
 * activeGameId and activePlayerId are intentionally kept so the
 * homepage can show the "Rejoin game" button during the grace period.
 */
export function goHome() {
    sessionStorage.removeItem("gameId");
    sessionStorage.removeItem("playerId");
    sessionStorage.removeItem("gameMode");
    // Keep myUsername, opponentUsername, myElo, opponentElo, myCoins, opponentCoins
    // so the game page can restore them on rejoin. They get overwritten by the next matchmaking session.
    // Clear cached profile stats so profileManager refetches fresh data from server
    sessionStorage.removeItem('elo');
    sessionStorage.removeItem('coins');
    window.location.href = '../homePage/index.html';
}

// ========== RECONNECT OVERLAY ==========

export function showReconnectOverlay(message, countdownSeconds) {
    let overlay = document.getElementById('reconnect-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'reconnect-overlay';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
            'display:flex', 'flex-direction:column', 'align-items:center',
            'justify-content:center', 'color:white', 'font-size:1.4rem',
            'z-index:9999', 'gap:1rem'
        ].join(';');
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<p>${message}</p>`;
    if (countdownSeconds) {
        let remaining = countdownSeconds;
        const span = document.createElement('p');
        span.style.fontSize = '2.5rem';
        span.style.fontWeight = 'bold';
        span.textContent = `${remaining}s`;
        overlay.appendChild(span);
        const interval = setInterval(() => {
            remaining--;
            span.textContent = `${remaining}s`;
            if (remaining <= 0) clearInterval(interval);
        }, 1000);
        overlay._interval = interval;
    }
}

export function hideReconnectOverlay() {
    const overlay = document.getElementById('reconnect-overlay');
    if (overlay) {
        if (overlay._interval) clearInterval(overlay._interval);
        overlay.remove();
    }
}
