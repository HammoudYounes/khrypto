const http = require('http');
const corsHelper = require('../helpers/cors.js');
const { initializeBoard } = require('./initBoard');
const { Server } = require("socket.io");

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

});


server.listen(8002, () => {
    console.log("Engine service (v2) listening on port 8002");
});