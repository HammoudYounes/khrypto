const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');
const corsHelper = require('./helpers/cors.js');
const GameManager = require('./managers/GameManager');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/khrypto';
const client = new MongoClient(MONGO_URL);

let usersCollection = null;

async function connectToMongo() {
    try {
        await client.connect();
        usersCollection = client.db().collection('users');
        console.log("Successfully connected to MongoDB server");
        gameManager.setUsersCollection(usersCollection);
    } catch (e) {
        console.error("Engine failed to connect to DB:", e);
    }
}
connectToMongo();

// Helper: parse JSON body from an HTTP request
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch (e) { reject(e); }
        });
    });
}

const server = http.createServer(async (req, res) => {
    corsHelper.addCors(res);
    res.setHeader('Content-Type', 'application/json');

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // HTTP API: Create a game (called by matchmaking service)
    if (req.method === 'POST' && req.url === '/api/games') {
        try {
            const { mode, player1UserId, player2UserId, player1Elo, player2Elo } = await parseBody(req);
            const game = gameManager.createGame(mode || 'online', player1UserId, player2UserId, player1Elo, player2Elo);
            console.log(`[Engine HTTP] Game created: ${game.id}, Mode: ${mode || 'online'}`);
            res.writeHead(200);
            res.end(JSON.stringify({ gameId: game.id }));
        } catch (err) {
            console.error('[Engine HTTP] Error creating game:', err);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Failed to create game' }));
        }
        return;
    }

    // Fallback for unknown HTTP routes
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    path: '/socket.io'
});

const gameManager = new GameManager(io);
const socketToGameId = new Map(); // socketId → gameId (reverse lookup for disconnect handling)

io.on('connection', (socket) => {

    // 1. Player wants to start a game (local/AI — from homepage)
    socket.on('game:create', (mode) => {
        const game = gameManager.createGame(mode);
        console.log(`[Engine] Game created: ${game.id}, Mode: ${mode}`);
        socket.emit('game:created', { gameId: game.id });
    });

    // 2. Player joins a game room
    socket.on('game:join', (data) => {
        console.log(`[Engine] Attempting to join game: ${data.gameId}`);
        console.log(`[Engine] Available games:`, Array.from(gameManager.games.keys()));

        const game = gameManager.getGame(data.gameId);
        if (game) {
            console.log(`[Engine] Game found! Joining: ${data.gameId}`);
            socket.join(data.gameId);

            // For online games: register which player this socket controls
            if (game.mode === 'online' && data.playerId !== undefined) {
                game.players.set(socket.id, data.playerId);
                socketToGameId.set(socket.id, data.gameId);
                console.log(`[Engine] Registered socket ${socket.id} as Player ${data.playerId}`);

                // If this is a rejoin during grace period, clear timer and notify room
                if (game.disconnectedPlayers.has(data.playerId)) {
                    game.clearReconnectTimer(data.playerId);
                    io.to(data.gameId).emit('game:player_reconnected', { playerId: data.playerId });
                    console.log(`[Engine] Player ${data.playerId} rejoined game ${data.gameId}`);
                }
            }

            socket.emit('game:init', game.state);
        } else {
            console.log(`[Engine] Game NOT found: ${data.gameId}`);
            socket.emit('game:error', { message: "Game not found" });
        }
    });

    socket.on('game:restart', (data) => {
        const game = gameManager.getGame(data.gameId);
        if (game) {
            // For online: voting system (need both players to agree)
            if (game.mode === 'online') {
                const playerId = game.players.get(socket.id);
                const allVoted = game.voteRestart(playerId);

                // Notify room about the vote
                io.to(data.gameId).emit('game:restart_vote', {
                    playerId: playerId,
                    votes: game.restartVotes.size,
                    needed: 2
                });

                if (allVoted) {
                    game.resetGameState();
                    console.log(`[Engine] Online game restarted (both voted): ${data.gameId}`);
                    io.to(data.gameId).emit('game:init', game.state);
                }
            } else {
                // Local/AI: instant restart
                game.resetGameState();
                console.log(`[Engine] Game restarted: ${data.gameId}`);
                io.to(data.gameId).emit('game:init', game.state);
            }
        }
    });

    // 3.5 Player leaves the game intentionally — start grace period (same as disconnect)
    socket.on('game:leave', (data) => {
        const game = gameManager.getGame(data.gameId);
        if (!game || game.mode !== 'online') return;

        const playerId = game.players.get(socket.id);
        if (playerId === undefined) return;
        if (game.state.winner[0] || game.state.winner[1]) return;

        game.players.delete(socket.id);
        socketToGameId.delete(socket.id);

        console.log(`[Engine] Player ${playerId} left game ${data.gameId} — starting 60s grace period`);
        io.to(data.gameId).emit('game:player_disconnected', { playerId, timeoutSeconds: 60 });

        game.startReconnectTimer(playerId, () => {
            const opponentId = playerId === 0 ? 1 : 0;
            game.state.winner[opponentId] = true;
            io.to(data.gameId).emit('game:over', { ...game.state.winner, forfeit: true });
            game.handleGameOver();
            console.log(`[Engine] Grace period expired for Player ${playerId} — Player ${opponentId} wins`);
        });
    });

    // 3.6 Socket disconnected (network drop / tab close)
    socket.on('disconnect', () => {
        const gameId = socketToGameId.get(socket.id);
        socketToGameId.delete(socket.id);

        if (!gameId) return;
        const game = gameManager.getGame(gameId);
        if (!game || game.mode !== 'online') return;

        const playerId = game.players.get(socket.id);
        if (playerId === undefined) return;
        if (game.state.winner[0] || game.state.winner[1]) return;

        game.players.delete(socket.id);

        console.log(`[Engine] Socket ${socket.id} (Player ${playerId}) disconnected from game ${gameId} — starting 60s grace period`);
        io.to(gameId).emit('game:player_disconnected', { playerId, timeoutSeconds: 60 });

        game.startReconnectTimer(playerId, () => {
            const opponentId = playerId === 0 ? 1 : 0;
            game.state.winner[opponentId] = true;
            io.to(gameId).emit('game:over', game.state.winner);
            game.handleGameOver();
            console.log(`[Engine] Grace period expired for Player ${playerId} — Player ${opponentId} wins`);
        });
    });

    // Emote relay: broadcast to everyone in the game room
    socket.on('engine:emoji-send', (data) => {
        const { gameId, assetPath, rarity, senderUsername } = data;
        if (!gameId || !assetPath) return;
        const game = gameManager.getGame(gameId);
        if (!game) return;
        io.to(gameId).emit('engine:emoji-receive', { assetPath, rarity: rarity || 'common', senderUsername: senderUsername || 'Player' });
    });

    // 3. Player makes a move
    socket.on('player:action', (payload) => {
        const { gameId, action, playerId } = payload;
        const game = gameManager.getGame(gameId);

        if (game) {
            try {
                game.handleMove(action, playerId);
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