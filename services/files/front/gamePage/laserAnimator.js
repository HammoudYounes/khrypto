/**
 * laserAnimator.js
 * Handles wiht the rendering of the laser 
 */

import { removePieceFromBoard } from './boardRenderer.js';

// ========== LASER ANIMATION ==========

export async function animateLaserSequence(laserResult, color) {
    const canvas = document.getElementById('laserCanvas');
    const ctx = canvas.getContext('2d');
    const board = document.getElementById('board');

    canvas.width = board.clientWidth;
    canvas.height = board.clientHeight;

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;

    const path = laserResult.path;

    // Transform the list of destroyed pieces into a Set of "x,y" strings for fast lookup
    const destroyedSet = new Set();
    if (laserResult.hitCoords) {
        laserResult.hitCoords.forEach(coord => destroyedSet.add(`${coord.x},${coord.y}`));
    }

    ctx.beginPath();

    // Iterate through the path segment by segment
    for (let i = 0; i < path.length - 1; i++) {
        const start = path[i];
        const end = path[i + 1];

        const startPos = getCenterCoordinates(start.x, start.y);
        const endPos = getCenterCoordinates(end.x, end.y);

        if (i === 0) {
            ctx.moveTo(startPos.px, startPos.py);
        }

        ctx.lineTo(endPos.px, endPos.py);
        ctx.stroke();

        await sleep(25);

        if (destroyedSet.has(`${end.x},${end.y}`)) {
            drawExplosion(ctx, endPos.px, endPos.py);

            removePieceFromBoard(end.x, end.y);

            await sleep(150);
        }
    }

    await sleep(550);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ========== HELPER FUNCTIONS ==========

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getCenterCoordinates(x, y) {
    const cell = document.querySelector(`.case[data-row='${y}'][data-col='${x}']`);
    if (!cell) return { px: 0, py: 0 };

    const px = cell.offsetLeft + cell.offsetWidth / 2;
    const py = cell.offsetTop + cell.offsetHeight / 2;

    return { px, py };
}

export function drawExplosion(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = 'yellow';
    ctx.shadowColor = 'orange';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
}
