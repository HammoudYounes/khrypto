const http = require('http');
const corsHelper = require('../helpers/cors.js');
const { initializeBoard } = require('./initBoard');


const gameState = {
    board: initializeBoard(),
    turn: 0,
    reserves: { 0: 7, 1: 7 }, 
    winner: null
};

const server = http.createServer((req, res) => {
    corsHelper.addCors(res);

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/api/state' && req.method === 'GET') {
        res.statusCode = 200;
        res.end(JSON.stringify(gameState));
    } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Route not found" }));
    }
});

server.listen(8002, () => {
    console.log("Engine service (v2) listening on port 8002");
});