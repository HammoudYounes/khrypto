/**
 * offboardUI.js
 * Gère le rendu des éléments hors plateau (HUD, réserves, cooldowns, modal)
 */

import { state } from './gameState.js';
import { socket } from './networkManager.js';
import { gameId } from './index.js';

// ========== PYRAMID RESERVE ==========

export function updatePyramidReserve(reserves) {
    const countP0 = document.getElementById("p1-pyramid-count")
    const countP1 = document.getElementById("p2-pyramid-count")
    countP0.innerHTML = reserves[0].toString()
    countP1.innerHTML = reserves[1].toString()
}

export function initPlayerControls(playerId, imgId, btnLeftId, btnRightId) {
    const img = document.getElementById(imgId);
    const btnLeft = document.getElementById(btnLeftId);
    const btnRight = document.getElementById(btnRightId);

    if (!img || !btnLeft || !btnRight) return;

    const updateVisual = () => {
        const orientation = state.reserveOrientations[playerId];
        const degree = (90 * orientation) - 90;
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

    const p0Sphinx = calculateCooldown(gameState, 0, 'Sphinx');
    const p0Pharaoh = calculateCooldown(gameState, 0, 'Pharaoh');
    const p1Sphinx = calculateCooldown(gameState, 1, 'Sphinx');
    const p1Pharaoh = calculateCooldown(gameState, 1, 'Pharaoh');

    document.getElementById('p1-sphinx-cooldown').textContent = p0Sphinx;
    document.getElementById('p1-pharaoh-cooldown').textContent = p0Pharaoh;
    document.getElementById('p2-sphinx-cooldown').textContent = p1Sphinx;
    document.getElementById('p2-pharaoh-cooldown').textContent = p1Pharaoh;
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

    if (gameState.turn === 0) {
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

    let message = "";

    if (winners[0] === true && winners[1] === true) {
        message = "Equality!";
    } else if (winners[0] === true) {
        message = "Player 1 Win!";
    } else if (winners[1] === true) {
        message = "Player 2 Win!";
    }

    messageElement.innerText = message;

    modal.style.display = "flex";

    restartBtn.onclick = function () {
        console.log("Restarting game...");

        socket.emit("game:restart", { gameId: gameId });

        modal.style.display = "none";
    };

}
