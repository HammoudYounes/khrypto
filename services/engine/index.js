const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');
const corsHelper = require('./helpers/cors.js');
const { SocketLimiter } = require('./helpers/rateLimit.js');
const GameManager = require('./managers/GameManager');
const MatchRecorder = require('./managers/MatchRecorder');
const IntegrityAnalyzer = require('./managers/IntegrityAnalyzer');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/khrypto';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || null;
const client = new MongoClient(MONGO_URL);

const matchRecorder = new MatchRecorder();
const integrityAnalyzer = new IntegrityAnalyzer();

if (!INTERNAL_API_SECRET) {
    console.warn('[Engine] INTERNAL_API_SECRET is not set — /api/games is unauthenticated (dev mode only)');
}

let usersCollection = null;
let matchesCollection = null;

async function connectToMongo() {
    try {
        await client.connect();
        const db = client.db();
        usersCollection = db.collection('users');
        matchesCollection = db.collection('matches');
        gameManager.setUsersCollection(usersCollection);
        matchRecorder.setCollection(matchesCollection);
        integrityAnalyzer.setCollections(matchesCollection, usersCollection);
        integrityAnalyzer.start();
        console.log("Successfully connected to MongoDB server");
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

    // HTTP API: Create a game (called by matchmaking/social services only)
    if (req.method === 'POST' && req.url === '/api/games') {
        if (INTERNAL_API_SECRET && req.headers['x-internal-secret'] !== INTERNAL_API_SECRET) {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }
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

    // HTTP API: the calling user's recent finished matches (via gateway,
    // which injects the verified x-user-id)
    if (req.method === 'GET' && req.url.split('?')[0] === '/api/matches/history') {
        const userId = req.headers['x-user-id'];
        if (!userId || !matchesCollection) {
            res.writeHead(userId ? 503 : 401);
            return res.end(JSON.stringify({ error: userId ? 'Not ready' : 'Unauthorized' }));
        }
        try {
            const recent = await matchesCollection.find({
                status: 'finished',
                $or: [{ 'users.0': userId }, { 'users.1': userId }]
            }).sort({ endedAt: -1 }).limit(10).toArray();

            const { ObjectId } = require('mongodb');
            const oppIds = [...new Set(recent.map(m => m.users['0'] === userId ? m.users['1'] : m.users['0']))]
                .filter(id => id && ObjectId.isValid(id));
            const oppDocs = usersCollection ? await usersCollection.find(
                { _id: { $in: oppIds.map(id => ObjectId.createFromHexString(id)) } },
                { projection: { username: 1 } }
            ).toArray() : [];
            const nameById = Object.fromEntries(oppDocs.map(u => [u._id.toString(), u.username]));

            // Wager matches: join the escrow records for the SOL outcome
            const db = client.db();
            const wagerIds = recent.filter(m => m.mode === 'wager').map(m => m.gameId);
            const escrowByGame = {};
            if (wagerIds.length) {
                const escrowDocs = await db.collection('escrows').find({ gameId: { $in: wagerIds } }).toArray();
                for (const e of escrowDocs) escrowByGame[e.gameId] = e;
            }

            const history = recent.map(m => {
                const mySeat = m.users['0'] === userId ? '0' : '1';
                const oppSeat = mySeat === '0' ? '1' : '0';
                const iWon = m.result?.[mySeat] === true;
                const oppWon = m.result?.[oppSeat] === true;

                let wagerSol = null, wagerDeltaSol = null;
                const esc = escrowByGame[m.gameId];
                if (esc) {
                    wagerSol = esc.stakeLamports / 1e9;
                    if (esc.status === 'settled') {
                        wagerDeltaSol = esc.winnerWallet === esc.wallets[mySeat] ? wagerSol : -wagerSol;
                    } else if (['cancelled', 'aborted', 'refunded_draw'].includes(esc.status)) {
                        wagerDeltaSol = 0;
                    }
                }

                return {
                    gameId: m.gameId,
                    mode: m.mode,
                    opponent: nameById[m.users[oppSeat]] || 'Unknown',
                    result: iWon && oppWon ? 'draw' : iWon ? 'won' : 'lost',
                    reason: m.result?.reason || null,
                    eloDelta: (m.elosAfter && m.elosBefore) ? m.elosAfter[mySeat] - m.elosBefore[mySeat] : 0,
                    moves: Array.isArray(m.moves) ? m.moves.length : 0,
                    wagerSol,
                    wagerDeltaSol,
                    hasReplay: !!m.initialBoard,
                    endedAt: m.endedAt
                };
            });

            res.writeHead(200);
            return res.end(JSON.stringify({ history }));
        } catch (e) {
            console.error('[Engine HTTP] match history error:', e);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: 'Internal error' }));
        }
    }

    // HTTP API: full replay of a finished match — the moves are re-simulated
    // through the real rules engine so the client only renders frames
    if (req.method === 'GET' && req.url.split('?')[0].startsWith('/api/matches/replay/')) {
        const userId = req.headers['x-user-id'];
        if (!userId || !matchesCollection) {
            res.writeHead(userId ? 503 : 401);
            return res.end(JSON.stringify({ error: userId ? 'Not ready' : 'Unauthorized' }));
        }
        try {
            const gameId = decodeURIComponent(req.url.split('?')[0].slice('/api/matches/replay/'.length));
            const match = await matchesCollection.findOne({ gameId });
            if (!match || match.status !== 'finished') {
                res.writeHead(404);
                return res.end(JSON.stringify({ error: 'No finished match with this id' }));
            }
            if (!match.initialBoard) {
                res.writeHead(409);
                return res.end(JSON.stringify({ error: 'Replay unavailable for matches recorded before replays existed' }));
            }

            const { ObjectId } = require('mongodb');
            const names = { 0: 'Player 1', 1: 'Player 2' };
            if (usersCollection) {
                for (const seat of ['0', '1']) {
                    if (match.users[seat] && ObjectId.isValid(match.users[seat])) {
                        const u = await usersCollection.findOne({ _id: ObjectId.createFromHexString(match.users[seat]) }, { projection: { username: 1 } });
                        if (u) names[seat] = u.username;
                    }
                }
            }

            res.writeHead(200);
            return res.end(JSON.stringify({
                gameId,
                mode: match.mode,
                usernames: names,
                result: match.result,
                frames: buildReplayFrames(match.initialBoard, match.moves || [])
            }));
        } catch (e) {
            console.error('[Engine HTTP] replay error:', e);
            res.writeHead(500);
            return res.end(JSON.stringify({ error: 'Internal error' }));
        }
    }

    // Fallback for unknown HTTP routes
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});

