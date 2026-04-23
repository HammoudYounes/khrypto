'use strict';

// ┌─────────────────────────────────────────────────────────────────────────┐
// │  Khrypto AI — standalone submission file                                │
// │                                                                         │
// │  Exports:                                                               │
// │    setup(initialPositions, isFirstPlayer) → Promise<true>              │
// │    nextMove(opponentAction) → Promise<Action>                           │
// │                                                                         │
// │  Coordinate convention (Cell encoding):                                 │
// │    Cell n → col = n % 10, row = Math.floor(n / 10)                     │
// │    Engine board[y][x] where y = row, x = col                           │
// │    Cell 0 = bottom-left corner (row 0, col 0)                          │
// └─────────────────────────────────────────────────────────────────────────┘

const BOARD_SIZE = 10;
const DX = [0, 1, 0, -1]; // NORTH=0, EAST=1, SOUTH=2, WEST=3
const DY = [-1, 0, 1, 0];

// ── Laser (mirrors engine logic exactly) ─────────────────────────────────────

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

// ── State clone ───────────────────────────────────────────────────────────────

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
    return {
        board,
        turn: state.turn,
        turnCount: state.turnCount,
        reserves: { 0: state.reserves[0], 1: state.reserves[1] },
        winner: { 0: state.winner[0], 1: state.winner[1] },
        swapHistory: {
            0: { Sphinx: state.swapHistory[0].Sphinx, Pharaoh: state.swapHistory[0].Pharaoh },
            1: { Sphinx: state.swapHistory[1].Sphinx, Pharaoh: state.swapHistory[1].Pharaoh },
        },
    };
}

// ── Move application ──────────────────────────────────────────────────────────

function applyMoveFast(state, move, playerId) {
    const { type, x, y } = move;
    let laserShouldFire = true;

    switch (type) {
        case 'PLACE':
            if (state.board[y][x] !== null) return false;
            if (state.reserves[playerId] <= 0) return false;
            state.board[y][x] = { type: 'Pyramid', player: playerId, orientation: move.orientation };
            state.reserves[playerId]--;
            break;
        case 'MOVE': {
            const src = state.board[y][x];
            if (!src || src.player !== playerId) return false;
            if (state.board[move.destY][move.destX] !== null) return false;
            state.board[move.destY][move.destX] = src;
            state.board[y][x] = null;
            break;
        }
        case 'ROTATE': {
            const p = state.board[y][x];
            if (!p || p.player !== playerId) return false;
            p.orientation = ((p.orientation + move.direction) % 4 + 4) % 4;
            break;
        }
        case 'SWAP': {
            const scarab = state.board[y][x];
            if (!scarab || scarab.player !== playerId) return false;
            const target = state.board[move.targetY][move.targetX];
            if (!target || target.player !== playerId) return false;
            state.board[y][x] = target;
            state.board[move.targetY][move.targetX] = scarab;
            state.swapHistory[playerId][target.type] = state.turnCount;
            if (target.type === 'Sphinx') laserShouldFire = false;
            break;
        }
        default: return false;
    }

    if (laserShouldFire) {
        const hits = traceLaser(state.board, playerId);
        for (const { x: hx, y: hy, piece } of hits) {
            if (piece.type === 'Pharaoh') {
                state.winner[(piece.player + 1) % 2] = true;
            } else if (piece.type === 'Pyramid') {
                state.reserves[(piece.player + 1) % 2]++;
            }
            state.board[hy][hx] = null;
        }
    }

    state.turn = 1 - state.turn;
    state.turnCount++;
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

const MAT = { Pharaoh: 0, Sphinx: 0, Scarab: 80, Anubis: 40, Pyramid: 20 };

function evaluate(state, aiPlayer) {
    if (state.winner[aiPlayer])     return  999999;
    if (state.winner[1 - aiPlayer]) return -999999;

    const opp = 1 - aiPlayer;
    let score = 0;

    const myLaser  = traceLaserFull(state.board, aiPlayer);
    const oppLaser = traceLaserFull(state.board, opp);

    for (const { piece } of myLaser.hits) {
        if (piece.type === 'Pharaoh' && piece.player === opp)      return  900000;
        if (piece.type === 'Pharaoh' && piece.player === aiPlayer) return -900000;
        score += piece.player === opp ? 150 : -250;
    }
    for (const { piece } of oppLaser.hits) {
        if (piece.type === 'Pharaoh' && piece.player === aiPlayer) return -900000;
        if (piece.type === 'Pharaoh' && piece.player === opp)      score += 60;
        else score += piece.player === aiPlayer ? -150 : 40;
    }

    let myPharX = -1, myPharY = -1, oppPharX = -1, oppPharY = -1;
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const p = state.board[y][x];
            if (!p || p.type !== 'Pharaoh') continue;
            if (p.player === aiPlayer) { myPharX = x; myPharY = y; }
            else { oppPharX = x; oppPharY = y; }
        }
    }

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

    for (let y = 0; y < BOARD_SIZE; y++)
        for (let x = 0; x < BOARD_SIZE; x++) {
            const p = state.board[y][x];
            if (p) {
                const v = MAT[p.type] || 0;
                if (v) score += p.player === aiPlayer ? v : -v;
            }
        }

    score += (state.reserves[aiPlayer] - state.reserves[opp]) * 12;
    return score;
}

