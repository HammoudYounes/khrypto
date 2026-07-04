/**
 * IntegrityAnalyzer — post-match machine-assistance detection.
 *
 * Every online match already leaves a tamper-evident record (full move list
 * with server timestamps + the initial board). This worker re-simulates each
 * finished match through the real rules engine and scores each player on:
 *
 *   1. ENGINE AGREEMENT — how often their moves equal the strong search
 *      bot's choice for the same position. A player literally running the
 *      Khrypto bot (the realistic assistance vector) matches near-100%.
 *   2. SPEED — median think time. Engine-strength moves at machine speed
 *      is the combination humans can't produce.
 *   3. RHYTHM — coefficient of variation of think times. Humans are
 *      erratic (fast forced moves, long thinks); scripts are metronomic.
 *
 * Verdicts are conservative: 'suspect' requires HIGH engine agreement over
 * a meaningful sample COMBINED with machine-like timing. Short games are
 * 'insufficient' (no evidence either way). Enforcement is loss-limited:
 * suspect wager matches are refunded (never paid out), and repeat suspects
 * lose wager access pending review — false positives cost a refund, not
 * confiscation.
 */
const bot = require('../ai/smartBot');
const { applyAction, computeLaserPath, applyDestructions } = require('../rules/actions');
const { Sphinx } = require('../rules/pieces/Sphinx');
const { Pharaoh } = require('../rules/pieces/Pharaoh');
const { Anubis } = require('../rules/pieces/Anubis');
const { Pyramid } = require('../rules/pieces/Pyramid');
const { Scarab } = require('../rules/pieces/Scarab');

const PIECE_CLASSES = { Sphinx, Pharaoh, Anubis, Pyramid, Scarab };

// Tunables (env-overridable)
const ANALYZE_INTERVAL_MS = parseInt(process.env.INTEGRITY_INTERVAL_MS || '15000', 10);
const BOT_BUDGET_MS = parseInt(process.env.INTEGRITY_BOT_MS || '150', 10);
const MIN_MOVES = parseInt(process.env.INTEGRITY_MIN_MOVES || '8', 10);       // per player
const SKIP_OPENING_MOVES = 2;                                                  // first N moves per player ignored
const SUSPECT_THRESHOLD = parseInt(process.env.INTEGRITY_SUSPECT_SCORE || '70', 10);
const WATCH_THRESHOLD = 40;
const BAN_AFTER_SUSPECT_MATCHES = parseInt(process.env.INTEGRITY_BAN_AFTER || '3', 10);

const ANALYZED_MODES = ['online', 'wager', 'ranked_challenge'];

function reviveBoard(plainBoard) {
    return plainBoard.map(row => row.map(p => {
        if (!p) return null;
        const Cls = PIECE_CLASSES[p.type];
        return Cls ? new Cls(p.player, p.orientation) : null;
    }));
}

function sameMove(a, b) {
    return a && b && a.type === b.type && a.x === b.x && a.y === b.y &&
        a.destX === b.destX && a.destY === b.destY &&
        a.targetX === b.targetX && a.targetY === b.targetY &&
        a.direction === b.direction && a.orientation === b.orientation;
}

function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function coefficientOfVariation(arr) {
    if (arr.length < 2) return 1;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (mean <= 0) return 1;
    const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance) / mean;
}

class IntegrityAnalyzer {
    constructor() {
        this.matches = null;
        this.users = null;
        this.running = false;
    }

    setCollections(matches, users) {
        this.matches = matches;
        this.users = users;
    }

    start() {
        setInterval(() => this.tick().catch(e => console.error('[Integrity] tick error:', e.message)),
            ANALYZE_INTERVAL_MS).unref();
        console.log(`[Integrity] Analyzer running (bot budget ${BOT_BUDGET_MS}ms, suspect ≥ ${SUSPECT_THRESHOLD}, ban after ${BAN_AFTER_SUSPECT_MATCHES})`);
    }

    async tick() {
        if (this.running || !this.matches) return;
        this.running = true;
        try {
            // Wager matches first: their settlement is waiting on the verdict
            const query = { status: 'finished', integrity: { $exists: false }, mode: { $in: ANALYZED_MODES } };
            let match = await this.matches.findOne({ ...query, mode: 'wager' });
            if (!match) match = await this.matches.findOne(query);
            if (match) await this.analyzeMatch(match);
        } finally {
            this.running = false;
        }
    }

    async analyzeMatch(match) {
        const started = Date.now();
        let report;
        try {
            report = this.buildReport(match);
        } catch (e) {
            console.error(`[Integrity] analysis failed for ${match.gameId}:`, e.message);
            report = { error: e.message, verdicts: { 0: 'error', 1: 'error' }, perPlayer: {} };
        }
        report.analyzedAt = new Date();
        report.analysisMs = Date.now() - started;

        await this.matches.updateOne({ _id: match._id }, { $set: { integrity: report } });
        console.log(`[Integrity] ${match.gameId} (${match.mode}): P0=${report.verdicts[0]} P1=${report.verdicts[1]} (${report.analysisMs}ms)`);

        // Repeat suspects lose wager access pending manual review
        for (const seat of [0, 1]) {
            if (report.verdicts[seat] !== 'suspect') continue;
            const userId = match.users?.[String(seat)];
            if (!userId || !this.users) continue;
            const { ObjectId } = require('mongodb');
            if (!ObjectId.isValid(userId)) continue;
            const updated = await this.users.findOneAndUpdate(
                { _id: ObjectId.createFromHexString(userId) },
                { $inc: { integritySuspectCount: 1 } },
                { returnDocument: 'after' }
            );
            const count = updated?.integritySuspectCount ?? updated?.value?.integritySuspectCount;
            if (count >= BAN_AFTER_SUSPECT_MATCHES) {
                await this.users.updateOne(
                    { _id: ObjectId.createFromHexString(userId) },
                    { $set: { wagerBanned: true, wagerBannedAt: new Date() } }
                );
                console.warn(`[Integrity] user ${userId} wager-banned after ${count} suspect matches`);
            }
        }
    }

