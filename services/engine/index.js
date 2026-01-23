const http = require('http');
const { Server } = require('socket.io');
const corsHelper = require('../helpers/cors.js');
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
    socket.on('game:create', (data) => {
        // mode could be 'local' or 'ai'
        const mode = data.mode || 'local';
        
        const game = gameManager.createGame(mode);
        
        // Send Game ID back to client
        socket.emit('game:created', { gameId: game.id });
    });

    socket.on('game:join', (data) => {
        const game = gameManager.getGame(data.gameId);
        if (game) {
            socket.join(data.gameId);
            socket.emit('game:state', game.state); 
        } else {
            socket.emit('game:error', { message: "Game not found" });
        }
    });

    socket.on('game:restart', (gameId) => {
        const game = gameManager.getGame(gameId);
        game.resetGameState();
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


server.listen(8002, () => {
    console.log("Engine service (v2) listening on port 8002");
});