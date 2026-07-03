'use strict';

// Khrypto bot v2 — minimax + alpha-beta + iterative deepening + quiescence,
// with a transposition table (Zobrist hashing), killer-move ordering, and a
// rules-faithful internal simulation (pending-reserve delay, turn-100 draw).
//
// Public API (backward compatible):
//   getBestMove(engineState, aiPlayerId, optionsOrTimeMs)
//     options: { timeLimitMs = 800, maxDepth = 6, randomness = 0 }
//     randomness ∈ [0,1]: probability of picking a slightly suboptimal root
//     move (used by difficulty tiers), 0 = always best.

const BOARD_SIZE = 10;
const DX = [0, 1, 0, -1]; // NORTH=0, EAST=1, SOUTH=2, WEST=3
const DY = [-1, 0, 1, 0];

const WIN = 999999;
const MATE_THRESHOLD = 900000;

// ── Laser (exact mirror of engine logic) ─────────────────────────────────────

function getLocalSide(laserDir, orientation) {
    return ((laserDir + 2) - orientation + 4) % 4;
}

function pieceAcceptLaser(piece, laserDir) {
    const ls = getLocalSide(laserDir, piece.orientation);
    switch (piece.type) {
        case 'Sphinx':  return { action: 'BLOCK' };
        case 'Pharaoh': return { action: 'PASS' };
        case 'Anubis':
            return ls === 0 ? { action: 'BLOCK' } : { action: 'PASS' };
        case 'Pyramid':
            if (ls === 0) return { action: 'REFLECT', newDir: (piece.orientation + 1) % 4 };
            if (ls === 1) return { action: 'REFLECT', newDir: piece.orientation };
            return { action: 'PASS' };
        case 'Scarab': {
            const nd = [
                (piece.orientation + 1) % 4,
                piece.orientation,
                (piece.orientation + 3) % 4,
                (piece.orientation + 2) % 4,
            ][ls];
            return { action: 'REFLECT', newDir: nd };
        }
    }
    return { action: 'PASS' };
}

// Returns { hits: [{x,y,piece}], path: [{x,y}] }
function traceLaserFull(board, firingPlayer) {
    let sx = -1, sy = -1, sphinxOri = -1;
    outer: for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const p = board[y][x];
            if (p && p.type === 'Sphinx' && p.player === firingPlayer) {
                sx = x; sy = y; sphinxOri = p.orientation;
                break outer;
            }
        }
    }
    if (sx === -1) return { hits: [], path: [] };

    const hits = [], path = [];
    let cx = sx + DX[sphinxOri];
    let cy = sy + DY[sphinxOri];
    let dir = sphinxOri;
    let safety = 200;

    while (cx >= 0 && cx < BOARD_SIZE && cy >= 0 && cy < BOARD_SIZE && safety-- > 0) {
        path.push({ x: cx, y: cy });
        const target = board[cy][cx];
        if (target) {
            const r = pieceAcceptLaser(target, dir);
            if (r.action === 'BLOCK') break;
            if (r.action === 'PASS')    hits.push({ x: cx, y: cy, piece: target });
            if (r.action === 'REFLECT') dir = r.newDir;
        }
        cx += DX[dir];
        cy += DY[dir];
    }
    return { hits, path };
}

function traceLaser(board, p) { return traceLaserFull(board, p).hits; }

// ── Zobrist hashing ───────────────────────────────────────────────────────────

const TYPE_INDEX = { Sphinx: 0, Pharaoh: 1, Anubis: 2, Pyramid: 3, Scarab: 4 };

// Deterministic PRNG so hashes are stable across restarts
function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5;  s >>>= 0;
        return s;
    };
}

