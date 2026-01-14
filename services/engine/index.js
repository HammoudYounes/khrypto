const http = require('http');

const gameState = {
    board: Array(10).fill(null).map(() => Array(10).fill(null)),
    turn: 0,
    reserves: { 0: 7, 1: 7 }
};

const server = http.createServer((req, res) => {


    if (req.url === '/api/state' && req.method === 'GET') {
        res.statusCode = 200;
        res.end(JSON.stringify(gameState));
    } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Route not found" }));
    }
});

server.listen(8002, () => {
    console.log("Engine Service running on port 8002 with CORS enabled");
});