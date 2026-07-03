const { ObjectId } = require('mongodb');
const { initializeBoard } = require('../rules/initBoard');
const { applyAction, computeLaserPath, applyDestructions } = require('../rules/actions');
const aiAdapter = require('../ai/aiAdapter');

const ONLINE_MODES = ['online', 'ranked_challenge', 'unranked'];
const TURN_CLOCK_MS = 60_000;        // per-turn time budget (online modes)
const GRACE_BUDGET_MS = 90_000;      // cumulative disconnect grace per player per game

class Game {
    constructor(id, mode, io, player1UserId = null, player2UserId = null, player1Elo = 600, player2Elo = 600, usersCollection = null, matchRecorder = null) {
        this.id = id;
        this.mode = mode; // local | ai | online | ranked_challenge | unranked
        this.io = io;     // Reference to socket.io server
        this.players = new Map(); // socketId → playerId (0 or 1) — used for online games
        this.userIds = { 0: player1UserId, 1: player2UserId };
        this.elos = { 0: player1Elo, 1: player2Elo };
        this.restartVotes = new Set(); // Track which players voted to restart
        this.usersCollection = usersCollection;
        this.matchRecorder = matchRecorder;
        this.aiDifficulty = 'hard'; // easy | medium | hard (ai mode only)

        // Disconnect grace: cumulative budget, not a fresh window per drop
        this.reconnectTimers = {};            // playerId → setTimeout handle
        this.disconnectedPlayers = new Set(); // playerIds currently in grace period
        this.graceRemaining = { 0: GRACE_BUDGET_MS, 1: GRACE_BUDGET_MS };
        this.disconnectedAt = {};             // playerId → timestamp of last drop

        // Turn clock (starts once both seats have joined)
        this.turnTimer = null;
        this.clockStarted = false;
        this.seatsJoined = new Set();

        // Lifecycle
        this.ended = false;
        this.endedAt = null;
        this.lastActivityAt = Date.now();

        // Initial State
        this.state = {
            board: initializeBoard(),
            turn: 0,
            turnCount: 0,
            reserves: { 0: 7, 1: 7 },
            pendingReserves: { 0: [], 1: [] },
            winner: { 0: false, 1: false },
            swapHistory: { 0: { Sphinx: -10, Pharaoh: -10 }, 1: { Sphinx: -10, Pharaoh: -10 } }
        };
        this.initialBoardSnapshot = JSON.parse(JSON.stringify(this.state.board));
    }

    isOnline() {
        return ONLINE_MODES.includes(this.mode);
    }

    handleMove(action, playerId) {
        if (this.ended) throw new Error("Game is over");

        // Server-side turn enforcement for online games
        if (this.isOnline() && this.state.turn !== playerId) {
            throw new Error("Not your turn");
        }

        // 1. Logic
        const laserShouldFire = applyAction(this.state, action, playerId);
        const boardSnapshot = JSON.parse(JSON.stringify(this.state.board));
        const laserResult = computeLaserPath(this.state, playerId, laserShouldFire);

        if (laserResult)
            applyDestructions(this.state, laserResult.hitCoords);

        this.lastActivityAt = Date.now();
        if (this.isOnline() && this.matchRecorder) {
            this.matchRecorder.recordMove(this.id, playerId, action, this.state.turnCount);
        }

        if (this.state.winner[0] === false && this.state.winner[1] === false && this.state.canPassTurn) {
            this.state.turn = (this.state.turn + 1) % 2;
            this.state.turnCount = (this.state.turnCount || 0) + 1;

            console.log(`Turn ended. Now Player ${this.state.turn}'s turn. (Total: ${this.state.turnCount})`);

            const currentPlayer = this.state.turn;
            const pendingList = this.state.pendingReserves[currentPlayer];

            for (let i = pendingList.length - 1; i >= 0; i--) {
                const unlockTime = pendingList[i];

                if (this.state.turnCount >= unlockTime) {
                    this.state.reserves[currentPlayer] += 1;
                    pendingList.splice(i, 1);
                    console.log(`P${currentPlayer} received a Pyramid from reserve queue!`);
                }
            }
            this.state.canPassTurn = false;

            if (this.clockStarted) this.startTurnClock();
        }

        this.io.to(this.id).emit('game:action_response', {
            boardAfterMove: boardSnapshot,
            laserResult: laserResult,
            finalState: this.state
        });

        if (this.state.winner[0] === true || this.state.winner[1] === true) {
            const reason = (this.state.winner[0] && this.state.winner[1]) ? 'draw' : 'elimination';
            this.endGame(reason);
        } else {
            if (this.mode === 'ai' && playerId === 0) {
                this.lastHumanAction = action;
            }
            if (this.mode === 'ai' && this.state.turn === 1) {
                // Short cosmetic delay; the bot's own search budget (~800ms)
                // makes up the rest of a natural-feeling thinking pause.
                setTimeout(() => {
                    this.playAITurn();
                }, 1500);
            }
        }

        return true; // Success
    }