const ZOBRIST_SIZE = 5 * 2 * 4 * 100; // type × player × orientation × cell
const Z1 = new Int32Array(ZOBRIST_SIZE);
const Z2 = new Int32Array(ZOBRIST_SIZE);
const ZTURN1 = new Int32Array(2), ZTURN2 = new Int32Array(2);
const ZRES1 = [new Int32Array(32), new Int32Array(32)];
const ZRES2 = [new Int32Array(32), new Int32Array(32)];
{
    const rng = makeRng(0x9e3779b9);
    for (let i = 0; i < ZOBRIST_SIZE; i++) { Z1[i] = rng() | 0; Z2[i] = rng() | 0; }
    for (let i = 0; i < 2; i++) { ZTURN1[i] = rng() | 0; ZTURN2[i] = rng() | 0; }
    for (let p = 0; p < 2; p++) for (let i = 0; i < 32; i++) { ZRES1[p][i] = rng() | 0; ZRES2[p][i] = rng() | 0; }
}

function zPieceIndex(piece, x, y) {
    return ((TYPE_INDEX[piece.type] * 2 + piece.player) * 4 + piece.orientation) * 100 + y * 10 + x;
}

function computeHash(state) {
    let h1 = 0, h2 = 0;
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const p = state.board[y][x];
            if (p) {
                const idx = zPieceIndex(p, x, y);
                h1 ^= Z1[idx]; h2 ^= Z2[idx];
            }
        }
    }
    h1 ^= ZTURN1[state.turn]; h2 ^= ZTURN2[state.turn];
    h1 ^= ZRES1[0][state.reserves[0] & 31]; h2 ^= ZRES2[0][state.reserves[0] & 31];
    h1 ^= ZRES1[1][state.reserves[1] & 31]; h2 ^= ZRES2[1][state.reserves[1] & 31];
    state.h1 = h1; state.h2 = h2;
}

function xorPiece(state, piece, x, y) {
    const idx = zPieceIndex(piece, x, y);
    state.h1 ^= Z1[idx]; state.h2 ^= Z2[idx];
}

function xorReserve(state, player, count) {
    state.h1 ^= ZRES1[player][count & 31]; state.h2 ^= ZRES2[player][count & 31];
}

function xorTurn(state) {
    state.h1 ^= ZTURN1[0] ^ ZTURN1[1];
    state.h2 ^= ZTURN2[0] ^ ZTURN2[1];
}

// ── State clone (rules-faithful: includes pending reserves) ───────────────────

function cloneState(state) {
    const board = new Array(BOARD_SIZE);
    for (let y = 0; y < BOARD_SIZE; y++) {
        const row = state.board[y];
        const nr = new Array(BOARD_SIZE);
        for (let x = 0; x < BOARD_SIZE; x++) {
            const p = row[x];
            nr[x] = p ? { type: p.type, player: p.player, orientation: p.orientation } : null;
        }
        board[y] = nr;
    }
    const pending = state.pendingReserves || state.pending || { 0: [], 1: [] };
    const clone = {
        board,
        turn: state.turn,
        turnCount: state.turnCount,
        reserves: { 0: state.reserves[0], 1: state.reserves[1] },
        pending: { 0: pending[0].slice(), 1: pending[1].slice() },
        winner: { 0: state.winner[0], 1: state.winner[1] },
        swapHistory: {
            0: { Sphinx: state.swapHistory[0].Sphinx, Pharaoh: state.swapHistory[0].Pharaoh },
            1: { Sphinx: state.swapHistory[1].Sphinx, Pharaoh: state.swapHistory[1].Pharaoh },
        },
        h1: 0, h2: 0,
    };
    if (state.h1) { clone.h1 = state.h1; clone.h2 = state.h2; }
    else computeHash(clone);
    return clone;
}

// ── Move application (mirrors engine's applyAction + laser + turn flip) ───────

