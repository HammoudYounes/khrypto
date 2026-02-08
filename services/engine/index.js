const http = require('http');
const { Server } = require('socket.io');
const corsHelper = require('./helpers/cors.js');
const GameManager = require('./managers/GameManager');

const server = http.createServer((req, res) => {
    corsHelper.addCors(res);
});



const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    path: '/socket.io'
});

const gameManager = new GameManager(io);




io.on('connection', (socket) => {

    // 1. Player wants to start a game
    socket.on('game:create', (mode) => {
        // mode could be 'local' or 'ai'

        const game = gameManager.createGame(mode);

        console.log(`[Engine] Game created: ${game.id}, Mode: ${mode}`);

        // Send Game ID back to client
        socket.emit('game:created', { gameId: game.id });
    });

    socket.on('game:join', (data) => {
        console.log(`[Engine] Attempting to join game: ${data.gameId}`);
        console.log(`[Engine] Available games:`, Array.from(gameManager.games.keys()));

        const game = gameManager.getGame(data.gameId);
        if (game) {
            console.log(`[Engine] Game found! Joining: ${data.gameId}`);
            socket.join(data.gameId);
            socket.emit('game:init', game.state);
        } else {
            console.log(`[Engine] Game NOT found: ${data.gameId}`);
            socket.emit('game:error', { message: "Game not found" });
        }
    });

    socket.on('game:restart', (data) => {
        const game = gameManager.getGame(data.gameId);
        if (game) {
            game.resetGameState();
            console.log(`[Engine] Game restarted: ${data.gameId}`);
            // Send fresh state to all clients in this game room
            io.to(data.gameId).emit('game:init', game.state);
        }
    })

    // 2. Player makes a move
    socket.on('player:action', (payload) => {
        const { gameId, action, playerId } = payload;
        const game = gameManager.getGame(gameId);

        if (game) {
            try {
                game.handleMove(action, playerId);

                // If AI mode and player just finished, trigger AI here

            } catch (err) {
                socket.emit('game:error', { message: err.message });
            }
        } else {
            socket.emit('game:error', { message: "Game session not found" });
        }
    });
});
const PORT = process.env.PORT || 8002;

server.listen(PORT, () => {
    console.log(`Engine service (v2) listening on port ${PORT}`);
});