// ── Quiescence search ─────────────────────────────────────────────────────────

function isLoud(state, aiPlayer) {
    for (const { piece } of traceLaser(state.board, aiPlayer))
        if (piece.type === 'Pharaoh') return true;
    for (const { piece } of traceLaser(state.board, 1 - aiPlayer))
        if (piece.type === 'Pharaoh') return true;
    return false;
}

function quiesce(state, alpha, beta, aiPlayer, qdepth, deadline) {
    const standPat = evaluate(state, aiPlayer);
    if (standPat >= 999999)  return standPat;
    if (standPat <= -999999) return standPat;
    if (qdepth === 0 || !isLoud(state, aiPlayer)) return standPat;

    if (standPat >= beta) return standPat;
    if (standPat > alpha)  alpha = standPat;

    const currentPlayer = state.turn;
    const moves = getTacticalMoves(state, currentPlayer);
    const maximizing = currentPlayer === aiPlayer;

    if (maximizing) {
        let best = standPat;
        for (const move of moves) {
            if (Date.now() > deadline) break;
            const clone = cloneState(state);
            if (!applyMoveFast(clone, move, currentPlayer)) continue;
            const val = quiesce(clone, alpha, beta, aiPlayer, qdepth - 1, deadline);
            if (val > best) best = val;
            if (val > alpha) alpha = val;
            if (beta <= alpha) break;
        }
        return best;
    } else {
        let best = standPat;
        for (const move of moves) {
            if (Date.now() > deadline) break;
            const clone = cloneState(state);
            if (!applyMoveFast(clone, move, currentPlayer)) continue;
            const val = quiesce(clone, alpha, beta, aiPlayer, qdepth - 1, deadline);
            if (val < best) best = val;
            if (val < beta) beta = val;
            if (beta <= alpha) break;
        }
        return best;
    }
}

// ── Minimax + Alpha-Beta ──────────────────────────────────────────────────────

function minimax(state, depth, alpha, beta, maximizing, aiPlayer, deadline) {
    if (Date.now() > deadline) throw new Error('TIMEOUT');

    if (state.winner[aiPlayer])     return  999999 + depth;
    if (state.winner[1 - aiPlayer]) return -(999999 + depth);
    if (state.turnCount >= 100)     return 0;

    if (depth === 0) return quiesce(state, alpha, beta, aiPlayer, 2, deadline);

    const currentPlayer = maximizing ? aiPlayer : 1 - aiPlayer;

    const moves = getTacticalMoves(state, currentPlayer);
    if (depth >= 2 && state.reserves[currentPlayer] > 0) {
        const places = getBestPlacements(state, currentPlayer, depth >= 3 ? 4 : 2);
        for (const p of places) moves.push(p);
    }

    if (moves.length === 0) return evaluate(state, aiPlayer);

    if (maximizing) {
        let best = -Infinity;
        for (const move of moves) {
            const clone = cloneState(state);
            if (!applyMoveFast(clone, move, currentPlayer)) continue;
            const val = minimax(clone, depth - 1, alpha, beta, false, aiPlayer, deadline);
            if (val > best) best = val;
            if (val > alpha) alpha = val;
            if (beta <= alpha) break;
        }
        return best === -Infinity ? evaluate(state, aiPlayer) : best;
    } else {
        let best = Infinity;
        for (const move of moves) {
            const clone = cloneState(state);
            if (!applyMoveFast(clone, move, currentPlayer)) continue;
            const val = minimax(clone, depth - 1, alpha, beta, true, aiPlayer, deadline);
            if (val < best) best = val;
            if (val < beta) beta = val;
            if (beta <= alpha) break;
        }
        return best === Infinity ? evaluate(state, aiPlayer) : best;
    }
}

// ── Root search ───────────────────────────────────────────────────────────────