function applyMoveFast(state, move, playerId) {
    const { type, x, y } = move;
    let laserShouldFire = true;

    switch (type) {
        case 'PLACE': {
            if (state.board[y][x] !== null) return false;
            if (state.reserves[playerId] <= 0) return false;
            const placed = { type: 'Pyramid', player: playerId, orientation: move.orientation };
            state.board[y][x] = placed;
            xorPiece(state, placed, x, y);
            xorReserve(state, playerId, state.reserves[playerId]);
            state.reserves[playerId]--;
            xorReserve(state, playerId, state.reserves[playerId]);
            break;
        }
        case 'MOVE': {
            const src = state.board[y][x];
            if (!src || src.player !== playerId) return false;
            if (src.type === 'Sphinx' || src.type === 'Pharaoh') return false;
            if (state.board[move.destY][move.destX] !== null) return false;
            xorPiece(state, src, x, y);
            state.board[move.destY][move.destX] = src;
            state.board[y][x] = null;
            xorPiece(state, src, move.destX, move.destY);
            break;
        }
        case 'ROTATE': {
            const p = state.board[y][x];
            if (!p || p.player !== playerId) return false;
            if (p.type === 'Pharaoh') return false;
            xorPiece(state, p, x, y);
            p.orientation = ((p.orientation + move.direction) % 4 + 4) % 4;
            xorPiece(state, p, x, y);
            break;
        }
        case 'SWAP': {
            const scarab = state.board[y][x];
            if (!scarab || scarab.player !== playerId || scarab.type !== 'Scarab') return false;
            const target = state.board[move.targetY][move.targetX];
            if (!target || target.player !== playerId) return false;
            if (target.type !== 'Sphinx' && target.type !== 'Pharaoh') return false;
            if (state.turnCount - state.swapHistory[playerId][target.type] < 8) return false;
            xorPiece(state, scarab, x, y);
            xorPiece(state, target, move.targetX, move.targetY);
            state.board[y][x] = target;
            state.board[move.targetY][move.targetX] = scarab;
            xorPiece(state, target, x, y);
            xorPiece(state, scarab, move.targetX, move.targetY);
            state.swapHistory[playerId][target.type] = state.turnCount;
            if (target.type === 'Sphinx') laserShouldFire = false;
            break;
        }
        default: return false;
    }

    if (laserShouldFire) {
        const hits = traceLaser(state.board, playerId);
        for (const { x: hx, y: hy, piece } of hits) {
            if (state.turnCount === 100) {
                // Engine rule: any destruction on turn 100 ends the game as a draw
                state.winner[0] = true;
                state.winner[1] = true;
            } else if (piece.type === 'Pharaoh') {
                state.winner[(piece.player + 1) % 2] = true;
            } else if (piece.type === 'Pyramid') {
                // Captured pyramids reach the opponent's reserve after a 4-turn delay
                state.pending[(piece.player + 1) % 2].push(state.turnCount + 4);
            }
            xorPiece(state, piece, hx, hy);
            state.board[hy][hx] = null;
        }
    }

    // Turn flip + pending-reserve unlock for the incoming player
    xorTurn(state);
    state.turn = 1 - state.turn;
    state.turnCount++;

    if (!state.winner[0] && !state.winner[1]) {
        const cur = state.turn;
        const pendingList = state.pending[cur];
        for (let i = pendingList.length - 1; i >= 0; i--) {
            if (state.turnCount >= pendingList[i]) {
                xorReserve(state, cur, state.reserves[cur]);
                state.reserves[cur]++;
                xorReserve(state, cur, state.reserves[cur]);
                pendingList.splice(i, 1);
            }
        }
    }
    return true;
}

// ── Move generation ───────────────────────────────────────────────────────────

function canPlace(board, x, y, playerId) {
    for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE) {
            const p = board[ny][nx];
            if (p && (p.type === 'Sphinx' || (p.type === 'Pharaoh' && p.player === playerId))) return false;
        }
    }
    return true;
}

