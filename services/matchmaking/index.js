/**
 * Matchmaking Service
 * Handles player queuing and pairing for online 1v1 games.
 * When two players are matched, calls the Engine HTTP API to create a game,
 * then notifies both players with their gameId and playerId.
 */

const http = require('http');
const { Server } = require('socket.io');
const { MongoClient, ObjectId } = require('mongodb');
const MatchmakingQueue = require('./queue');

const PORT = process.env.PORT || 8005;
const ENGINE_URL = process.env.ENGINE_URL || 'http://127.0.0.1:8002';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/khrypto';

const queue = new MatchmakingQueue();
const client = new MongoClient(MONGO_URL);

let usersCollection;

async function connectToMongo() {
    try {
        await client.connect();
        usersCollection = client.db().collection('users');
        console.log("Successfully connected to MongoDB server");
    } catch (e) {
        console.error("Matchmaking failed to connect to DB:", e);
    }
}
connectToMongo();

// --- Helper: Call Engine to create a game ---
function createGameOnEngine(mode = 'online', player1UserId, player2UserId, player1Elo, player2Elo) {
    return new Promise((resolve, reject) => {
        const engineUrl = new URL(ENGINE_URL);
        const body = JSON.stringify({ mode, player1UserId, player2UserId, player1Elo, player2Elo });

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

    const userId = socket.handshake.headers['x-user-id'];

    socket.on('matchmaking:join', async (data) => {
        const username = (data && data.username) || 'Player';
        console.log(`[Matchmaking] Player ${userId} (${username}) wants to play`);

        // Fetch User's Elo from Database directly
        let userElo = 600;
        try {
            if (userId && usersCollection && ObjectId.isValid(userId)) {
                const user = await usersCollection.findOne({ _id: ObjectId.createFromHexString(userId) });
                if (user && user.elo !== undefined) {
                    userElo = user.elo;
                }
            }
        } catch (error) {
            console.error('[Matchmaking] Failed to fetch Elo from DB, relying on default.', error);
        }

        addToQueue(socket, userId, username, userElo);
    });

    async function addToQueue(socket, userId, username, userElo) {
        // Add to queue
        queue.add(socket, userId, username, userElo);

        // We don't findMatch instantly here anymore. The sweeper will pick it up on its next tick, 
        // which could be a few milliseconds away. For immediate feedback, we just send standard wait:
        socket.emit('matchmaking:waiting', { eloRange: 50 });
        console.log(`[Matchmaking] Player ${userId} is now waiting. Queue size: ${queue.size}`);
    }

    socket.on('matchmaking:cancel', () => {
        console.log(`[Matchmaking] Player on socket : ${socket.id} cancelled matchmaking`);
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

// --- Sweeper Loop ---
// Runs every 5 seconds to match players with widening ranges and broadcast ranges
setInterval(async () => {
    if (queue.size === 0) return;

    // 1. Process all available matches for this tick
    let match = queue.findMatch();
    while (match) {
        const [player1, player2] = match;

        try {
            // Ask the Engine to create a game, passing userIds and Elos
            const { gameId } = await createGameOnEngine('online', player1.userId, player2.userId, player1.elo, player2.elo);
            console.log(`[Matchmaking] Game created: ${gameId}`);

            // Notify both players with opponent's username and Elos
            player1.socket.emit('matchmaking:found', {
                gameId,
                playerId: 0,
                myUsername: player1.username,
                opponentUsername: player2.username,
                myElo: player1.elo,
                opponentElo: player2.elo
            });
            player2.socket.emit('matchmaking:found', {
                gameId,
                playerId: 1,
                myUsername: player2.username,
                opponentUsername: player1.username,
                myElo: player2.elo,
                opponentElo: player1.elo
            });

            console.log(`[Matchmaking] Match sent! ${player1.username} (${player1.elo}) vs ${player2.username} (${player2.elo})`);
        } catch (err) {
            console.error('[Matchmaking] Failed to create game on engine:', err.message);

            // Put both players back in queue and notify of error
            queue.add(player1.socket, player1.userId, player1.username, player1.elo);
            queue.add(player2.socket, player2.userId, player2.username, player2.elo);
            player1.socket.emit('matchmaking:error', { message: 'Failed to create game. Retrying...' });
            player2.socket.emit('matchmaking:error', { message: 'Failed to create game. Retrying...' });
        }

        // Check if there are more matches this tick
        match = queue.findMatch();
    }

    // 2. Broadcast waiting ranges to players still left in the queue
    const waitingRanges = queue.getWaitingPlayersRanges();
    for (const playerRange of waitingRanges) {
        playerRange.socket.emit('matchmaking:waiting', { eloRange: playerRange.eloRange });
    }

}, 5000);
