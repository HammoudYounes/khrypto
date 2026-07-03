/**
 * Escrow Service (DEVNET ONLY)
 *
 * Bridges finished Khrypto matches to the on-chain escrow program:
 *  - API (behind the gateway's token check) to create a wager escrow for a
 *    game and to build deposit transactions for Phantom to sign.
 *  - Settlement worker: watches the `matches` collection (written by the
 *    engine) and settles/cancels escrows based on the recorded result.
 *
 * The engine knows nothing about this service — the tamper-evident match
 * record is the only interface, so game logic stays isolated from money.
 *
 * Degrades gracefully: without SOLANA/ORACLE config the service runs with
 * escrow disabled and reports that on /api/escrow/status.
 */
const http = require('http');
const fs = require('fs');
const { MongoClient, ObjectId } = require('mongodb');
const { Keypair } = require('@solana/web3.js');
const { EscrowClient } = require('./solana');

const PORT = process.env.PORT || 8008;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/khrypto';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const ESCROW_PROGRAM_ID = process.env.ESCROW_PROGRAM_ID || null;
const ORACLE_KEYPAIR_PATH = process.env.ORACLE_KEYPAIR_PATH || null;

const DEPOSIT_DEADLINE_S = 15 * 60;   // players must deposit within 15 min
const SETTLE_POLL_MS = 15_000;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || null;

// Hard devnet guard — this service must never touch mainnet in this phase
if (/mainnet/i.test(SOLANA_RPC_URL)) {
    console.error('[Escrow] FATAL: mainnet RPC configured. This service is devnet-only. Refusing to start.');
    process.exit(1);
}

let escrowClient = null;
if (ESCROW_PROGRAM_ID && ORACLE_KEYPAIR_PATH) {
    try {
        const secret = JSON.parse(fs.readFileSync(ORACLE_KEYPAIR_PATH, 'utf8'));
        const oracleKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
        escrowClient = new EscrowClient({ rpcUrl: SOLANA_RPC_URL, programId: ESCROW_PROGRAM_ID, oracleKeypair });
        console.log(`[Escrow] Enabled. Program: ${ESCROW_PROGRAM_ID}, Oracle: ${oracleKeypair.publicKey.toBase58()}, RPC: ${SOLANA_RPC_URL}`);
    } catch (e) {
        console.error('[Escrow] Failed to load oracle keypair — escrow disabled:', e.message);
    }
} else {
    console.warn('[Escrow] ESCROW_PROGRAM_ID / ORACLE_KEYPAIR_PATH not set — escrow disabled');
}

const client = new MongoClient(MONGO_URL);
let users = null, matches = null, escrows = null;

async function connectToMongo() {
    try {
        await client.connect();
        const db = client.db();
        users = db.collection('users');
        matches = db.collection('matches');
        escrows = db.collection('escrows');
        await escrows.createIndex({ gameId: 1 }, { unique: true });
        console.log('[Escrow] Connected to MongoDB');
    } catch (e) {
        console.error('[Escrow] Mongo connection failed:', e.message);
    }
}
connectToMongo();

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
        req.on('error', reject);
    });
}