function getBestMove(engineState, aiPlayerId, timeLimitMs = 200) {
    const deadline = Date.now() + timeLimitMs;
    const state = cloneState(engineState);
    const opp = 1 - aiPlayerId;

    const allTactical = getTacticalMoves(state, aiPlayerId);
    for (const move of allTactical) {
        const clone = cloneState(state);
        applyMoveFast(clone, move, aiPlayerId);
        if (clone.winner[aiPlayerId]) {
            console.log('[AI] Immediate win');
            return move;
        }
    }

    const oppTactical = getTacticalMoves(state, opp);
    const oppWinMoves = [];
    for (const m of oppTactical) {
        const clone = cloneState(state);
        if (applyMoveFast(clone, m, opp) && clone.winner[opp]) oppWinMoves.push(m);
    }

    const bestPlacements = getBestPlacements(state, aiPlayerId, 12);
    const rootMoves = [...allTactical, ...bestPlacements];
    if (rootMoves.length === 0) return null;

    const scored = [];
    for (const move of rootMoves) {
        const clone = cloneState(state);
        if (!applyMoveFast(clone, move, aiPlayerId)) continue;

        if (clone.winner[aiPlayerId]) { scored.push({ move, val: 2000000 }); continue; }

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
    const orderedRoot = scored.map(s => s.move);
    let bestMove = orderedRoot[0];

    try {
        for (let depth = 1; depth <= 4; depth++) {
            if (Date.now() > deadline) break;

            let bestScore = -Infinity;
            let bestAtDepth = null;

            for (const move of orderedRoot) {
                if (Date.now() > deadline) throw new Error('TIMEOUT');
                const clone = cloneState(state);
                if (!applyMoveFast(clone, move, aiPlayerId)) continue;
                const score = minimax(clone, depth - 1, -Infinity, Infinity, false, aiPlayerId, deadline);
                if (score > bestScore) {
                    bestScore = score;
                    bestAtDepth = move;
                }
            }

            if (bestAtDepth) bestMove = bestAtDepth;

            if (bestScore >= 999999) {
                console.log(`[AI] Forced win at depth ${depth}`);
                break;
            }
        }
    } catch (e) {
        if (e.message !== 'TIMEOUT') console.error('[AI] Error:', e);
    }

    return bestMove;
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFESSOR'S PROTOCOL ADAPTER
// ═════════════════════════════════════════════════════════════════════════════

// ── Cell ↔ board coordinate conversion ───────────────────────────────────────
// Cell n → col = n % 10, row = Math.floor(n / 10)
// Engine board[y][x] where y = row, x = col

function cellToXY(cell) {
    return { x: cell % 10, y: Math.floor(cell / 10) };
}

function xyToCell(x, y) {
    return y * 10 + x;
}

// ── Orientation conversions ───────────────────────────────────────────────────

// Scarab: prof 0 → engine 0 (redirects west), prof 9 → engine 1 (redirects east)
function scarabProfToEngine(profOri) {
    return profOri === 0 ? 0 : 1;
}

// Pyramid: prof orientation = the corner Cell faced by the 2 reflective sides
//   prof 0  (bottom-left) → engine 2 (SOUTH)
//   prof 9  (bottom-right)→ engine 1 (EAST)
//   prof 90 (top-left)   → engine 3 (WEST)
//   prof 99 (top-right)  → engine 0 (NORTH)
function pyramidProfToEngine(profOri) {
    switch (profOri) {
        case 0:  return 2;
        case 9:  return 1;
        case 90: return 3;
        case 99: return 0;
        default: return 0;
    }
}

function pyramidEngineToProf(engineOri) {
    switch (engineOri) {
        case 0: return 99;
        case 1: return 9;
        case 2: return 0;
        case 3: return 90;
        default: return 0;
    }
}

// Sphinx orientation heuristic: left half → EAST (1), right half → WEST (3)
function sphinxOriFromCol(col) {
    return col < 5 ? 1 : 3;
}

// ── Initial board state builder ───────────────────────────────────────────────

function buildInitialState(initialPositions) {
    const board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));

    // First player = engine player 0
    const P1 = 0, P2 = 1;

    const { sphinx: sphinxCell, pharaoh: pharaohCell, scarab: scarabData } = initialPositions;

    const sXY  = cellToXY(sphinxCell);
    const pXY  = cellToXY(pharaohCell);
    const scXY = cellToXY(scarabData.position);

    // ── Player 1 (first player) pieces ───────────────────────────────────────
    board[sXY.y][sXY.x]   = { type: 'Sphinx',  player: P1, orientation: sphinxOriFromCol(sXY.x) };
    board[pXY.y][pXY.x]   = { type: 'Pharaoh', player: P1, orientation: 2 }; // faces SOUTH
    board[scXY.y][scXY.x] = { type: 'Scarab',  player: P1, orientation: scarabProfToEngine(scarabData.orientation) };

    // Derive Anubis positions from sphinx + pharaoh (matching engine initBoard logic):
    //   Anubis 1 → same col as Pharaoh, row 4
    //   Anubis 2 → col = 9 - sphinxCol (= mirror sphinx col), row 2
    const p2SphinxCol = 9 - sXY.x;
    if (!board[4][pXY.x])       board[4][pXY.x]       = { type: 'Anubis', player: P1, orientation: 2 };
    if (!board[2][p2SphinxCol]) board[2][p2SphinxCol]  = { type: 'Anubis', player: P1, orientation: 2 };

    // ── Player 2 (second player) = 180° mirror ────────────────────────────────
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const piece = board[y][x];
            if (piece && piece.player === P1) {
                const my = 9 - y, mx = 9 - x;
                if (!board[my][mx]) {
                    board[my][mx] = {
                        type: piece.type,
                        player: P2,
                        orientation: (piece.orientation + 2) % 4,
                    };
                }
            }
        }
    }

    return {
        board,
        turn: P1, // first player goes first
        turnCount: 0,
        reserves: { 0: 0, 1: 0 },
        winner:   { 0: false, 1: false },
        swapHistory: {
            0: { Sphinx: -100, Pharaoh: -100 },
            1: { Sphinx: -100, Pharaoh: -100 },
        },
    };
}

