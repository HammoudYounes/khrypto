# Khrypto Escrow Program (DEVNET ONLY)

Anchor program that holds a SOL wager from two players in a PDA and releases
it to the winner when the Khrypto engine reports a match result.

**This program targets devnet exclusively.** It uses a single-key result
oracle and has not been audited — do not deploy to mainnet.

## Design

- PDA per match, seeds: `["escrow", oracle_pubkey, sha256(gameId)]`.
  Including the oracle in the seeds means only escrows initialized by the
  Khrypto oracle key are recognized by the escrow service (no PDA squatting).
- `initialize_match(gameId, hash, playerA, playerB, stake, deadline)` — oracle
  creates the escrow and pays rent.
- `deposit` — each player transfers the stake into the PDA (before deadline).
- `settle(winner)` — oracle-only; requires both deposits; pays 2×stake to the
  winner. The account stays open (settled flag) as an on-chain audit record.
- `cancel` — oracle-only; refunds whatever was deposited (draws, aborted
  matches, integrity disputes).
- `reclaim` — player self-service refund after the deadline if the oracle
  never resolved the match (funds can't be stranded).

## Build & deploy (devnet)

Prereqs: Rust, Solana CLI, Anchor (`cargo install --git https://github.com/coral-xyz/anchor avm && avm install latest && avm use latest`).

```bash
cd programs/khrypto-escrow

# One-time: create a devnet wallet & fund it
solana-keygen new
solana config set --url devnet
solana airdrop 2

anchor build
anchor keys sync      # writes the real program id into lib.rs + Anchor.toml
anchor build          # rebuild with the synced id
anchor deploy         # deploys to devnet

# Then configure the escrow service:
#   ESCROW_PROGRAM_ID=<the deployed id>
#   SOLANA_RPC_URL=https://api.devnet.solana.com
#   ORACLE_KEYPAIR_PATH=<path to the oracle keypair json>
```

The escrow service (`services/escrow`) computes Anchor instruction
discriminators itself, so it does not need the generated IDL.