function getTacticalMoves(state, playerId) {
    const swaps = [], rotates = [], moves = [];

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const p = state.board[y][x];
            if (!p || p.player !== playerId) continue;

            if (p.type !== 'Pharaoh') {
                rotates.push({ type: 'ROTATE', x, y, direction: 1 });
                rotates.push({ type: 'ROTATE', x, y, direction: -1 });
            }

            if (p.type !== 'Sphinx' && p.type !== 'Pharaoh') {
                for (let d = 0; d < 4; d++) {
                    const nx = x + DX[d], ny = y + DY[d];
                    if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && !state.board[ny][nx]) {
                        moves.push({ type: 'MOVE', x, y, destX: nx, destY: ny });
                    }
                }
            }

            if (p.type === 'Scarab') {
                for (let ty = 0; ty < BOARD_SIZE; ty++) {
                    for (let tx = 0; tx < BOARD_SIZE; tx++) {
                        const t = state.board[ty][tx];
                        if (t && t.player === playerId &&
                            (t.type === 'Sphinx' || t.type === 'Pharaoh') &&
                            state.turnCount - state.swapHistory[playerId][t.type] >= 8) {
                            swaps.push({ type: 'SWAP', x, y, targetX: tx, targetY: ty });
                        }
                    }
                }
            }
        }
    }
    return [...swaps, ...rotates, ...moves];
}

function scorePlacement(board, x, y, ori, playerId) {
    const opp = 1 - playerId;
    board[y][x] = { type: 'Pyramid', player: playerId, orientation: ori };
    let score = 0;

    for (const { piece } of traceLaser(board, playerId)) {
        if (piece.type === 'Pharaoh' && piece.player === opp)      { score += 50000; break; }
        score += piece.player === opp ? 80 : -200;
    }
    for (const { piece } of traceLaser(board, opp)) {
        if (piece.type === 'Pharaoh' && piece.player === playerId) { score -= 50000; break; }
        score += piece.player === playerId ? -150 : 20;
    }

    board[y][x] = null;
    return score;
}

function getBestPlacements(state, playerId, maxCount) {
    if (state.reserves[playerId] <= 0) return [];
    const board = state.board;
    const scored = [];

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (!board[y][x] && canPlace(board, x, y, playerId)) {
                for (let ori = 0; ori < 4; ori++) {
                    scored.push({ move: { type: 'PLACE', x, y, orientation: ori }, score: scorePlacement(board, x, y, ori, playerId) });
                }
            }
        }
    }

    scored.sort((a, b) => b.score - a.score);
    const result = [];
    for (let i = 0; i < scored.length && i < maxCount; i++) {
        if (scored[i].score > 0 || i < 2) result.push(scored[i].move);
    }
    return result;
}

// ── Evaluation ────────────────────────────────────────────────────────────────

const MAT = { Pharaoh: 0, Sphinx: 0, Scarab: 70, Anubis: 45, Pyramid: 22 };
const RESERVE_VALUE = 14;   // a pyramid in hand
const PENDING_VALUE = 10;   // a pyramid arriving in a few turns (discounted)

