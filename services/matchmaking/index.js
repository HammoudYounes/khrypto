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
const TokenBucket = require('./rateLimit');

const PORT = process.env.PORT || 8005;
const ENGINE_URL = process.env.ENGINE_URL || 'http://127.0.0.1:8002';
const ESCROW_URL = process.env.ESCROW_URL || 'http://127.0.0.1:8008';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/khrypto';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || null;

// Fixed wager tiers (SOL). Wager games only exist in these amounts.
const WAGER_TIERS = [0.01, 0.1, 0.5, 1, 5];

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
                'Content-Length': Buffer.byteLength(body),
                ...(INTERNAL_API_SECRET ? { 'x-internal-secret': INTERNAL_API_SECRET } : {})
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

// --- Escrow service internal API helpers ---
function escrowHeaders() {
    return {
        'Content-Type': 'application/json',
        ...(INTERNAL_API_SECRET ? { 'x-internal-secret': INTERNAL_API_SECRET } : {})
    };
}

async function escrowInit(gameId, stakeLamports, attempts = 2) {
    for (let i = 1; i <= attempts; i++) {
        try {
            const res = await fetch(`${ESCROW_URL}/internal/init`, {
                method: 'POST', headers: escrowHeaders(),
                body: JSON.stringify({ gameId, stakeLamports })
            });
            if (res.ok) return true;
            const body = await res.json().catch(() => ({}));
            console.error(`[Matchmaking] Escrow init attempt ${i} failed for ${gameId}: ${body.error || res.status}`);
        } catch (e) {
            console.error(`[Matchmaking] Escrow init attempt ${i} error for ${gameId}:`, e.message);
        }
        await new Promise(r => setTimeout(r, 4000));
    }
    return false;
}

async function escrowStatus(gameId) {
    const res = await fetch(`${ESCROW_URL}/internal/status/${encodeURIComponent(gameId)}`, { headers: escrowHeaders() });
    return res.ok ? res.json() : null;
}

async function escrowCancel(gameId) {
    try {
        const res = await fetch(`${ESCROW_URL}/internal/cancel`, {
            method: 'POST', headers: escrowHeaders(), body: JSON.stringify({ gameId })
        });
        if (!res.ok) console.error(`[Matchmaking] Escrow cancel failed for ${gameId}: ${res.status}`);
    } catch (e) {
        console.error(`[Matchmaking] Escrow cancel error for ${gameId}:`, e.message);
    }
}

// --- Found notification shared by normal and wager matches ---
function emitFound(player1, player2, gameId, mode, tier) {
    const common = { gameId, mode, stakeSol: tier || null };
    player1.socket.emit('matchmaking:found', {
        ...common, playerId: 0,
        myUsername: player1.username, opponentUsername: player2.username,
        myElo: player1.elo, opponentElo: player2.elo
    });
    player2.socket.emit('matchmaking:found', {
        ...common, playerId: 1,
        myUsername: player2.username, opponentUsername: player1.username,
        myElo: player2.elo, opponentElo: player1.elo
    });
    console.log(`[Matchmaking] Match sent! ${player1.username} (${player1.elo}) vs ${player2.username} (${player2.elo})${tier ? ` — wager ${tier} SOL` : ''}`);
}

// --- Wager staking gate ---
// The game exists on the engine but players are NOT told about it until
// both stakes are locked on-chain. Nobody deposits → escrow cancelled,
// any deposit refunded, game never starts (engine sweeps it later).
const PENDING_DEPOSIT_MS = 120_000;

