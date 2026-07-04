# Khrypto Arena — Anticheat & Match Integrity System

This document describes the full anticheat architecture: what it protects
against, how each layer works, how to operate it (reviewing flags, tuning,
unbanning), and — honestly — what it cannot do. It is written for a platform
that will eventually arbitrate real SOL wagers, so every design decision is
explained through that lens.

The system has **two layers**:

1. **Prevention** — server-authoritative enforcement that makes entire
   classes of cheating *impossible* (not just detectable).
2. **Detection & enforcement** — post-match analysis that identifies
   machine-assisted play and makes it *unprofitable*.

---

## Layer 1 — Prevention (enforced in real time)

### 1.1 Server-derived identity

The single most important property: **the server decides who you are, never
the client.**

- Every engine WebSocket connection is token-verified at the **gateway**
  (`services/gateway/index.js`), which injects a verified `x-user-id`
  header. Tokenless connections are tagged `guest_*` and can only play
  local/AI games — never online.
- When joining an online game, the **engine** derives your seat by matching
  your verified user id against the game's registered players
  (`services/engine/index.js`, `game:join`). The `playerId` a client sends
  is ignored. Non-players are rejected outright (no spectators).
- Every `player:action` resolves the acting player from the server's
  socket→seat map. It is impossible to submit a move as your opponent,
  regardless of what the client claims.
- Game ids are UUIDs (unguessable); internal game-creation APIs require a
  shared service secret (`INTERNAL_API_SECRET`); JWT secrets are
  environment-provided (`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`).

**Threats eliminated:** playing both sides of a match, move forgery, seat
hijacking, joining games you're not part of, forging games via internal APIs.

### 1.2 Full rules validation

All game rules are validated server-side (`services/engine/rules/actions.js`):
coordinates and orientations are type- and bounds-checked, piece ownership is
enforced on every action type, movement/placement/swap constraints and
cooldowns are applied, and the laser is computed exclusively by the server.
The client renders; it never decides.

**Threats eliminated:** illegal moves, modified clients, rules exploits.

### 1.3 Time control

- **60-second turn clock** (`services/engine/models/Game.js`), started once
  both players join, reset on each valid move. Expiry forfeits the match.
  The clock **keeps running during disconnects**.
- **90-second cumulative disconnect grace budget** per player per game —
  a real network drop is survivable once, but repeated tactical disconnects
  exhaust the budget and forfeit. Intentional "leave" and network drops
  share one code path and one budget.

**Threats eliminated:** stalling forever, disconnect-loops to dodge losses
or buy thinking time, rage-quitting without consequence.

### 1.4 Matchmaking hygiene

(`services/matchmaking/index.js`, `queue.js`)

- An account can never be matched against itself (a second tab replaces the
  first queue entry).
- A 5-minute **rematch cooldown** prevents the same two accounts from
  immediately re-pairing — friction against win-trading and Elo pumping.
- Wager queues are **tier-scoped** (you only meet opponents at your exact
  stake) and require a linked wallet.
- Per-socket **token-bucket rate limits** on all engine and matchmaking
  events; abusive sockets are disconnected.

### 1.5 The audit trail (the foundation of everything else)

Every online match is persisted to the `matches` collection
(`services/engine/managers/MatchRecorder.js`), written incrementally so a
crash mid-game still leaves evidence:

- the randomized **initial board**,
- **every move**, with the acting player and a **server-side timestamp**,
- the result, reason (elimination / forfeit / timeout / draw), and Elo
  before/after.

This record is what wager settlement trusts, what the replay viewer renders,
and what the integrity analyzer consumes. Because moves are recorded by the
server as they happen, a player cannot retroactively alter their history.

### 1.6 Wager-specific prevention

- **Staking gate**: a wager match does not begin until *both* stakes are
  locked on-chain (2-minute window). Cancel/disconnect/timeout aborts the
  wager and refunds any deposit automatically. Nobody can enter a wager
  game without having paid.
