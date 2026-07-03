const crypto = require('crypto');
const Game = require('../models/Game');

const SWEEP_INTERVAL_MS = 60_000;
const ENDED_TTL_MS = 10 * 60_000;      // keep finished games joinable for rematch votes
const INACTIVE_TTL_MS = 2 * 60 * 60_000; // drop games with no activity (never-started, abandoned local)

class GameManager {
    constructor(io) {
        this.io = io;
        this.games = new Map(); // Stores active game sessions
        this.usersCollection = null;
        this.matchRecorder = null;

        setInterval(() => this.sweep(), SWEEP_INTERVAL_MS).unref();
    }

    setUsersCollection(collection) {
        this.usersCollection = collection;
    }

    setMatchRecorder(recorder) {
        this.matchRecorder = recorder;
    }

    createGame(mode = 'local', player1UserId = null, player2UserId = null, player1Elo = 600, player2Elo = 600) {
        const gameId = crypto.randomUUID();

        const game = new Game(gameId, mode, this.io, player1UserId, player2UserId, player1Elo, player2Elo, this.usersCollection, this.matchRecorder);
        this.games.set(gameId, game);

        if (game.isOnline() && this.matchRecorder) {
            this.matchRecorder.createMatch(game);
        }

        console.log(`[GameManager] Game created: ${gameId} (Mode: ${mode})`);
        return game;
    }

    getGame(gameId) {
        return this.games.get(gameId);
    }

    deleteGame(gameId) {
        const game = this.games.get(gameId);
        if (game) {
            game.clearAllTimers();
            this.games.delete(gameId);
            console.log(`[GameManager] Game deleted: ${gameId}`);
        }
    }

    /** Reclaim finished and abandoned games so gameIds don't stay joinable forever. */
    sweep() {
        const now = Date.now();
        for (const [gameId, game] of this.games) {
            const finished = game.ended && now - game.endedAt > ENDED_TTL_MS;
            const abandoned = !game.ended && now - game.lastActivityAt > INACTIVE_TTL_MS;
            if (finished || abandoned) {
                this.deleteGame(gameId);
            }
        }
    }
}

module.exports = GameManager;