    // ── Turn clock ────────────────────────────────────────────────────────────

    /** Called when a seat joins. Starts the clock once both players are present. */
    registerSeatJoined(playerId) {
        this.seatsJoined.add(playerId);
        if (!this.clockStarted && this.seatsJoined.size === 2 && this.isOnline() && !this.ended) {
            this.clockStarted = true;
            this.startTurnClock();
        }
    }

    startTurnClock() {
        if (this.turnTimer) clearTimeout(this.turnTimer);
        const deadline = Date.now() + TURN_CLOCK_MS;
        this.io.to(this.id).emit('game:turn_deadline', { playerId: this.state.turn, deadline });

        this.turnTimer = setTimeout(() => {
            const slowPlayer = this.state.turn;
            console.log(`[Game ${this.id}] Player ${slowPlayer} ran out of time`);
            this.forfeit(slowPlayer, 'timeout');
        }, TURN_CLOCK_MS);
    }

    /** Award the win to playerId's opponent and end the game. */
    forfeit(playerId, reason) {
        if (this.ended) return;
        const opponentId = playerId === 0 ? 1 : 0;
        this.state.winner[opponentId] = true;
        this.endGame(reason);
    }

    // ── Disconnect / departure handling ───────────────────────────────────────

    /**
     * A seated player dropped (network) or left intentionally.
     * Draws from the player's cumulative grace budget; forfeits when exhausted.
     */
    handleDeparture(playerId) {
        if (this.ended || this.disconnectedPlayers.has(playerId)) return;

        const remaining = this.graceRemaining[playerId];
        if (remaining <= 0) {
            console.log(`[Game ${this.id}] Player ${playerId} has no grace budget left — forfeit`);
            this.forfeit(playerId, 'forfeit');
            return;
        }

        this.disconnectedPlayers.add(playerId);
        this.disconnectedAt[playerId] = Date.now();
        this.io.to(this.id).emit('game:player_disconnected', {
            playerId,
            timeoutSeconds: Math.ceil(remaining / 1000)
        });
        console.log(`[Game ${this.id}] Player ${playerId} disconnected — ${Math.ceil(remaining / 1000)}s grace remaining`);

        this.reconnectTimers[playerId] = setTimeout(() => {
            this.disconnectedPlayers.delete(playerId);
            this.graceRemaining[playerId] = 0;
            console.log(`[Game ${this.id}] Grace expired for Player ${playerId}`);
            this.forfeit(playerId, 'forfeit');
        }, remaining);
    }

    /** Player rejoined within grace: stop the timer and deduct the time used. */
    handleReconnect(playerId) {
        if (!this.disconnectedPlayers.has(playerId)) return false;

        clearTimeout(this.reconnectTimers[playerId]);
        delete this.reconnectTimers[playerId];
        this.disconnectedPlayers.delete(playerId);

        const used = Date.now() - (this.disconnectedAt[playerId] || Date.now());
        this.graceRemaining[playerId] = Math.max(0, this.graceRemaining[playerId] - used);
        console.log(`[Game ${this.id}] Player ${playerId} reconnected (${Math.ceil(this.graceRemaining[playerId] / 1000)}s grace left)`);
        return true;
    }

    clearAllTimers() {
        if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
        for (const pid of Object.keys(this.reconnectTimers)) {
            clearTimeout(this.reconnectTimers[pid]);
            delete this.reconnectTimers[pid];
        }
        this.disconnectedPlayers.clear();
    }

    // ── Game end ──────────────────────────────────────────────────────────────

    /**
     * Single exit point for a finished game. Guarded so Elo/coins/records
     * can never be applied twice.
     */
    endGame(reason) {
        if (this.ended) return;
        this.ended = true;
        this.endedAt = Date.now();
        this.clearAllTimers();

        const forfeitLike = ['forfeit', 'timeout'].includes(reason);
        this.io.to(this.id).emit('game:over', { ...this.state.winner, reason, forfeit: forfeitLike });

        if (['online', 'ranked_challenge'].includes(this.mode)) {
            this.applyEloAndCoins();
        }
        if (this.isOnline() && this.matchRecorder) {
            this.matchRecorder.finishMatch(this, reason);
        }
    }

