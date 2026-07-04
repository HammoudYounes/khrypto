/**
 * Replay viewer — renders server-simulated frames of a finished match.
 * Frames come from GET /api/matches/replay/:gameId; the client never
 * re-implements game rules, it just draws boards + laser paths.
 */
import { TokenManager, ApiHost } from '../js/tokenManager.js';

const boardEl = document.getElementById('replayBoard');
const moveInfo = document.getElementById('moveInfo');
const slider = document.getElementById('frameSlider');
const playBtn = document.getElementById('btnPlay');
const speedSelect = document.getElementById('speedSelect');

let frames = [];
let usernames = { 0: 'Player 1', 1: 'Player 2' };
let current = 0;
let playTimer = null;

// ── Board rendering (same asset + rotation rules as the game page) ──────────

function pieceImage(p) {
    const img = document.createElement('img');
    const color = p.player === 0 ? 'green' : 'red';
    const type = p.type.toLowerCase();
    img.src = `../gamePage/assets/${color}_${type}.png`;
    img.alt = `${color} ${type}`;

    let degree = 0, scaleY = 1;
    if (type === 'pharaoh') degree = 0;
    else if (type === 'sphinx') {
        degree = [-90, 0, 90, 180][p.orientation];
        if (p.orientation === 3) scaleY = -1;
    }
    else if (type === 'scarab') degree = 90 * p.orientation - 45;
    else if (type === 'pyramid') degree = 90 * p.orientation - 90;
    else degree = 90 * p.orientation - 180;

    img.style.transform = `rotate(${degree}deg) scaleY(${scaleY})`;
    return img;
}

function initGrid() {
    boardEl.innerHTML = '';
    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
            const cell = document.createElement('div');
            cell.className = 'replay-cell';
            cell.dataset.row = row;
            cell.dataset.col = col;
            boardEl.appendChild(cell);
        }
    }
}

function cellAt(x, y) {
    return boardEl.children[y * 10 + x];
}

function describe(frame, index) {
    if (!frame.action) return `Starting position — ${usernames[0]} (green) vs ${usernames[1]} (red)`;
    const who = usernames[frame.playerId] ?? `P${frame.playerId}`;
    const a = frame.action;
    const verb = {
        ROTATE: `rotates (${a.x},${a.y}) ${a.direction === 1 ? '↻' : '↺'}`,
        MOVE: `moves (${a.x},${a.y}) → (${a.destX},${a.destY})`,
        PLACE: `places a pyramid at (${a.x},${a.y})`,
        SWAP: `swaps (${a.x},${a.y}) ⇄ (${a.targetX},${a.targetY})`
    }[a.type] || a.type;
    const hits = frame.hits && frame.hits.length ? ` — 💥 ${frame.hits.length} piece${frame.hits.length > 1 ? 's' : ''} destroyed` : '';
    return `Move ${index}/${frames.length - 1}: ${who} ${verb}${hits}`;
}

function showFrame(index, animateLaser = true) {
    current = Math.max(0, Math.min(index, frames.length - 1));
    const frame = frames[current];

    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = cellAt(x, y);
            cell.className = 'replay-cell';
            cell.innerHTML = '';
            const p = frame.board[y][x];
            if (p) cell.appendChild(pieceImage(p));
        }
    }

    // Highlight the acting square, laser path, and destroyed pieces
    if (frame.action && frame.action.x !== undefined) {
        const c = cellAt(frame.action.x, frame.action.y);
        if (c) c.classList.add('acted');
    }
    if (animateLaser && frame.laserPath) {
        for (const { x, y } of frame.laserPath) cellAt(x, y)?.classList.add('laser');
        for (const { x, y } of (frame.hits || [])) cellAt(x, y)?.classList.add('hit');
        setTimeout(() => {
            boardEl.querySelectorAll('.laser, .hit').forEach(c => c.classList.remove('laser', 'hit'));
        }, Math.min(700, parseInt(speedSelect.value) * 0.8));
    }

    slider.value = current;
    moveInfo.textContent = describe(frame, current);

    if (current === frames.length - 1) stopPlayback();
}

// ── Playback controls ─────────────────────────────────────────────────────────

function startPlayback() {
    if (current >= frames.length - 1) current = 0;
    playBtn.textContent = '⏸ Pause';
    playTimer = setInterval(() => {
        if (current >= frames.length - 1) return stopPlayback();
        showFrame(current + 1);
    }, parseInt(speedSelect.value));
}

function stopPlayback() {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    playBtn.textContent = '▶ Play';
}

playBtn.addEventListener('click', () => playTimer ? stopPlayback() : startPlayback());
document.getElementById('btnFirst').addEventListener('click', () => { stopPlayback(); showFrame(0, false); });
document.getElementById('btnLast').addEventListener('click', () => { stopPlayback(); showFrame(frames.length - 1, false); });
document.getElementById('btnPrev').addEventListener('click', () => { stopPlayback(); showFrame(current - 1, false); });
document.getElementById('btnNext').addEventListener('click', () => { stopPlayback(); showFrame(current + 1); });
slider.addEventListener('input', () => { stopPlayback(); showFrame(parseInt(slider.value), false); });
speedSelect.addEventListener('change', () => { if (playTimer) { stopPlayback(); startPlayback(); } });
document.getElementById('backBtn').addEventListener('click', () => history.length > 1 ? history.back() : (window.location.href = '../profilePage/index.html'));

document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { stopPlayback(); showFrame(current + 1); }
    if (e.key === 'ArrowLeft') { stopPlayback(); showFrame(current - 1, false); }
    if (e.key === ' ') { e.preventDefault(); playTimer ? stopPlayback() : startPlayback(); }
});

// ── Load ──────────────────────────────────────────────────────────────────────

(async () => {
    initGrid();
    const gameId = new URLSearchParams(window.location.search).get('gameId');
    const token = TokenManager.getAccessToken();
    if (!gameId || !token) {
        moveInfo.textContent = 'Missing game id or not logged in.';
        return;
    }

    try {
        const res = await fetch(`${ApiHost.getHost()}/api/matches/replay/${encodeURIComponent(gameId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) {
            moveInfo.textContent = data.error || 'Failed to load replay.';
            return;
        }

        frames = data.frames;
        usernames = data.usernames;
        document.getElementById('replayTitle').textContent =
            `${usernames[0]} vs ${usernames[1]}${data.mode === 'wager' ? ' — 💰 wager' : ''}`;
        if (data.result) {
            const w = data.result['0'] && data.result['1'] ? 'Draw' :
                      data.result['0'] ? `${usernames[0]} won` : `${usernames[1]} won`;
            document.getElementById('replayResult').textContent = w + (data.result.reason ? ` (${data.result.reason})` : '');
        }
        slider.max = frames.length - 1;
        showFrame(0, false);
    } catch (e) {
        console.error('Replay load error:', e);
        moveInfo.textContent = 'Failed to load replay.';
    }
})();