- The on-chain escrow (`programs/khrypto-escrow`) only accepts settlement
  from the oracle key, requires two distinct wallets, refunds on cancel,
  and lets players self-reclaim after a deadline so funds can never be
  stranded. One wallet can only be linked to one account (ownership proven
  by ed25519 challenge signature).

---

## Layer 2 — Detection: the Integrity Analyzer

**File:** `services/engine/managers/IntegrityAnalyzer.js`
**Targets:** machine-assisted play — a player running an engine/bot to pick
their moves ("simulating a machine to win").

### 2.1 Why this design

Prevention cannot stop assistance: the moves a bot suggests are *legal* —
the cheat happens outside the game. But assisted play has a measurable
statistical fingerprint, and Khrypto is unusually well positioned to measure
it, because the platform owns **both** the deterministic rules engine and a
strong search bot (`services/engine/ai/smartBot.js` — the realistic
assistance tool an attacker would use is this very engine).

### 2.2 What it measures

The analyzer runs inside the engine service, polling for finished online
matches (`online`, `wager`, `ranked_challenge`) that haven't been analyzed.
Wager matches are processed first because settlement waits on the verdict.

For each match it **re-simulates every recorded move through the real rules
engine** and computes, per player:

| Signal | Metric | Human profile | Machine profile |
|---|---|---|---|
| **Engine agreement** | % of moves equal to the search bot's best move for the same position (openings skipped — they're convergent for everyone) | Low–moderate; even strong humans diverge | Near-100% if using the bot |
| **Speed** | Median think time (from server timestamps between moves) | Seconds to minutes, position-dependent | Constant sub-2s |
| **Rhythm** | Coefficient of variation of think times | Erratic (fast forced moves, long critical thinks) | Metronomic (CV < 0.2) |
| **Fast strong moves** | Count of engine-matching moves played in under 2 s | Rare | Routine |

### 2.3 Scoring and verdicts

A composite score (0–110) combines the signals:

- engine agreement ≥ 90% → +60, ≥ 80% → +45, ≥ 70% → +25
- median think < 1.5 s → +25, < 3 s → +15
- timing CV < 0.2 → +15
- ≥ 5 fast strong moves → +10

Verdicts (deliberately conservative):

| Verdict | Condition | Meaning |
|---|---|---|
| `suspect` | score ≥ 70 **and** engine agreement ≥ 75% | Machine assistance likely. Enforcement triggers. |
| `watch` | score ≥ 40 | Elevated but not actionable alone. |
| `clear` | otherwise | No evidence. |
| `insufficient` | fewer than ~6 analyzable moves | Short games prove nothing either way. |

**Design rule: timing alone can never produce `suspect`.** A nervous fast
player or a laggy connection cannot be flagged; only strong engine
agreement — the signal a human can't fake by accident — unlocks it.

The full report (all metrics, both players) is stored on the match record
at `matches.integrity`, so every verdict is auditable after the fact, and
the replay viewer lets a human watch any flagged game move by move.

### 2.4 Enforcement — cheating must not pay

Enforcement is **loss-limited by design**: the penalty structure guarantees
that a false positive never costs an honest player money.

1. **Wager settlement gate** (`services/escrow/index.js`): the settlement
   worker will not pay a wager pot until the match has an integrity
   verdict. A `suspect` verdict → the escrow is **cancelled on-chain and
   both players refunded** (escrow status `integrity_refund`). The cheater
   gains nothing; the opponent loses nothing. If the analyzer produces no
   verdict within `INTEGRITY_WAIT_MS` (default 10 min), settlement proceeds
   unverified with a logged warning — an analyzer outage can't freeze pots.
2. **Escalating suspension**: each `suspect` verdict increments
   `users.integritySuspectCount`. At 3 (configurable), the account gets
   `wagerBanned: true` and is rejected from the wager queue with
   *"Wager access suspended pending an integrity review"*. Normal
   (non-wager) play remains available — the ban protects money, not fun.

### 2.5 Configuration

