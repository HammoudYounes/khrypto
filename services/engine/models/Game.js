const { ObjectId } = require('mongodb');
const { initializeBoard } = require('../rules/initBoard');
const { applyAction, computeLaserPath, applyDestructions } = require('../rules/actions');

class Game {
    constructor(id, mode, io, player1UserId = null, player2UserId = null, player1Elo = 600, player2Elo = 600, usersCollection = null) {
        this.id = id;
        this.mode = mode; // local ai online
        this.io = io;     // Reference to socket.io server
        this.players = new Map(); // socketId → playerId (0 or 1) — used for online games
        this.userIds = { 0: player1UserId, 1: player2UserId };
        this.elos = { 0: player1Elo, 1: player2Elo };
        this.restartVotes = new Set(); // Track which players voted to restart
        this.usersCollection = usersCollection;
        this.reconnectTimers = {};           // playerId → setTimeout handle
        this.disconnectedPlayers = new Set(); // playerIds currently in grace period

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
    }

    handleMove(action, playerId) {
        // Server-side turn enforcement for online games
        if (['online', 'ranked_challenge', 'unranked'].includes(this.mode) && this.state.turn !== playerId) {
            throw new Error("Not your turn");
        }

        try {
            // 1. Logic
            const laserShouldFire = applyAction(this.state, action, playerId);
            const boardSnapshot = JSON.parse(JSON.stringify(this.state.board));
            const laserResult = computeLaserPath(this.state, playerId, laserShouldFire);

            if (laserResult)
                applyDestructions(this.state, laserResult.hitCoords);


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
            }

            this.io.to(this.id).emit('game:action_response', {
                boardAfterMove: boardSnapshot,
                laserResult: laserResult,
                finalState: this.state
            });

            if (this.state.winner[0] === true || this.state.winner[1] === true) {
                this.io.to(this.id).emit('game:over', this.state.winner);
                this.handleGameOver();
            }

            return true; // Success

        } catch (error) {
            throw error;
        }
    }

    resetGameState() {
        this.state.board = initializeBoard(),
            this.state.turn = 0,
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
    }

    /**
     * Vote to restart. Returns true when both players have voted.
     */
    voteRestart(playerId) {
        this.restartVotes.add(playerId);
        return this.restartVotes.size >= 2;
    }

    startReconnectTimer(playerId, onTimeout) {
        this.disconnectedPlayers.add(playerId);
        this.reconnectTimers[playerId] = setTimeout(() => {
            this.disconnectedPlayers.delete(playerId);
            onTimeout();
        }, 60_000);
    }

    clearReconnectTimer(playerId) {
        if (this.reconnectTimers[playerId]) {
            clearTimeout(this.reconnectTimers[playerId]);
            delete this.reconnectTimers[playerId];
            this.disconnectedPlayers.delete(playerId);
        }
    }

    handleGameOver() {
        if (!['online', 'ranked_challenge'].includes(this.mode)) return;

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