function send(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

/**
 * Initialize the on-chain escrow for a match. Shared by the internal
 * (matchmaking-driven, wager mode) and player-facing paths.
 * Returns { code, body } ready to send.
 */
async function initEscrowForGame(gameId, stakeLamports, requestingUserId = null) {
    const match = await matches.findOne({ gameId });
    if (!match) return { code: 404, body: { error: 'Unknown game' } };
    if (match.status !== 'active') return { code: 409, body: { error: 'Match already finished' } };

    const playerIds = [match.users['0'], match.users['1']];
    if (requestingUserId && !playerIds.includes(requestingUserId)) {
        return { code: 403, body: { error: 'You are not a player in this game' } };
    }

    const [u0, u1] = await Promise.all(playerIds.map(id => users.findOne({ _id: ObjectId.createFromHexString(id) })));
    if (!u0?.walletAddress || !u1?.walletAddress) {
        return { code: 409, body: { error: 'Both players must have a linked wallet' } };
    }
    if (playerIds[0] === playerIds[1] || u0.walletAddress === u1.walletAddress) {
        return { code: 409, body: { error: 'Players must be two distinct accounts with different wallets' } };
    }

    const existing = await escrows.findOne({ gameId });
    if (existing) return { code: 409, body: { error: 'Escrow already exists for this game', pda: existing.pda } };

    const deadline = Math.floor(Date.now() / 1000) + DEPOSIT_DEADLINE_S;
    const { pda, signature } = await escrowClient.initializeMatch(
        gameId, u0.walletAddress, u1.walletAddress, stakeLamports, deadline
    );

    await escrows.insertOne({
        gameId, pda, stakeLamports, deadline,
        mode: match.mode,
        wallets: { 0: u0.walletAddress, 1: u1.walletAddress },
        users: { 0: playerIds[0], 1: playerIds[1] },
        status: 'open', createdAt: new Date(), initSignature: signature
    });

    console.log(`[Escrow] Initialized escrow ${pda} for game ${gameId} (${stakeLamports} lamports)`);
    return { code: 200, body: { pda, stakeLamports, deadline } };
}

const server = http.createServer(async (req, res) => {
    const userId = req.headers['x-user-id'];
    const url = req.url.split('?')[0];

    try {
        // Internal: matchmaking initializes the escrow for a wager-mode game.
        // Guarded by the shared service secret, never routed via the gateway.
        if (req.method === 'POST' && url === '/internal/init') {
            if (INTERNAL_API_SECRET && req.headers['x-internal-secret'] !== INTERNAL_API_SECRET) {
                return send(res, 403, { error: 'Forbidden' });
            }
            if (!escrowClient || !matches) return send(res, 503, { error: 'Escrow not configured' });
            const { gameId, stakeLamports } = await readJsonBody(req);
            if (typeof gameId !== 'string' || !Number.isInteger(stakeLamports) || stakeLamports <= 0) {
                return send(res, 400, { error: 'gameId and positive integer stakeLamports required' });
            }
            const { code, body } = await initEscrowForGame(gameId, stakeLamports);
            return send(res, code, body);
        }

        // Health/config — safe without escrow enabled
        if (req.method === 'GET' && url === '/api/escrow/status') {
            return send(res, 200, {
                enabled: !!escrowClient,
                network: 'devnet',
                programId: ESCROW_PROGRAM_ID,
                rpcUrl: SOLANA_RPC_URL
            });
        }

        if (!escrowClient || !matches) {
            return send(res, 503, { error: 'Escrow is not configured on this deployment' });
        }
        if (!userId) return send(res, 401, { error: 'Unauthorized' });

        // Retry escrow creation for a wager-mode game (fallback if the
        // automatic init at match time failed). Wager escrows are otherwise
        // created by matchmaking — plain online games cannot be wagered.
        if (req.method === 'POST' && url === '/api/escrow/wager') {
            const { gameId, stakeLamports } = await readJsonBody(req);
            if (typeof gameId !== 'string' || !Number.isInteger(stakeLamports) || stakeLamports <= 0) {
                return send(res, 400, { error: 'gameId and positive integer stakeLamports required' });
            }
            const match = await matches.findOne({ gameId });
            if (!match) return send(res, 404, { error: 'Unknown game' });
            if (match.mode !== 'wager') {
                return send(res, 403, { error: 'Only wager-mode games can hold a stake' });
            }
            const { code, body } = await initEscrowForGame(gameId, stakeLamports, userId);
            return send(res, code, body);
        }

        // Build the deposit transaction for the calling player (signed in Phantom)
        if (req.method === 'POST' && url === '/api/escrow/deposit-tx') {
            const { gameId } = await readJsonBody(req);
            const escrow = await escrows.findOne({ gameId });
            if (!escrow) return send(res, 404, { error: 'No escrow for this game' });

            const seat = escrow.users['0'] === userId ? '0' : escrow.users['1'] === userId ? '1' : null;
            if (seat === null) return send(res, 403, { error: 'You are not a player in this escrow' });

            const txBase64 = await escrowClient.buildDepositTransaction(gameId, escrow.wallets[seat]);
            return send(res, 200, { transaction: txBase64, stakeLamports: escrow.stakeLamports });
        }

        // On-chain + local state for a game's escrow
        if (req.method === 'GET' && url.startsWith('/api/escrow/game/')) {
            const gameId = decodeURIComponent(url.slice('/api/escrow/game/'.length));
            const escrow = await escrows.findOne({ gameId });
            if (!escrow) return send(res, 404, { error: 'No escrow for this game' });
            const onChain = await escrowClient.getEscrowState(gameId);
            return send(res, 200, { local: { status: escrow.status, pda: escrow.pda, stakeLamports: escrow.stakeLamports }, onChain });
        }

        return send(res, 404, { error: 'Not found' });
    } catch (e) {
        console.error('[Escrow] Request error:', e);
        // Surface on-chain program rejections readably instead of a blank 500
        const log = (e.transactionLogs || []).find(l => l.includes('Error Message:'));
        if (log) {
            return send(res, 502, { error: `On-chain program rejected: ${log.split('Error Message:')[1].trim()}` });
        }
        return send(res, 500, { error: 'Internal error' });
    }
});

server.listen(PORT, () => console.log(`Escrow service listening on port ${PORT}`));

// ── Settlement worker ─────────────────────────────────────────────────────────
// Consumes the engine's tamper-evident match records. Settles to the winner,
// cancels (refunds) on draws. Retries on next tick if a transaction fails.

async function settlementTick() {
    if (!escrowClient || !escrows || !matches) return;

    const open = await escrows.find({ status: 'open' }).toArray();
    for (const escrow of open) {
        try {
            const match = await matches.findOne({ gameId: escrow.gameId });
            if (!match || match.status !== 'finished') continue;

            const onChain = await escrowClient.getEscrowState(escrow.gameId);
            if (!onChain) continue;

            if (!onChain.depositedA || !onChain.depositedB) {
                // Match ended but stakes never fully funded → refund whatever is in
                const sig = await escrowClient.cancel(escrow.gameId, escrow.wallets['0'], escrow.wallets['1']);
                await escrows.updateOne({ _id: escrow._id }, { $set: { status: 'cancelled', settleSignature: sig, settledAt: new Date() } });
                console.log(`[Escrow] Cancelled underfunded escrow for ${escrow.gameId}: ${sig}`);
                continue;
            }

            const w0 = match.result?.['0'] === true;
            const w1 = match.result?.['1'] === true;

            if (w0 && w1) {
                const sig = await escrowClient.cancel(escrow.gameId, escrow.wallets['0'], escrow.wallets['1']);
                await escrows.updateOne({ _id: escrow._id }, { $set: { status: 'refunded_draw', settleSignature: sig, settledAt: new Date() } });
                console.log(`[Escrow] Draw — refunded both players for ${escrow.gameId}: ${sig}`);
            } else if (w0 || w1) {
                const winnerWallet = w0 ? escrow.wallets['0'] : escrow.wallets['1'];
                const sig = await escrowClient.settle(escrow.gameId, winnerWallet);
                await escrows.updateOne({ _id: escrow._id }, { $set: { status: 'settled', winnerWallet, settleSignature: sig, settledAt: new Date() } });
                console.log(`[Escrow] Settled ${escrow.gameId} → ${winnerWallet}: ${sig}`);
            }
        } catch (e) {
            console.error(`[Escrow] Settlement failed for ${escrow.gameId} (will retry):`, e.message);
        }
    }
}
setInterval(settlementTick, SETTLE_POLL_MS).unref();
