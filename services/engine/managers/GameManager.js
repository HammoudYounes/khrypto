const Game = require('../models/Game');

class GameManager {
    constructor(io) {
        this.io = io;
        this.games = new Map(); // Stores active game sessions
        this.usersCollection = null;
    }

    setUsersCollection(collection) {
        this.usersCollection = collection;
    }

    createGame(mode = 'local', player1UserId = null, player2UserId = null, player1Elo = 600, player2Elo = 600) {
        const gameId = Math.random().toString(36).substr(2, 5);

        const game = new Game(gameId, mode, this.io, player1UserId, player2UserId, player1Elo, player2Elo, this.usersCollection);
        this.games.set(gameId, game);

        console.log(`[GameManager] Game created: ${gameId} (Mode: ${mode})`);
        return game;
    }

    getGame(gameId) {
        return this.games.get(gameId);
    }

    deleteGame(gameId) {
        if (this.games.has(gameId)) {
            this.games.delete(gameId);
            console.log(`[GameManager] Game deleted: ${gameId}`);
        }
    }
}

module.exports = GameManager;