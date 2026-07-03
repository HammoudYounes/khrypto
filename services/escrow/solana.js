/**
 * Minimal Anchor-compatible client for the khrypto-escrow program.
 * Computes instruction discriminators itself (sha256("global:<name>")[0..8])
 * so it works without the generated IDL.
 */
const crypto = require('crypto');
const {
    Connection, Keypair, PublicKey, SystemProgram,
    Transaction, TransactionInstruction, sendAndConfirmTransaction
} = require('@solana/web3.js');

const ESCROW_SEED = Buffer.from('escrow');

function discriminator(name) {
    return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function gameIdHash(gameId) {
    return crypto.createHash('sha256').update(gameId).digest();
}

function u64le(n) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
}

function i64le(n) {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(n));
    return b;
}

function borshString(s) {
    const bytes = Buffer.from(s, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(bytes.length);
    return Buffer.concat([len, bytes]);
}

class EscrowClient {
    constructor({ rpcUrl, programId, oracleKeypair }) {
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.programId = new PublicKey(programId);
        this.oracle = oracleKeypair;
    }

    derivePda(gameId) {
        const hash = gameIdHash(gameId);
        const [pda, bump] = PublicKey.findProgramAddressSync(
            [ESCROW_SEED, this.oracle.publicKey.toBuffer(), hash],
            this.programId
        );
        return { pda, bump, hash };
    }

    /** Oracle creates the escrow account for a match. */
    async initializeMatch(gameId, playerA, playerB, stakeLamports, deadlineUnix) {
        const { pda, hash } = this.derivePda(gameId);
        const data = Buffer.concat([
            discriminator('initialize_match'),
            borshString(gameId),
            hash,
            new PublicKey(playerA).toBuffer(),
            new PublicKey(playerB).toBuffer(),
            u64le(stakeLamports),
            i64le(deadlineUnix)
        ]);

        const ix = new TransactionInstruction({
            programId: this.programId,
            keys: [
                { pubkey: pda, isSigner: false, isWritable: true },
                { pubkey: this.oracle.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
            ],
            data
        });
        const sig = await sendAndConfirmTransaction(this.connection, new Transaction().add(ix), [this.oracle]);
        return { pda: pda.toBase58(), signature: sig };
    }

    /** Build an (unsigned, base64) deposit transaction for a player to sign in Phantom. */
    async buildDepositTransaction(gameId, playerWallet) {
        const { pda } = this.derivePda(gameId);
        const player = new PublicKey(playerWallet);

        const ix = new TransactionInstruction({
            programId: this.programId,
            keys: [
                { pubkey: pda, isSigner: false, isWritable: true },
                { pubkey: player, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
            ],
            data: discriminator('deposit')
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = player;
        tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
        return tx.serialize({ requireAllSignatures: false }).toString('base64');
    }

    /** Oracle pays the pot to the winner. */
    async settle(gameId, winnerWallet) {
        const { pda } = this.derivePda(gameId);
        const ix = new TransactionInstruction({
            programId: this.programId,
            keys: [
                { pubkey: pda, isSigner: false, isWritable: true },
                { pubkey: this.oracle.publicKey, isSigner: true, isWritable: false },
                { pubkey: new PublicKey(winnerWallet), isSigner: false, isWritable: true }
            ],
            data: discriminator('settle')
        });
        return sendAndConfirmTransaction(this.connection, new Transaction().add(ix), [this.oracle]);
    }

    /** Oracle refunds both players (draw / abort). */
    async cancel(gameId, playerA, playerB) {
        const { pda } = this.derivePda(gameId);
        const ix = new TransactionInstruction({
            programId: this.programId,
            keys: [
                { pubkey: pda, isSigner: false, isWritable: true },
                { pubkey: this.oracle.publicKey, isSigner: true, isWritable: false },
                { pubkey: new PublicKey(playerA), isSigner: false, isWritable: true },
                { pubkey: new PublicKey(playerB), isSigner: false, isWritable: true }
            ],
            data: discriminator('cancel')
        });
        return sendAndConfirmTransaction(this.connection, new Transaction().add(ix), [this.oracle]);
    }

    /** Read raw escrow account state (deposited flags live at fixed offsets). */
    async getEscrowState(gameId) {
        const { pda } = this.derivePda(gameId);
        const info = await this.connection.getAccountInfo(pda);
        if (!info) return null;

        const d = info.data;
        // Layout: 8 disc | 32 hash | 4+len game_id | 32 oracle | 32 a | 32 b | 8 stake | 8 deadline | 4 bools | 32 winner | 1 bump
        let o = 8 + 32;
        const idLen = d.readUInt32LE(o); o += 4 + idLen;
        o += 32; // oracle
        const playerA = new PublicKey(d.subarray(o, o + 32)).toBase58(); o += 32;
        const playerB = new PublicKey(d.subarray(o, o + 32)).toBase58(); o += 32;
        const stakeLamports = Number(d.readBigUInt64LE(o)); o += 8;
        const deadline = Number(d.readBigInt64LE(o)); o += 8;
        const depositedA = d[o] === 1; o += 1;
        const depositedB = d[o] === 1; o += 1;
        const settled = d[o] === 1; o += 1;
        const cancelled = d[o] === 1; o += 1;
        const winner = new PublicKey(d.subarray(o, o + 32)).toBase58();

        return {
            address: pda.toBase58(), playerA, playerB, stakeLamports,
            deadline, depositedA, depositedB, settled, cancelled,
            winner: winner === PublicKey.default.toBase58() ? null : winner,
            lamports: info.lamports
        };
    }
}

module.exports = { EscrowClient, gameIdHash, discriminator };