All knobs are environment variables (engine service unless noted):

| Variable | Default | Meaning |
|---|---|---|
| `INTEGRITY_INTERVAL_MS` | 15000 | Analyzer poll interval |
| `INTEGRITY_BOT_MS` | 150 | Search budget per analyzed move |
| `INTEGRITY_MIN_MOVES` | 8 | Minimum moves per player for a verdict |
| `INTEGRITY_SUSPECT_SCORE` | 70 | Score threshold for `suspect` |
| `INTEGRITY_BAN_AFTER` | 3 | Suspect matches before wager suspension |
| `INTEGRITY_WAIT_MS` (escrow) | 600000 | How long settlement waits for a verdict |

Analysis cost: ~150 ms × analyzed moves, i.e. a 40-move game takes ~6 s of
background CPU — asynchronous, never in the game loop.

### 2.6 Operations runbook

- **Review a flag:** find the match (`db.matches.findOne({gameId})`), read
  `integrity.perPlayer` for the metrics, and watch it in the replay viewer
  (`/replayPage/index.html?gameId=...`).
- **Unban after review:**
  `db.users.updateOne({username}, {$unset: {wagerBanned: "", integritySuspectCount: ""}})`
- **Force re-analysis:**
  `db.matches.updateOne({gameId}, {$unset: {integrity: ""}})` — the worker
  will pick it up on the next tick.
- **Refunded-by-integrity escrows** have status `integrity_refund` in the
  `escrows` collection, with the on-chain cancel signature for proof.

### 2.7 Validation

The system was validated with synthetic matches generated through the real
rules engine:

- A **bot-assisted profile** (search-bot moves at ~800 ms intervals) was
  flagged `suspect` — 100% engine agreement, 809 ms median think, CV 0.13,
  score 110.
- The **honest opponent** in the same game and **both players** in a
  human-profile control game (random moves, erratic 3–15 s timing) scored
  0 — `clear`.
- A wager-banned account is rejected from the wager queue but can still
  queue for normal games.

---

## Threat model summary

| Threat | Status | Mechanism |
|---|---|---|
| Move forgery / playing both seats | **Impossible** | Server-derived identity |
| Illegal moves / modified client | **Impossible** | Server-side rules + laser |
| Stalling / disconnect abuse | **Impossible** | Turn clock + grace budget |
| Self-matching / instant Elo trading | **Impossible** | Queue identity checks + rematch cooldown |
| Joining a wager without paying | **Impossible** | Pre-game staking gate |
| Tampering with results/history | **Impossible** | Server-written audit trail; oracle-only settlement |
| Engine/bot assistance | **Detected & unprofitable** | Integrity analyzer + refund-not-pay + wager ban |
| Metronomic scripted play | **Detected** (watch/suspect) | Timing rhythm analysis |

### Known residual risks (documented, not hidden)

- **Humanized bots** — an attacker adding random delays and deliberate
  mistakes evades timing signals and lowers engine agreement, but in doing
  so gives up most of the bot's strength advantage. That trade-off *is* the
  deterrent; detection thresholds can be tightened as real-player data
  accumulates.
- **Human proxies** ("my strong friend plays my account") — undetectable by
  move analysis on any platform; mitigated long-term by cross-match
  behavioral baselines per account.
- **Sandbagging** (deliberately losing to lower Elo) — the data to detect
  it (match history, Elo trajectories) is collected; detection is a future
  analysis layer.
- **Small-sample noise** — verdicts require minimum sample sizes, and
  wager enforcement refunds rather than confiscates, precisely to make the
  cost of an error acceptable.

### Planned hardening for mainnet scale

- Per-player behavioral baselines across matches (a 600-Elo account
  suddenly playing at engine strength is a stronger signal than any single
  game).
- Human review dashboard on top of `matches.integrity` + replays.
- Multi-signer / attested oracle for settlement (single oracle key is a
  devnet-phase trust root).
- Collusion-pattern analysis (pairing frequency, one-sided pots) over the
  wager history.