    resetGameState() {
        // Archive the finished record before reusing the gameId
        if (this.isOnline() && this.matchRecorder) {
            this.matchRecorder.archiveForRestart(this.id).then(() => {
                this.matchRecorder.createMatch(this);
            });
        }

        this.state.board = initializeBoard();
        this.state.turn = 0;
        this.state.reserves = { 0: 7, 1: 7 };
        this.state.winner = { 0: false, 1: false };
        this.state.turnCount = 0;
        this.state.swapHistory = {
            0: { Sphinx: -10, Pharaoh: -10 },
            1: { Sphinx: -10, Pharaoh: -10 }
        };
        this.state.pendingReserves = { 0: [], 1: [] };
        this.state.canPassTurn = false;
        this.restartVotes.clear();
        this.initialBoardSnapshot = JSON.parse(JSON.stringify(this.state.board));

        // Fresh lifecycle for the rematch
        this.clearAllTimers();
        this.ended = false;
        this.endedAt = null;
        this.lastActivityAt = Date.now();
        this.graceRemaining = { 0: GRACE_BUDGET_MS, 1: GRACE_BUDGET_MS };
        this.disconnectedAt = {};
        if (this.clockStarted) this.startTurnClock();
    }

    /**
     * Vote to restart. Only seated players count. Returns true when both voted.
     */
    voteRestart(playerId) {
        if (playerId !== 0 && playerId !== 1) return false;
        this.restartVotes.add(playerId);
        return this.restartVotes.size >= 2;
    }

    applyEloAndCoins() {
        let p0Result = 0.5;
        let p1Result = 0.5;

        // Both true = equality
        if (this.state.winner[0] === true && this.state.winner[1] === false) {
            p0Result = 1;
            p1Result = 0;
        } else if (this.state.winner[1] === true && this.state.winner[0] === false) {
            p0Result = 0;
            p1Result = 1;
        }

        const newElo0 = this.computeNewElo(this.elos[0], this.elos[1], p0Result);
        const newElo1 = this.computeNewElo(this.elos[1], this.elos[0], p1Result);

        const deltaElo0 = newElo0 - this.elos[0];
        const deltaElo1 = newElo1 - this.elos[1];

        console.log(`[Game] Online game ended. P0 Elo: ${this.elos[0]} -> ${newElo0}. P1 Elo: ${this.elos[1]} -> ${newElo1}`);

        // Update DB
        this.updateEloInDb(this.userIds[0], newElo0);
        this.updateEloInDb(this.userIds[1], newElo1);
        // Only award coins in regular matchmaking, not friend challenges
        if (this.mode === 'online') {
            this.updateCoinsInDb(this.userIds[0], deltaElo0);
            this.updateCoinsInDb(this.userIds[1], deltaElo1);
        }

        // Update internal cache
        this.elos[0] = newElo0;
        this.elos[1] = newElo1;

        // Emit updated stats (elo and coins) to players for UI update
        this.io.to(this.id).emit('game:stats_update', {
            0: { elo: newElo0, deltaCoins: deltaElo0 },
            1: { elo: newElo1, deltaCoins: deltaElo1 }
        });
    }

    computeNewElo(playerElo, opponentElo, result, K = 20) {
        const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
        return Math.round(playerElo + K * (result - expected));
    }

    async playAITurn() {
        if (this.ended || this.state.winner[0] || this.state.winner[1] || this.mode !== 'ai' || this.state.turn !== 1) return;

        try {
            if (this.state.turnCount === 1) {
                await aiAdapter.initializeAI({ board: this.initialBoardSnapshot });
            }

            console.log(`L'IA réfléchit... (${this.aiDifficulty})`);
            const engineFormattedBotMove = await aiAdapter.askBot(
                this.lastHumanAction,
                this.state,
                aiAdapter.getTierOptions(this.aiDifficulty)
            );

            if (engineFormattedBotMove) {
                console.log("L'IA a choisi de jouer :", engineFormattedBotMove);
                this.handleMove(engineFormattedBotMove, 1);
            }
        } catch (error) {
            console.error("Erreur critique de l'Adaptateur IA :", error);
        }
    }

    async updateEloInDb(userId, newElo) {
        if (!userId || !this.usersCollection || !ObjectId.isValid(userId)) return;

        try {
            const result = await this.usersCollection.updateOne(
                { _id: ObjectId.createFromHexString(userId) },
                { $set: { elo: newElo } }
            );
            console.log(`[Game] Elo Update Result matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);
        } catch (e) {
            console.error(`[Game] Error strictly committing Elo to MongoDB: ${e.message}`);
        }
    }

    async updateCoinsInDb(userId, deltaCoins) {
        if (!userId || !this.usersCollection || !ObjectId.isValid(userId)) return;

        try {
            const result = await this.usersCollection.updateOne(
                { _id: ObjectId.createFromHexString(userId) },
                { $inc: { coins: deltaCoins } }
            );
            console.log(`[Game] Coins Update Result matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);
        } catch (e) {
            console.error(`[Game] Error strictly committing Coins to MongoDB: ${e.message}`);
        }
    }
}

module.exports = Game;
