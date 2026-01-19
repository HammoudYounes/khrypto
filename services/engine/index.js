const http = require('http');
const corsHelper = require('../helpers/cors.js');
const { initializeBoard } = require('./initBoard');
const { Server } = require("socket.io");

const { applyAction } = require('./gameLogic');
const { computeLaserPath } = require('./gameLogic');
const { applyDestructions } = require('./gameLogic');

const gameState = {
    board: initializeBoard(),
    turn: 0,
    reserves: { 0: 7, 1: 7 },
    winner: {0: false, 1: false},
    turnCount: 0,
    swapHistory: {
        0: { Sphinx: -10, Pharaoh: -10 },
        1: { Sphinx: -10, Pharaoh: -10 }
    },
    pendingReserves: { 0: [], 1: [] },
    canPassTurn:false,
};

function resetGameState(){
    gameState.board = initializeBoard(),
    gameState.turn = 0,
    gameState.reserves =  { 0: 7, 1: 7 };
    gameState.winner = {0: false, 1: false};
    gameState.turnCount = 0;
    gameState.swapHistory =  {
        0: { Sphinx: -10, Pharaoh: -10 },
        1: { Sphinx: -10, Pharaoh: -10 }
    };
    gameState.pendingReserves = { 0: [], 1: [] };
    gameState.canPassTurn = false; 
}


 
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

    socket.emit('game:init', gameState);

    socket.on('game:restart', () =>{
        resetGameState();
        socket.emit('game:init', gameState)
    })

    socket.on('player:action', (payload) => {
        try {
            console.log(`Processing action from P${payload.playerId}:`, payload.action);
            
            const laserShouldFire = applyAction(gameState, payload.action, payload.playerId);

            const boardAfterMove = JSON.parse(JSON.stringify(gameState.board));


            const laserResult = computeLaserPath(gameState,payload.playerId,laserShouldFire); // Retourne { path: [...], hitCoords: [...] }  

            if (laserResult)
                applyDestructions(gameState, laserResult.hitCoords);


            if (gameState.winner[0] === false && gameState.winner[1] === false && gameState.canPassTurn) {
                gameState.turn = (gameState.turn + 1) % 2;
                gameState.turnCount = (gameState.turnCount || 0) + 1;

                console.log(`Turn ended. Now Player ${gameState.turn}'s turn. (Total: ${gameState.turnCount})`);

                // 2. CHECK PENDING RESERVES
                const currentPlayer = gameState.turn;
                const pendingList = gameState.pendingReserves[currentPlayer];

                for (let i = pendingList.length - 1; i >= 0; i--) {
                    const unlockTime = pendingList[i];

                    if (gameState.turnCount >= unlockTime) {
                        gameState.reserves[currentPlayer] += 1; 
                        pendingList.splice(i, 1); 
                        console.log(`P${currentPlayer} received a Pyramid from reserve queue!`);
                    }
                }
                gameState.canPassTurn = false;
            }

            io.emit('game:action_response', {
                boardAfterMove: boardAfterMove, 
                laserResult: laserResult,
                finalState: gameState 
            });

            if (gameState.winner[0] === true || gameState.winner[1] === true) {
                io.emit('game:over', gameState.winner);
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