function evaluate(state, aiPlayer) {
    if (state.winner[aiPlayer] && state.winner[1 - aiPlayer]) return 0; // draw
    if (state.winner[aiPlayer])     return  WIN;
    if (state.winner[1 - aiPlayer]) return -WIN;

    const opp = 1 - aiPlayer;
    let score = 0;

    const myLaser  = traceLaserFull(state.board, aiPlayer);
    const oppLaser = traceLaserFull(state.board, opp);

    // Pieces currently sitting in a laser line (would die if that laser fires)
    for (const { piece } of myLaser.hits) {
        if (piece.type === 'Pharaoh' && piece.player === opp)      return  MATE_THRESHOLD;
        if (piece.type === 'Pharaoh' && piece.player === aiPlayer) return -MATE_THRESHOLD;
        score += piece.player === opp ? 150 : -250;
    }
    for (const { piece } of oppLaser.hits) {
        if (piece.type === 'Pharaoh' && piece.player === aiPlayer) return -MATE_THRESHOLD;
        if (piece.type === 'Pharaoh' && piece.player === opp)      score += 60;
        else score += piece.player === aiPlayer ? -150 : 40;
    }

    // Material, pharaoh locations, and positional terms in one board pass
    let myPharX = -1, myPharY = -1, oppPharX = -1, oppPharY = -1;
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const p = state.board[y][x];
            if (!p) continue;

            const v = MAT[p.type];
            if (v) score += p.player === aiPlayer ? v : -v;

            if (p.type === 'Pharaoh') {
                if (p.player === aiPlayer) { myPharX = x; myPharY = y; }
                else { oppPharX = x; oppPharY = y; }
            } else if (p.type === 'Scarab') {
                // Scarabs are indestructible reflectors: central ones dominate
                const centrality = 9 - (Math.abs(x - 4.5) + Math.abs(y - 4.5));
                score += (p.player === aiPlayer ? 1 : -1) * centrality * 3;
            }
        }
    }

    // Laser pressure: how close each laser path passes to the enemy pharaoh
    if (oppPharX >= 0 && myLaser.path.length > 0) {
        let minD = Infinity;
        for (const { x, y } of myLaser.path) {
            const d = Math.abs(x - oppPharX) + Math.abs(y - oppPharY);
            if (d < minD) minD = d;
        }
        if (minD <= 5) score += (6 - minD) * 50;
    }
    if (myPharX >= 0 && oppLaser.path.length > 0) {
        let minD = Infinity;
        for (const { x, y } of oppLaser.path) {
            const d = Math.abs(x - myPharX) + Math.abs(y - myPharY);
            if (d < minD) minD = d;
        }
        if (minD <= 5) score -= (6 - minD) * 70;
    }

    // Reserves: in-hand pyramids plus discounted incoming (captured) ones
    score += (state.reserves[aiPlayer] - state.reserves[opp]) * RESERVE_VALUE;
    score += (state.pending[aiPlayer].length - state.pending[opp].length) * PENDING_VALUE;

    return score;
}

// ── Transposition table ───────────────────────────────────────────────────────

const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;
let tt = new Map(); // h1 → { h2, depth, flag, score, move }
const TT_MAX = 300000;

function ttGet(state) {
    const e = tt.get(state.h1);
    return e && e.h2 === state.h2 ? e : null;
}

function ttPut(state, depth, flag, score, move) {
    if (tt.size >= TT_MAX) tt.clear();
    const existing = tt.get(state.h1);
    if (existing && existing.h2 === state.h2 && existing.depth > depth) return;
    tt.set(state.h1, { h2: state.h2, depth, flag, score, move });
}

function sameMove(a, b) {
    return a && b && a.type === b.type && a.x === b.x && a.y === b.y &&
        a.destX === b.destX && a.destY === b.destY &&
        a.targetX === b.targetX && a.targetY === b.targetY &&
        a.direction === b.direction && a.orientation === b.orientation;
}

// ── Quiescence search ─────────────────────────────────────────────────────────

function isLoud(state, aiPlayer) {
    for (const { piece } of traceLaser(state.board, aiPlayer))
        if (piece.type === 'Pharaoh') return true;
    for (const { piece } of traceLaser(state.board, 1 - aiPlayer))
        if (piece.type === 'Pharaoh') return true;
    return false;
}

function quiesce(state, alpha, beta, aiPlayer, qdepth, ctx) {
    const standPat = evaluate(state, aiPlayer);
    if (standPat >= WIN || standPat <= -WIN) return standPat;
    if (qdepth === 0 || !isLoud(state, aiPlayer)) return standPat;

    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;

    const currentPlayer = state.turn;
    const moves = getTacticalMoves(state, currentPlayer);
    const maximizing = currentPlayer === aiPlayer;
    let best = standPat;

    for (const move of moves) {
        if (Date.now() > ctx.deadline) break;
        const clone = cloneState(state);
        if (!applyMoveFast(clone, move, currentPlayer)) continue;
        const val = quiesce(clone, alpha, beta, aiPlayer, qdepth - 1, ctx);
        if (maximizing) {
            if (val > best) best = val;
            if (val > alpha) alpha = val;
        } else {
            if (val < best) best = val;
            if (val < beta) beta = val;
        }
        if (beta <= alpha) break;
    }
    return best;
}