// ── Prof Action → Engine move ─────────────────────────────────────────────────

function profActionToEngineMove(action) {
    if (!action) return null;
    const { action: type, cell, result } = action;

    switch (type) {
        case 'ROTATE': {
            const { x, y } = cellToXY(cell);
            return { type: 'ROTATE', x, y, direction: result === 'CLOCKWISE' ? 1 : -1 };
        }
        case 'MOVE': {
            const { x, y } = cellToXY(cell);
            const dest = cellToXY(result);
            return { type: 'MOVE', x, y, destX: dest.x, destY: dest.y };
        }
        case 'PLACE': {
            const dest = cellToXY(result.destination);
            return { type: 'PLACE', x: dest.x, y: dest.y, orientation: pyramidProfToEngine(result.orientation) };
        }
        case 'EXCHANGE': {
            const { x, y } = cellToXY(cell);
            const target = cellToXY(result);
            return { type: 'SWAP', x, y, targetX: target.x, targetY: target.y };
        }
    }
    return null;
}

// ── Engine move → Prof Action ─────────────────────────────────────────────────

function engineMoveToProfAction(move, myPlayerId) {
    switch (move.type) {
        case 'ROTATE':
            return {
                action: 'ROTATE',
                cell:   xyToCell(move.x, move.y),
                result: move.direction === 1 ? 'CLOCKWISE' : 'ANTICLOCKWISE',
            };
        case 'MOVE':
            return {
                action: 'MOVE',
                cell:   xyToCell(move.x, move.y),
                result: xyToCell(move.destX, move.destY),
            };
        case 'PLACE':
            return {
                action: 'PLACE',
                cell:   myPlayerId === 0 ? -1 : -2, // reserve box
                result: {
                    destination: xyToCell(move.x, move.y),
                    orientation: pyramidEngineToProf(move.orientation),
                },
            };
        case 'SWAP':
            return {
                action: 'EXCHANGE',
                cell:   xyToCell(move.x, move.y),
                result: xyToCell(move.targetX, move.targetY),
            };
    }
    return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// STATE TRACKING
// ═════════════════════════════════════════════════════════════════════════════

let _state      = null;
let _myPlayerId = null;

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Called once at the start of the game.
 * @param {object}  initialPositions  - First player's starting piece positions.
 * @param {boolean} isFirstPlayer     - True if we are the first (moving) player.
 * @returns {Promise<true>}
 */
function setup(initialPositions, isFirstPlayer) {
    _myPlayerId = isFirstPlayer ? 0 : 1;
    _state      = buildInitialState(initialPositions);
    console.log(`[AI] Setup complete. We are player ${_myPlayerId}.`);
    return Promise.resolve(true);
}

/**
 * Called every turn with the opponent's last action.
 * @param {object|null} opponentAction - The opponent's action (null if we go first).
 * @returns {Promise<object>} - Our chosen action.
 */
function nextMove(opponentAction) {
    // 1. Apply the opponent's action to keep our state in sync
    if (opponentAction) {
        const oppMove = profActionToEngineMove(opponentAction);
        if (oppMove) {
            applyMoveFast(_state, oppMove, 1 - _myPlayerId);
        }
    }

    // 2. Ask the bot for the best move (200 ms budget, well within 250 ms limit)
    console.log('[AI] Computing best move...');
    const bestMove = getBestMove(_state, _myPlayerId, 200);

    if (!bestMove) {
        console.warn('[AI] No move found — this should not happen');
        return Promise.resolve(null);
    }

    console.log('[AI] Best move:', bestMove);

    // 3. Apply our move to advance the state
    applyMoveFast(_state, bestMove, _myPlayerId);

    // 4. Convert to the professor's format and return
    const action = engineMoveToProfAction(bestMove, _myPlayerId);
    return Promise.resolve(action);
}

module.exports = { setup, nextMove };