// ── Replay simulation ─────────────────────────────────────────────────────────
// Re-runs a recorded match through the real rules to produce render-ready
// frames: board after each move, the laser path, and destroyed pieces.
const { applyAction, computeLaserPath, applyDestructions } = require('./rules/actions');
const { Sphinx } = require('./rules/pieces/Sphinx');
const { Pharaoh } = require('./rules/pieces/Pharaoh');
const { Anubis } = require('./rules/pieces/Anubis');
const { Pyramid } = require('./rules/pieces/Pyramid');
const { Scarab } = require('./rules/pieces/Scarab');

const PIECE_CLASSES = { Sphinx, Pharaoh, Anubis, Pyramid, Scarab };

function reviveBoard(plainBoard) {
    return plainBoard.map(row => row.map(p => {
        if (!p) return null;
        const Cls = PIECE_CLASSES[p.type];
        return Cls ? new Cls(p.player, p.orientation) : null;
    }));
}

function plainBoard(board) {
    return board.map(row => row.map(p => p ? { type: p.type, player: p.player, orientation: p.orientation } : null));
}

function buildReplayFrames(initialBoard, moves) {
    const state = {
        board: reviveBoard(initialBoard),
        turn: 0,
        turnCount: 0,
        reserves: { 0: 7, 1: 7 },
        pendingReserves: { 0: [], 1: [] },
        winner: { 0: false, 1: false },
        swapHistory: { 0: { Sphinx: -10, Pharaoh: -10 }, 1: { Sphinx: -10, Pharaoh: -10 } },
        canPassTurn: false
    };

    const frames = [{ board: plainBoard(state.board), reserves: { ...state.reserves }, laserPath: null, hits: null, action: null, playerId: null }];

    for (const mv of moves) {
        try {
            const laserShouldFire = applyAction(state, mv.action, mv.p);
            const laserResult = computeLaserPath(state, mv.p, laserShouldFire);
            if (laserResult) applyDestructions(state, laserResult.hitCoords);

            if (!state.winner[0] && !state.winner[1] && state.canPassTurn) {
                state.turn = (state.turn + 1) % 2;
                state.turnCount++;
                const pl = state.pendingReserves[state.turn];
                for (let i = pl.length - 1; i >= 0; i--) {
                    if (state.turnCount >= pl[i]) { state.reserves[state.turn]++; pl.splice(i, 1); }
                }
                state.canPassTurn = false;
            }

            frames.push({
                board: plainBoard(state.board),
                reserves: { 0: state.reserves[0], 1: state.reserves[1] },
                laserPath: laserResult ? laserResult.path : null,
                hits: laserResult ? laserResult.hitCoords : null,
                action: mv.action,
                playerId: mv.p
            });
        } catch (e) {
            // Recorded move no longer replays (shouldn't happen) — stop here
            console.warn('[Replay] simulation stopped:', e.message);
            break;
        }
    }
    return frames;
}

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    path: '/socket.io'
});