    /**
     * Re-simulates the match and scores both players. Pure computation.
     */
    buildReport(match) {
        const moves = match.moves || [];
        const perPlayer = {
            0: { moves: 0, engineMatches: 0, analyzed: 0, thinkTimes: [], fastStrongMoves: 0 },
            1: { moves: 0, engineMatches: 0, analyzed: 0, thinkTimes: [], fastStrongMoves: 0 }
        };

        if (!match.initialBoard || moves.length < MIN_MOVES) {
            return {
                verdicts: { 0: 'insufficient', 1: 'insufficient' },
                perPlayer: this.finalizeStats(perPlayer),
                reason: !match.initialBoard ? 'no initial board recorded' : 'too few moves'
            };
        }

        const state = {
            board: reviveBoard(match.initialBoard),
            turn: 0, turnCount: 0,
            reserves: { 0: 7, 1: 7 },
            pendingReserves: { 0: [], 1: [] },
            winner: { 0: false, 1: false },
            swapHistory: { 0: { Sphinx: -10, Pharaoh: -10 }, 1: { Sphinx: -10, Pharaoh: -10 } },
            canPassTurn: false
        };

        let prevTimestamp = null;
        for (const mv of moves) {
            const pid = mv.p;
            const stats = perPlayer[pid];
            if (!stats) break;
            stats.moves++;

            // Think time ≈ gap since the previous recorded move
            const t = new Date(mv.t).getTime();
            if (prevTimestamp !== null) {
                const dt = t - prevTimestamp;
                if (dt > 0 && dt < 10 * 60_000) stats.thinkTimes.push(dt);
            }
            prevTimestamp = t;

            // Engine agreement (skip each player's opening moves — openings
            // are convergent even for humans)
            const engineBest = stats.moves > SKIP_OPENING_MOVES
                ? bot.getBestMove(state, pid, { timeLimitMs: BOT_BUDGET_MS, maxDepth: 4 })
                : null;

            if (engineBest) {
                stats.analyzed++;
                if (sameMove(mv.action, engineBest)) {
                    stats.engineMatches++;
                    const lastThink = stats.thinkTimes[stats.thinkTimes.length - 1];
                    if (lastThink !== undefined && lastThink < 2000) stats.fastStrongMoves++;
                }
            }

            // Apply the real move via the real rules to advance the position
            try {
                const fire = applyAction(state, mv.action, pid);
                const laser = computeLaserPath(state, pid, fire);
                if (laser) applyDestructions(state, laser.hitCoords);
                if (!state.winner[0] && !state.winner[1] && state.canPassTurn) {
                    state.turn = (state.turn + 1) % 2;
                    state.turnCount++;
                    const pl = state.pendingReserves[state.turn];
                    for (let i = pl.length - 1; i >= 0; i--) {
                        if (state.turnCount >= pl[i]) { state.reserves[state.turn]++; pl.splice(i, 1); }
                    }
                    state.canPassTurn = false;
                }
            } catch (e) {
                // Recorded move failed to replay — stop analysis here
                break;
            }
        }

        const finalized = this.finalizeStats(perPlayer);
        const verdicts = {};
        for (const seat of [0, 1]) verdicts[seat] = this.verdictFor(finalized[seat]);
        return { verdicts, perPlayer: finalized };
    }

    finalizeStats(perPlayer) {
        const out = {};
        for (const seat of [0, 1]) {
            const s = perPlayer[seat];
            out[seat] = {
                moves: s.moves,
                analyzed: s.analyzed,
                engineMatchRate: s.analyzed ? +(s.engineMatches / s.analyzed).toFixed(3) : null,
                fastStrongMoves: s.fastStrongMoves,
                medianThinkMs: Math.round(median(s.thinkTimes)),
                timingCV: +coefficientOfVariation(s.thinkTimes).toFixed(3),
                score: 0
            };
        }
        return out;
    }

    /**
     * Conservative composite scoring. Engine agreement is the required core
     * signal — timing alone can only raise a 'watch', never a 'suspect'.
     */
    verdictFor(s) {
        if (s.analyzed < MIN_MOVES - SKIP_OPENING_MOVES) return 'insufficient';

        let score = 0;
        const rate = s.engineMatchRate ?? 0;

        if (rate >= 0.9) score += 60;
        else if (rate >= 0.8) score += 45;
        else if (rate >= 0.7) score += 25;

        if (s.medianThinkMs > 0 && s.medianThinkMs < 1500) score += 25;
        else if (s.medianThinkMs > 0 && s.medianThinkMs < 3000) score += 15;

        if (s.timingCV < 0.2) score += 15;

        if (s.fastStrongMoves >= 5) score += 10;

        s.score = score;

        // Hard requirement: no 'suspect' without strong engine agreement
        if (score >= SUSPECT_THRESHOLD && rate >= 0.75) return 'suspect';
        if (score >= WATCH_THRESHOLD) return 'watch';
        return 'clear';
    }
}

module.exports = IntegrityAnalyzer;
