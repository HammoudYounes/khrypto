const Game = require('../models/Game'); 

class GameManager {
    constructor(io) {
        this.io = io;
        this.games = new Map(); // Stores active game sessions
    }

    createGame(mode = 'local') {
        const gameId = Math.random().toString(36).substr(2, 5);
        
        const game = new Game(gameId, mode, this.io);
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