// ── Minimax + alpha-beta + TT + killers ───────────────────────────────────────

function minimax(state, depth, alpha, beta, maximizing, aiPlayer, ctx, ply) {
    if ((++ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) throw new Error('TIMEOUT');

    if (state.winner[aiPlayer] && state.winner[1 - aiPlayer]) return 0;
    if (state.winner[aiPlayer])     return  WIN - ply;
    if (state.winner[1 - aiPlayer]) return -(WIN - ply);

    const alphaOrig = alpha, betaOrig = beta;
    const entry = ttGet(state);
    if (entry && entry.depth >= depth) {
        if (entry.flag === TT_EXACT) return entry.score;
        if (entry.flag === TT_LOWER && entry.score > alpha) alpha = entry.score;
        else if (entry.flag === TT_UPPER && entry.score < beta) beta = entry.score;
        if (alpha >= beta) return entry.score;
    }

    if (depth === 0) return quiesce(state, alpha, beta, aiPlayer, 2, ctx);

    const currentPlayer = maximizing ? aiPlayer : 1 - aiPlayer;

    const moves = getTacticalMoves(state, currentPlayer);
    if (depth >= 2 && state.reserves[currentPlayer] > 0) {
        const places = getBestPlacements(state, currentPlayer, depth >= 3 ? 4 : 2);
        for (const p of places) moves.push(p);
    }
    if (moves.length === 0) return evaluate(state, aiPlayer);

    // Ordering: TT move first, then killers, then generation order
    const ttMove = entry ? entry.move : null;
    const killers = ctx.killers[ply] || [];
    moves.sort((a, b) => moveOrderKey(b, ttMove, killers) - moveOrderKey(a, ttMove, killers));

    let bestScore = maximizing ? -Infinity : Infinity;
    let bestMove = null;

    for (const move of moves) {
        const clone = cloneState(state);
        if (!applyMoveFast(clone, move, currentPlayer)) continue;
        const val = minimax(clone, depth - 1, alpha, beta, !maximizing, aiPlayer, ctx, ply + 1);

        if (maximizing) {
            if (val > bestScore) { bestScore = val; bestMove = move; }
            if (val > alpha) alpha = val;
        } else {
            if (val < bestScore) { bestScore = val; bestMove = move; }
            if (val < beta) beta = val;
        }
        if (beta <= alpha) {
            storeKiller(ctx, ply, move);
            break;
        }
    }

    if (bestScore === -Infinity || bestScore === Infinity) return evaluate(state, aiPlayer);

    let flag = TT_EXACT;
    if (bestScore <= alphaOrig) flag = TT_UPPER;
    else if (bestScore >= betaOrig) flag = TT_LOWER;
    ttPut(state, depth, flag, bestScore, bestMove);

    return bestScore;
}

function moveOrderKey(move, ttMove, killers) {
    if (sameMove(move, ttMove)) return 100;
    if (killers.some(k => sameMove(move, k))) return 50;
    if (move.type === 'SWAP') return 10;
    if (move.type === 'ROTATE') return 5;
    return 0;
}

function storeKiller(ctx, ply, move) {
    if (!ctx.killers[ply]) ctx.killers[ply] = [];
    const k = ctx.killers[ply];
    if (!k.some(m => sameMove(m, move))) {
        k.unshift(move);
        if (k.length > 2) k.pop();
    }
}

// ── Root search ───────────────────────────────────────────────────────────────

function getBestMove(engineState, aiPlayerId, optionsOrTimeMs) {
    const options = typeof optionsOrTimeMs === 'number'
        ? { timeLimitMs: optionsOrTimeMs }
        : (optionsOrTimeMs || {});
    const timeLimitMs = options.timeLimitMs !== undefined ? options.timeLimitMs : 800;
    const maxDepth = options.maxDepth !== undefined ? options.maxDepth : 6;
    const randomness = options.randomness !== undefined ? options.randomness : 0;

    const deadline = Date.now() + timeLimitMs;
    const ctx = { deadline, nodes: 0, killers: [] };
    tt = new Map();

    const state = cloneState(engineState);
    const opp = 1 - aiPlayerId;

    // 1. Immediate win short-circuit
    const allTactical = getTacticalMoves(state, aiPlayerId);
    for (const move of allTactical) {
        const clone = cloneState(state);
        if (applyMoveFast(clone, move, aiPlayerId) && clone.winner[aiPlayerId] && !clone.winner[opp]) {
            return move;
        }
    }

    // 2. Root move set: tactical + top placements
    const bestPlacements = getBestPlacements(state, aiPlayerId, 12);
    const rootMoves = [...allTactical, ...bestPlacements];
    if (rootMoves.length === 0) return null;

    // 3. Static pre-ordering (with a bonus for parrying an imminent opponent win)
    const oppTactical = getTacticalMoves(state, opp);
    const oppWinMoves = [];
    for (const m of oppTactical) {
        const clone = cloneState(state);
        if (applyMoveFast(clone, m, opp) && clone.winner[opp]) oppWinMoves.push(m);
    }

    let scored = [];
    for (const move of rootMoves) {
        const clone = cloneState(state);
        if (!applyMoveFast(clone, move, aiPlayerId)) continue;

        let val = evaluate(clone, aiPlayerId);
        if (oppWinMoves.length > 0) {
            const oppStillWins = oppWinMoves.some(om => {
                const c2 = cloneState(clone);
                return applyMoveFast(c2, om, opp) && c2.winner[opp];
            });
            if (!oppStillWins) val += 800000;
        }
        scored.push({ move, val });
    }
    if (scored.length === 0) return allTactical[0] || null;

    scored.sort((a, b) => b.val - a.val);
    let bestMove = scored[0].move;

    // 4. Iterative deepening; root re-ordered by the previous iteration's scores
    try {
        for (let depth = 1; depth <= maxDepth; depth++) {
            if (Date.now() > deadline) break;

            const iterScores = [];
            let iterBestScore = -Infinity;
            let iterBestMove = null;
            let alpha = -Infinity;

            for (const { move } of scored) {
                if (Date.now() > ctx.deadline) throw new Error('TIMEOUT');
                const clone = cloneState(state);
                if (!applyMoveFast(clone, move, aiPlayerId)) continue;
                const score = minimax(clone, depth - 1, alpha, Infinity, false, aiPlayerId, ctx, 1);
                iterScores.push({ move, val: score });
                if (score > iterBestScore) {
                    iterBestScore = score;
                    iterBestMove = move;
                }
                if (score > alpha) alpha = score;
            }

            if (iterBestMove) {
                bestMove = iterBestMove;
                iterScores.sort((a, b) => b.val - a.val);
                scored = iterScores;
            }

            if (iterBestScore >= MATE_THRESHOLD) break; // forced win found
        }
    } catch (e) {
        if (e.message !== 'TIMEOUT') console.error('[AI] Error:', e);
    }

    // 5. Difficulty knob: sometimes pick a slightly worse move
    if (randomness > 0 && scored.length > 1 && Math.random() < randomness) {
        const k = Math.min(3, scored.length);
        const pick = scored[1 + Math.floor(Math.random() * (k - 1))];
        // Never randomly walk into a forced loss or throw away a forced win
        if (pick.val > -MATE_THRESHOLD && scored[0].val < MATE_THRESHOLD) {
            return pick.move;
        }
    }

    return bestMove;
}

module.exports = { getBestMove };