const gameManager = new GameManager(io);
gameManager.setMatchRecorder(matchRecorder);
const socketToGameId = new Map(); // socketId → gameId (reverse lookup for disconnect handling)

io.on('connection', (socket) => {
    // Identity injected by the gateway after token verification.
    // Real users get their userId; tokenless connections get a "guest_*" id.
    const socketUserId = socket.handshake.headers['x-user-id'] || null;
    const isGuest = !socketUserId || socketUserId.startsWith('guest_');
    const limiter = new SocketLimiter();

    // Returns true when the event should be dropped.
    function rateLimited(bucketName) {
        const verdict = limiter.check(bucketName);
        if (verdict === 'abusive') {
            console.warn(`[Engine] Disconnecting abusive socket ${socket.id} (user: ${socketUserId})`);
            socket.disconnect(true);
            return true;
        }
        if (verdict === 'limited') {
            socket.emit('game:error', { message: 'Too many requests, slow down' });
            return true;
        }
        return false;
    }

    // 1. Player wants to start a game (local/AI — from homepage)
    // Accepts either a mode string (legacy) or { mode, difficulty }
    socket.on('game:create', (payload) => {
        if (rateLimited('misc')) return;

        const mode = typeof payload === 'string' ? payload : payload && payload.mode;
        const difficulty = (payload && payload.difficulty) || 'hard';

        // Online games are created exclusively by matchmaking/social via HTTP
        if (!['local', 'ai'].includes(mode)) {
            socket.emit('game:error', { message: 'Invalid game mode' });
            return;
        }
        if (!['easy', 'medium', 'hard'].includes(difficulty)) {
            socket.emit('game:error', { message: 'Invalid difficulty' });
            return;
        }

        const game = gameManager.createGame(mode);
        if (mode === 'ai') game.aiDifficulty = difficulty;
        console.log(`[Engine] Game created: ${game.id}, Mode: ${mode}${mode === 'ai' ? ` (${difficulty})` : ''}`);
        socket.emit('game:created', { gameId: game.id });
    });

    // 2. Player joins a game room
    socket.on('game:join', (data) => {
        if (rateLimited('misc')) return;
        if (!data || typeof data.gameId !== 'string') return;

        const game = gameManager.getGame(data.gameId);
        if (!game) {
            console.log(`[Engine] Game NOT found: ${data.gameId}`);
            socket.emit('game:error', { message: "Game not found" });
            return;
        }

        if (game.isOnline()) {
            // Seat is derived from the verified identity — never from the client payload
            let seat = null;
            if (!isGuest && socketUserId === game.userIds[0]) seat = 0;
            else if (!isGuest && socketUserId === game.userIds[1]) seat = 1;

            if (seat === null) {
                console.log(`[Engine] Rejected join: ${socketUserId} is not a player in game ${data.gameId}`);
                socket.emit('game:error', { message: "You are not a player in this game" });
                return;
            }

            // Drop any stale socket previously holding this seat
            for (const [sid, pid] of game.players) {
                if (pid === seat && sid !== socket.id) {
                    game.players.delete(sid);
                    socketToGameId.delete(sid);
                }
            }

            socket.join(data.gameId);
            game.players.set(socket.id, seat);
            socketToGameId.set(socket.id, data.gameId);
            console.log(`[Engine] ${socketUserId} joined game ${data.gameId} as Player ${seat}`);

            // If this is a rejoin during grace period, stop the timer and notify room
            if (game.handleReconnect(seat)) {
                io.to(data.gameId).emit('game:player_reconnected', { playerId: seat });
            }

            game.registerSeatJoined(seat);
            socket.emit('game:init', game.state);
        } else {
            // Local/AI game: single client, no seat registration
            socket.join(data.gameId);
            socketToGameId.set(socket.id, data.gameId);
            socket.emit('game:init', game.state);
        }
    });

    socket.on('game:restart', (data) => {
        if (rateLimited('misc')) return;
        if (!data || typeof data.gameId !== 'string') return;

        const game = gameManager.getGame(data.gameId);
        if (!game) return;

        // For online: voting system (need both seated players to agree)
        if (game.isOnline()) {
            const playerId = game.players.get(socket.id);
            if (playerId === undefined) return; // spectator sockets can't vote
            const allVoted = game.voteRestart(playerId);

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
    });

    // Shared departure path for intentional leave and network drops
    function handleSocketDeparture(gameId) {
        if (!gameId) return;
        const game = gameManager.getGame(gameId);
        if (!game || !game.isOnline()) return;

        const playerId = game.players.get(socket.id);
        game.players.delete(socket.id);
        socketToGameId.delete(socket.id);

        if (playerId === undefined) return;
        if (game.ended) return;

        console.log(`[Engine] Player ${playerId} left/disconnected from game ${gameId}`);
        game.handleDeparture(playerId);
    }

    // 3.5 Player leaves the game intentionally — draws from the same grace budget
    socket.on('game:leave', (data) => {
        if (rateLimited('misc')) return;
        if (!data || typeof data.gameId !== 'string') return;
        handleSocketDeparture(data.gameId);
    });

    // 3.6 Socket disconnected (network drop / tab close)
    socket.on('disconnect', () => {
        handleSocketDeparture(socketToGameId.get(socket.id));
    });

    // Emote relay: broadcast to everyone in the game room
    socket.on('engine:emoji-send', (data) => {
        if (rateLimited('emoji')) return;
        const { gameId, assetPath, rarity, senderUsername } = data || {};
        if (!gameId || !assetPath) return;
        const game = gameManager.getGame(gameId);
        if (!game) return;
        io.to(gameId).emit('engine:emoji-receive', { assetPath, rarity: rarity || 'common', senderUsername: senderUsername || 'Player' });
    });

    // 3. Player makes a move
    socket.on('player:action', (payload) => {
        if (rateLimited('action')) return;
        const { gameId, action } = payload || {};
        if (!gameId || !action) return;

        const game = gameManager.getGame(gameId);
        if (!game) {
            socket.emit('game:error', { message: "Game session not found" });
            return;
        }

        // Acting player is derived server-side; the payload's playerId is ignored
        // for online games and constrained for AI games (human is always seat 0).
        let playerId;
        if (game.isOnline()) {
            playerId = game.players.get(socket.id);
            if (playerId === undefined) {
                socket.emit('game:error', { message: "You are not seated in this game" });
                return;
            }
        } else if (game.mode === 'ai') {
            playerId = 0;
        } else {
            playerId = payload.playerId; // local hotseat: one client controls both seats
        }

        try {
            game.handleMove(action, playerId);
        } catch (err) {
            socket.emit('game:error', { message: err.message });
        }
    });
});

const PORT = process.env.PORT || 8002;

server.listen(PORT, () => {
    console.log(`Engine service (v2) listening on port ${PORT}`);
});