async function runWagerStakingGate(player1, player2, tier, gameId) {
    const stakeLamports = Math.round(tier * 1e9);

    const ok = await escrowInit(gameId, stakeLamports);
    if (!ok) {
        // Re-queue both — the wager could not be set up
        queue.add(player1.socket, player1.userId, player1.username, player1.elo, player1.tier);
        queue.add(player2.socket, player2.userId, player2.username, player2.elo, player2.tier);
        [player1, player2].forEach(p => p.socket.emit('matchmaking:error', { message: 'Failed to set up the wager escrow. Retrying...' }));
        return;
    }

    const deadlineAt = Date.now() + PENDING_DEPOSIT_MS;
    player1.socket.emit('matchmaking:deposit_required', { gameId, stakeSol: tier, deadlineAt, opponentUsername: player2.username });
    player2.socket.emit('matchmaking:deposit_required', { gameId, stakeSol: tier, deadlineAt, opponentUsername: player1.username });
    console.log(`[Matchmaking] Staking gate opened for ${gameId} (${tier} SOL, 2 min)`);

    let done = false;
    const cleanup = () => {
        done = true;
        clearTimeout(deadlineTimer);
        clearInterval(pollTimer);
        player1.socket.off('disconnect', onGone1);
        player2.socket.off('disconnect', onGone2);
        player1.socket.off('matchmaking:cancel', onGone1);
        player2.socket.off('matchmaking:cancel', onGone2);
    };

    const abort = async (reason) => {
        if (done) return;
        cleanup();
        console.log(`[Matchmaking] Wager aborted for ${gameId}: ${reason}`);
        await escrowCancel(gameId); // refunds whoever already deposited
        [player1, player2].forEach(p => {
            if (p.socket.connected) p.socket.emit('matchmaking:wager_aborted', { message: reason });
        });
    };

    const onGone1 = () => abort(`${player1.username} left before staking — deposits refunded`);
    const onGone2 = () => abort(`${player2.username} left before staking — deposits refunded`);
    player1.socket.once('disconnect', onGone1);
    player2.socket.once('disconnect', onGone2);
    player1.socket.once('matchmaking:cancel', onGone1);
    player2.socket.once('matchmaking:cancel', onGone2);

    const deadlineTimer = setTimeout(() => abort('Deposit deadline passed — stakes refunded'), PENDING_DEPOSIT_MS);

    const pollTimer = setInterval(async () => {
        if (done) return;
        try {
            const st = await escrowStatus(gameId);
            if (!st || st.pending) return;
            if (st.cancelled) return abort('Escrow was cancelled');

            // Keep both players' UI in sync with deposit progress
            player1.socket.emit('matchmaking:deposit_status', { you: st.depositedA, opponent: st.depositedB });
            player2.socket.emit('matchmaking:deposit_status', { you: st.depositedB, opponent: st.depositedA });

            if (st.depositedA && st.depositedB) {
                cleanup();
                console.log(`[Matchmaking] Both stakes locked for ${gameId} — starting game`);
                emitFound(player1, player2, gameId, 'wager', tier);
            }
        } catch (e) {
            console.error(`[Matchmaking] Staking gate poll error for ${gameId}:`, e.message);
        }
    }, 4000);
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
    const bucket = new TokenBucket(5, 0.2); // join/cancel spam guard

    socket.on('matchmaking:join', async (data) => {
        if (!bucket.tryRemove()) return;
        const username = (data && data.username) || 'Player';
        const isWager = data && data.mode === 'wager';
        const tier = isWager ? Number(data.stakeSol) : null;
        console.log(`[Matchmaking] Player ${userId} (${username}) wants to play${isWager ? ` (wager ${tier} SOL)` : ''}`);

        if (isWager && !WAGER_TIERS.includes(tier)) {
            return socket.emit('matchmaking:error', { message: 'Invalid wager tier' });
        }

        // Fetch User's Elo (and wallet, for wager mode) from Database directly
        let userElo = 600;
        let user = null;
        try {
            if (userId && usersCollection && ObjectId.isValid(userId)) {
                user = await usersCollection.findOne({ _id: ObjectId.createFromHexString(userId) });
                if (user && user.elo !== undefined) {
                    userElo = user.elo;
                }
            }
        } catch (error) {
            console.error('[Matchmaking] Failed to fetch Elo from DB, relying on default.', error);
        }

        if (isWager && (!user || !user.walletAddress)) {
            return socket.emit('matchmaking:error', { message: 'Link a Solana wallet on your profile before wagering' });
        }
        if (isWager && user.wagerBanned) {
            return socket.emit('matchmaking:error', { message: 'Wager access suspended pending an integrity review' });
        }

        addToQueue(socket, userId, username, userElo, tier);
    });

    async function addToQueue(socket, userId, username, userElo, tier = null) {
        // Add to queue
        queue.add(socket, userId, username, userElo, tier);

        // We don't findMatch instantly here anymore. The sweeper will pick it up on its next tick, 
        // which could be a few milliseconds away. For immediate feedback, we just send standard wait:
        socket.emit('matchmaking:waiting', { eloRange: 50 });
        console.log(`[Matchmaking] Player ${userId} is now waiting. Queue size: ${queue.size}`);
    }

    socket.on('matchmaking:cancel', () => {
        if (!bucket.tryRemove()) return;
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
        const tier = player1.tier; // both sides guaranteed same tier by findMatch
        const mode = tier ? 'wager' : 'online';

        try {
            // Ask the Engine to create a game, passing userIds and Elos
            const { gameId } = await createGameOnEngine(mode, player1.userId, player2.userId, player1.elo, player2.elo);
            console.log(`[Matchmaking] Game created: ${gameId} (${mode}${tier ? ` ${tier} SOL` : ''})`);

            if (tier) {
                // Wager games are gated: both players must deposit their
                // stake before matchmaking:found is sent and play begins
                runWagerStakingGate(player1, player2, tier, gameId);
            } else {
                emitFound(player1, player2, gameId, mode, tier);
            }
        } catch (err) {
            console.error('[Matchmaking] Failed to create game on engine:', err.message);

            // Put both players back in queue and notify of error
            queue.add(player1.socket, player1.userId, player1.username, player1.elo, player1.tier);
            queue.add(player2.socket, player2.userId, player2.username, player2.elo, player2.tier);
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
