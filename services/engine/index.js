const http = require('http');
const corsHelper = require('../helpers/cors.js');
const { initializeBoard } = require('./initBoard');
const { Server } = require("socket.io");
const { applyAction } = require('./gameLogic');

const gameState = {
    board: initializeBoard(),
    turn: 0,
    reserves: { 0: 7, 1: 7 }, 
    winner: null
};

 
const server = http.createServer((req, res) => {
    corsHelper.addCors(res);
});



const io = new Server(server,{
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    path: '/socket.io'
});


io.on('connection', (socket) => {
    console.log('Un joueur est connecté !');

    socket.emit('gameInit', gameState);

    socket.on('player:action', (payload) => {
        try {
            console.log(`Processing action from P${payload.playerId}:`, payload.action);
            
            // Run the Game Loop Logic
            applyAction(gameState, payload.action, payload.playerId);

            // Broadcast Updates
            io.emit('game:state', gameState);
            
            // Emit the laser animation path (optional but cool)
            //io.emit('game:laser', laserResult.path);

            // Handle Game Over
            if (gameState.winner !== null) {
                io.emit('game:over', { winner: gameState.winner });
            }

        } catch (e) {
            console.error("Action Error:", e.message);
            socket.emit('game:error', { message: e.message });
        }
    });

});


server.listen(8002, () => {
    console.log("Engine service (v2) listening on port 8002");
});