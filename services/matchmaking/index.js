/**
 * Matchmaking Service
 * Handles player queuing and pairing for online 1v1 games.
 * When two players are matched, calls the Engine HTTP API to create a game,
 * then notifies both players with their gameId and playerId.
 */

const http = require('http');
const { Server } = require('socket.io');
const MatchmakingQueue = require('./queue');

const PORT = process.env.PORT || 8005;
const ENGINE_URL = process.env.ENGINE_URL || 'http://127.0.0.1:8002';

const queue = new MatchmakingQueue();

// --- Helper: Call Engine to create a game ---
function createGameOnEngine(mode = 'online') {
    return new Promise((resolve, reject) => {
        const engineUrl = new URL(ENGINE_URL);
        const body = JSON.stringify({ mode });

        const options = {
            hostname: engineUrl.hostname,
            port: engineUrl.port,
            path: '/api/games',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.gameId) {
                        resolve(parsed);
                    } else {
                        reject(new Error('Engine did not return a gameId'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(body);
        req.end();
    });
}

// --- HTTP Server (for health checks / future REST endpoints) ---
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/health') {
        res.writeHead(200);
        return res.end(JSON.stringify({ status: 'ok', queueSize: queue.size }));
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});

// --- Socket.IO Server ---
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    path: '/matchmaking/socket.io'
});

io.on('connection', (socket) => {
    console.log(`[Matchmaking] Socket connected: ${socket.id}`);

    socket.on('matchmaking:join', async (data) => {
        const username = (data && data.username) || 'Player';
        console.log(`[Matchmaking] Player ${socket.id} (${username}) wants to play`);

        // Add to queue
        queue.add(socket, socket.id, username); // userId can be extracted from token later

        // Try to find a match
        const match = queue.findMatch();

        if (match) {
            const [player1, player2] = match;

            try {
                // Ask the Engine to create a game
                const { gameId } = await createGameOnEngine('online');
                console.log(`[Matchmaking] Game created: ${gameId}`);

                // Notify both players with opponent's username
                player1.socket.emit('matchmaking:found', {
                    gameId,
                    playerId: 0,
                    myUsername: player1.username,
                    opponentUsername: player2.username
                });
                player2.socket.emit('matchmaking:found', {
                    gameId,
                    playerId: 1,
                    myUsername: player2.username,
                    opponentUsername: player1.username
                });

                console.log(`[Matchmaking] Match sent! ${player1.username} (P0) vs ${player2.username} (P1)`);
            } catch (err) {
                console.error('[Matchmaking] Failed to create game on engine:', err.message);

                // Put both players back in queue and notify of error
                queue.add(player1.socket, player1.userId, player1.username);
                queue.add(player2.socket, player2.userId, player2.username);
                player1.socket.emit('matchmaking:error', { message: 'Failed to create game. Retrying...' });
                player2.socket.emit('matchmaking:error', { message: 'Failed to create game. Retrying...' });
            }
        } else {
            // No match yet — player is now waiting
            socket.emit('matchmaking:waiting');
            console.log(`[Matchmaking] Player ${socket.id} is now waiting. Queue size: ${queue.size}`);
        }
    });

    socket.on('matchmaking:cancel', () => {
        console.log(`[Matchmaking] Player ${socket.id} cancelled matchmaking`);
        queue.remove(socket.id);
        socket.emit('matchmaking:cancelled');
    });

    socket.on('disconnect', () => {
        console.log(`[Matchmaking] Socket disconnected: ${socket.id}`);
        queue.remove(socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Matchmaking service listening on port ${PORT}`);
});
