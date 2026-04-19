# Khrypto — Khet 2.0 Online

## Team

**PS8 — Khrypto**

- Youssef Ben Mzoughia
- Fares Kobbi
- Hammoud Younes

---

## Live Demo

The application is hosted on AWS and publicly accessible at:
**https://khrypto.ps8.pns.academy/**

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (any recent LTS version)
- [Docker](https://www.docker.com/) and Docker Compose

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/PolytechNS/ps8-26-khrypto.git
cd ps8-26-khrypto

# 2. Install dependencies for every service
for dir in services/*/; do (cd "$dir" && npm install); done
```

### Run with Docker (recommended)

```bash
docker-compose up -d
```

The application is then accessible at **https://localhost**.

### Run manually (development)

Start each service in a separate terminal, in any order:

```bash
cd services/gateway      && node index.js
cd services/files        && node index.js
cd services/auth         && node index.js
cd services/token        && node index.js
cd services/engine       && node index.js
cd services/matchmaking  && node index.js
cd services/social       && node index.js
cd services/market       && node index.js
```

---

## Features

### Accounts & Authentication

- **Registration** — create an account with a username, email address, and password.
- **Login** — log in with either your username or your email address.
- **Guest mode** — play local or AI games without creating an account (online features are unavailable).
- **Session persistence** — you stay logged in across page refreshes; sessions are automatically renewed.
---

### The Game — Khet 2.0

Khet 2.0 is a turn-based, two-player strategy game played on a 10 × 10 board. Each turn a player moves or rotates one of their pieces, then a laser fires from their Sphinx. The goal is to hit the opponent's **Pharaoh** with the laser.

#### Pieces

| Piece | Description |
|-------|-------------|
| **Sphinx** | Fixed in place; fires the laser at the end of every turn. |
| **Pharaoh** | The piece to protect — if hit by the laser, the game is over. |
| **Scarab** | Can swap positions with adjacent pieces; reflects the laser in both diagonal directions. |
| **Anubis** | Blocks the laser from the front; destroyed if hit from the side or back. |
| **Pyramid** | Reflects the laser in one diagonal direction; each player starts with 7 in reserve and places them during the game. |

#### Game Modes

- **Local** — two players share the same device.
- **vs AI** — play against a bot that evaluates board state and plays strategically.
- **Online Ranked** — matched against another player via the matchmaking queue; result affects your ELO rating.
- **Online Unranked (Friend Challenge)** — challenge a friend directly; no ELO impact.
- **Rejoin** — if you leave an ongoing online game, you have 60 seconds to reconnect from the home page before the game is forfeited.

---

### ELO & Leaderboard

- Every account starts at **600 ELO**.
- ELO changes only in **ranked online games** — local, AI, and unranked games have no effect.
- The gain or loss depends on the difference between your rating and your opponent's.
- The **leaderboard** on the home page shows the top 10 players by ELO.
- During a game, both players can see each other's current ELO and the estimated gain/loss before the result is confirmed.

---

### Matchmaking

- Join the ranked queue from the home page.
- The system pairs players with similar ELO; the acceptable range widens over time if no match is found.
- You can cancel the search at any time.

---

### Social Features

#### Friends

- Search for any registered user by username and send them a friend request.
- Manage pending sent and received requests from your profile page.
- Accept or decline incoming requests; you are notified in real time.
- Remove a friend at any time from your profile.

#### Friend Challenges

- Challenge any friend to a game directly from your profile page.
- Choose **Ranked** (ELO affected) or **Unranked** (no ELO impact).
- The challenged player receives a real-time notification and can accept or decline.
- Challenges expire automatically after 2 minutes if not answered.

---

### Chat Systems

#### Global Chat

- Visible to all connected users on the home page.
- Real-time delivery; message history is available on load.
- **Restriction:** messages containing profanity (English and French word lists) are blocked.

#### Private Messaging

- Available from the profile page with any accepted friend.
- Real-time delivery; full message history is preserved.
- **Restriction:** only mutual friends can exchange private messages. Removing a friend deletes the conversation.

#### In-Game Emotes

- During an online game, players can send cosmetic emotes to each other.
- Emotes are displayed in a side panel in real time.
- **Restriction:** only emotes owned in your inventory can be sent.

---

### Shop & Cosmetics

#### Lootbox

- Costs **50 coins** per opening.
- Drops one cosmetic item at random:
  - **Common** — 70 % chance
  - **Rare** — 24 % chance
  - **Mythical** — 5 % chance
  - **Goat** (ultra-rare) — 1 % chance
- If the item is already owned, you receive **10 coins** as compensation.

#### Items

**Emotes (10 total)**

| Rarity | Emotes |
|--------|--------|
| Common | Flamed Scarab, GG, Haha, Question Marks, Shield |
| Rare | EZ, MVP, Sad |
| Mythical | FF, What A Move |

**Profile Pictures (10 total)**

| Rarity | Avatars |
|--------|---------|
| Common | Ankh, Anubis, Sphinx, Pyramid |
| Rare | Egyptian Magician, Solana Boat, Horus |
| Mythical | Bitcoin Temple, Shiba |
| Goat | Goat Trader |

#### Inventory & Equipping

- View all owned items from the shop page.
- Equip one profile picture and use any owned emotes in game.
- Your equipped profile picture is visible to other players.

---

### Profile Page

- Displays your username, email, ELO, coin balance.    
- Manage your friends list, pending requests, and active conversations.
- Equip cosmetics from your inventory.

---

## Back-end architecture

The back-end is split into a handful of small HTTP/WebSocket services orchestrated with `docker-compose`, fronted by a single **gateway** that terminates TLS, validates access tokens, and proxies the rest of the traffic to the service that owns each route. Persistent data lives in a shared MongoDB instance. Ideally each service would own its collections exclusively, but in practice engine, matchmaking, and market read or write the `users` collection directly — a pragmatic shortcut documented in each service's section below.


### Service breakdown

| Service | One-line role |
|---|---|
| `gateway` | Single HTTPS entry point: TLS termination, routing, token verification, WebSocket upgrade with `x-user-id` injection. |
| `auth` | User identity: register, login, profile read, leaderboard. |
| `token` | JWT issuance (access + refresh) and verification — called by the gateway on almost every authenticated request. |
| `social` | Friends, friend challenges, global chat, private chat, online-status tracking, and an in-house broker for offline notifications. |
| `engine` | Game state, turn resolution, laser simulation, game lifecycle. |
| `matchmaking` | Ranked queue, ELO-aware pairing, game creation hand-off to `engine`. |
| `market` | Shop, lootbox, cosmetics inventory, coin balance. |
| `files` | Static-file server for the front-end bundle (HTML / CSS / JS / assets). |

### Auth service

**Responsibility.** Owns user identity logic — register, login, profile read, leaderboard read. User data lives in a MongoDB `users` collection (`username`, `mail`, bcrypt `password`, `elo`, `coins`); auth is the intended owner of that collection, though engine and market access it directly as noted in their sections. Login accepts either username or email, and both registration and login return a freshly minted access+refresh token pair. See [services/auth/index.js](services/auth/index.js).

**Why it's separate from the token service (and, in hindsight, probably shouldn't be).** The original intent was a clean split: auth answers *"who is this user and are the credentials right?"*; token answers *"is this JWT still valid?"*. In practice, the two paths have very different traffic shapes. The token service is hit on **almost every authenticated request** — the gateway verifies tokens for `/api/profile`, `/api/friend/*`, `/api/chat/*`, and so on. The auth service is only hit on **register, login, and when both access and refresh tokens have expired**, which is rare. Running a full always-on service for a cold path is a design problem worth naming: if we did this over, **merging auth into the token service** would make more sense — the handful of auth endpoints would sit comfortably next to token issuance and verification, and we would remove an always-running container that spends most of its life idle.

**Why HTTP-only.** Every auth interaction is a discrete request/response: submit credentials → receive tokens; GET profile → receive profile. Nothing in login / register / profile-read requires the server to push anything to the client, so a REST surface behind the gateway is the simplest fit. Auth opens no sockets and keeps no session state. The only outbound call it makes is a synchronous HTTP POST to the token service immediately after register/login to obtain the token pair, so the client gets both tokens in the same response and doesn't need a second round-trip.

**Trust boundary.** Auth never verifies JWTs itself. For `/api/profile`, the gateway has already verified the access token against the token service and injected an `x-user-id` header; auth reads that header as ground truth. This works because auth is only reachable through the gateway, on the internal Docker network.

### Social service

**Responsibility.** Everything relationship- and real-time-between-users: friends (search, invite, accept/decline, remove, list), friend challenges (ranked and unranked, 2-minute TTL), global chat, private chat (gated on mutual friendship), online-status tracking, and a small in-house broker for offline notifications. Social reads/writes four MongoDB collections (`friendships`, `global_messages`, `private_messages`, `message_queue`); the data itself lives in Mongo, not in the service. See [services/social/index.js](services/social/index.js) and [services/social/broker.js](services/social/broker.js).

**Why one service instead of splitting friends / chat / challenges into three.** All three features depend on the **same two pieces of shared state**:

1. the in-memory `onlineUsers` map that is updated on every socket connect / disconnect,
2. the "are these two users friends?" check that gates private chat, challenge creation, and challenge responses.

Splitting would either require replicating the online-status map across services (with the fan-out problem that brings) or adding an extra service-to-service round-trip on every chat write and every challenge action, just to re-check friendship status. The features are also coupled by **a single Socket.IO connection per client** — we didn't want the browser to open three separate sockets just to talk to three sub-services that share the same identity. One service keeps the wiring trivial.

**The broker.** Real-time notifications (friend requests, challenge invitations, chat messages) need to reach a user **even if they're offline at the moment the event fires**. We built a small broker in [services/social/broker.js](services/social/broker.js) that exposes a single `dispatch(userId, event, payload)` API. Events addressed to an online user are pushed over the socket immediately; events addressed to a disconnected user are persisted in the `message_queue` collection (with a 30-day TTL) and flushed to the user automatically on their next socket handshake. The HTTP handlers don't know or care whether the target is currently connected — they just call `dispatch`.

**Inter-service call.** When a challenge is accepted, social HTTP-POSTs to `engine`'s `POST /api/games` with both players' IDs and ELOs, receives a `gameId`, and pushes the acceptance notification (including the `gameId`) to both players over the socket. Synchronous HTTP is the right shape: challenge-accept is a transactional moment and the caller needs the `gameId` in the same response before it can redirect both clients to the game page.

**Trust boundary.** Like auth, social trusts the gateway's injected `x-user-id` header on HTTP endpoints and on the socket handshake; the socket middleware only checks that the header is populated.

### Token service

**Responsibility.** Sole authority for JWT operations: issuing access + refresh token pairs (`POST /sign`), verifying access tokens (`POST /verify`), and refreshing expired access tokens (`POST /refresh`). Access tokens expire after 75 minutes; refresh tokens after 30 days, with a sliding-window renewal — if the refresh token has less than 7 days left, a new one is issued alongside the new access token. The service has no database and no state: everything lives in the signed token payload. See [services/token/index.js](services/token/index.js).

**Why it's a separate service (and why it arguably shouldn't be).** The original intent was a clean split between identity logic (auth) and JWT logic (token). In practice, a better improvement would have been to fold token verification directly into the gateway, since every authenticated request is already rerouted through the gateway and token only ever does a stateless JWT check. The extra network hop to a separate process on every single request is avoidable overhead that adds latency with no architectural benefit. If rebuilt, the token logic would live inside the gateway itself, or at most be a shared module rather than a standalone service.

**Why HTTP-only.** Every token operation is a discrete, synchronous exchange: submit a userId → receive tokens; submit a token → receive valid/invalid + userId. The token service exposes only HTTP endpoints, and that is sufficient — the gateway calls `/verify` over HTTP both for regular authenticated requests and for WebSocket upgrade handshakes (matchmaking, social, engine), so there is no scenario where the token service itself needs to push anything or hold a persistent connection.

### Gateway service

**Responsibility.** Single HTTPS entry point for all client traffic. Terminates TLS (Let's Encrypt certificates), routes requests to the correct downstream service based on URL prefix, enforces authentication by verifying access tokens against the token service before forwarding, and injects the resolved `x-user-id` header so downstream services never touch JWTs themselves. Also upgrades WebSocket connections for `matchmaking`, `social`, and `engine`, performing the same token check before the upgrade completes (engine additionally supports unauthenticated guests, who receive a randomly generated `guest_X` id). See [services/gateway/index.js](services/gateway/index.js).

**The token verification bottleneck.** The gateway calls the token service on virtually every authenticated request. Since token verification is a stateless JWT check, this round-trip is unnecessary — the same logic could run inside the gateway process itself. This is the same regret noted in the token service section: the cleaner design is to inline the verification rather than incurring a service-to-service HTTP call on every request.

**Guest support.** The engine is the only service reachable without a valid token. If no token is present in the request, the gateway assigns a random `guest_X` identifier and forwards the request. This is what allows local and AI game modes to work without an account.

### Engine service

**Responsibility.** Owns everything that happens inside a running game: board state, turn enforcement, move validation, laser path computation, piece destruction, AI opponent turns, ELO calculation, and the 60-second reconnect grace period on disconnect. Each active game is a `Game` instance stored in an in-memory `Map` keyed by game ID. Engine exposes one HTTP endpoint (`POST /api/games`) for game creation (called by matchmaking and social), and a Socket.IO interface for all real-time game events. See [services/engine/index.js](services/engine/index.js) and [services/engine/managers/GameManager.js](services/engine/managers/GameManager.js).

**Why in-memory state.** Storing game state in a `Map` rather than a database was a deliberate choice. Every player action triggers a full board re-evaluation plus laser simulation; reading and writing that state from MongoDB on every turn would add serialization overhead and latency with no benefit during the game. The trade-off is that active game state does not survive a service restart — acceptable for the project scope.

**Why WebSocket for game events.** Every move produces an immediate board update and laser result that must reach both players at the same time. Any delay is visible and breaks the experience. WebSocket is the only sensible fit: the server decides when to push (after a move resolves), there is no natural request/response shape, and polling would introduce intolerable lag for a game where a laser fires and pieces are destroyed on every turn.

**ELO update shortcut.** When a ranked game ends, engine computes ELO deltas using the standard formula (K=20) and writes the new values directly to the `users` MongoDB collection — which is nominally auth's domain. The cleaner design would be to call an auth HTTP endpoint and let auth own all writes to its collection. This works but creates an implicit coupling: engine must know auth's data schema. It is a pragmatic first iteration that we would fix by adding an ELO update endpoint to auth.

**Why separate from matchmaking.** Engine was built before matchmaking existed. Even setting aside that history, keeping them separate makes sense: matchmaking is about finding who plays whom; engine is about running the game. They have different failure modes — a crash in matchmaking should not bring down ongoing games — and the clean interface between them (a single `POST /api/games`) makes the boundary easy to reason about.

### Matchmaking service

**Responsibility.** Manages the ranked queue: players join over WebSocket, declare they want to play, and are notified when a match is found. A sweeper loop runs every 5 seconds, scans all waiting players for compatible pairs, HTTP-POSTs to engine to create a game, and emits `matchmaking:found` (with `gameId` and `playerId`) to both sockets. Players can cancel at any time; disconnecting also removes them from the queue. See [services/matchmaking/index.js](services/matchmaking/index.js) and [services/matchmaking/queue.js](services/matchmaking/queue.js).

**ELO-aware pairing with widening tolerance.** The queue starts each player at an acceptable ELO range of ±50. Every 15 seconds that a player waits without being matched, the range widens by an increasing increment (25, 50, 75 …) — the total accepted range after *n* intervals is `50 + 25 · n·(n+1)/2`. Both players in a potential pair must mutually accept the ELO difference before the match is made. This prevents good players from immediately being matched against beginners, while ensuring nobody waits forever.

**Why WebSocket.** The matchmaking experience is asynchronous by nature: the player submits to the queue and then waits an unknown amount of time. HTTP polling would mean the browser hammering the server with requests while nothing has changed, and the match notification would still arrive with up to one polling interval of lag. WebSocket lets the server push `matchmaking:found` the instant a match is made in the sweeper tick. The widening-range update (`matchmaking:waiting`) is also pushed periodically so the UI can show the live search range, which would not be practical with polling.

**Inter-service call on match.** When a pair is found, matchmaking synchronously HTTP-POSTs to engine's `POST /api/games`. Synchronous HTTP is the right shape: matchmaking needs the `gameId` in the same sweeper tick to emit `matchmaking:found` to both players. If the engine call fails, both players are put back in the queue and notified.

### Market service

**Responsibility.** Owns the shop, lootbox, cosmetics inventory, coin balance, and item equipping. Manages two MongoDB collections (`items`, `inventory`) and seeds the full catalogue of emotes and profile pictures on startup. Also serves its own cosmetic image assets directly under `/api/market/assets/`. HTTP-only. See [services/market/index.js](services/market/index.js).

**Why HTTP-only.** All market interactions are either pull-based (browse items, check balance, view inventory) or transactional (open lootbox, equip item). None of them require the server to push data to the client unprompted. REST is the natural fit — each action has a clear request and a definitive response.

**Asset serving.** Cosmetic images are served by the market service itself rather than the files service. The reasoning was that cosmetic assets are semantically part of the market domain and it was simpler to colocate them. A more principled design would centralize all static assets in the files service and have market reference them by URL.

**DB access shortcut.** Market reads the `users` collection directly for coin balance and avatar lookups, rather than going through auth. This is the same pragmatic shortcut as engine's ELO writes: it works, but it couples market to auth's schema. A cleaner design would add a thin endpoint to auth for any user-data access, making auth the single owner of that collection. The avatar lookup (`GET /api/market/avatar/:username`) and the lootbox compensation flow both touch `users` this way and would be the first things to fix.

**Public vs. authenticated endpoints.** Asset serving and avatar lookups are unauthenticated — you need to see other players' profile pictures without being logged in yourself. All transactional endpoints (balance, inventory, lootbox, equip) require the `x-user-id` header injected by the gateway.

### HTTP vs. WebSocket — who talks to whom, when, and why

| Flow | Transport | Initiator → Target | When | Why this transport |
|---|---|---|---|---|
| Register / login / profile / leaderboard | HTTP | Browser → gateway → `auth` | User submits a form or opens a screen that needs the profile | Discrete request/response, no push semantics |
| Token issuance after register/login | HTTP | `auth` → `token` | Inside a register/login request, before replying to the client | Synchronous internal dependency; caller needs the token pair inline |
| Token verification on authenticated routes | HTTP | `gateway` → `token` | On every authenticated HTTP request and every WS upgrade | Request-scoped check; nothing to stream |
| Friends (search, invite, respond, remove, list, pending, sent) | HTTP | Browser → gateway → `social` | User action in the profile page | Transactional — needs atomic validation + a definitive reply before the UI updates |
| Challenges (create, respond, list pending) | HTTP | Browser → gateway → `social` | User clicks *Challenge* or *Accept/Decline* | Transactional; accept additionally needs a synchronous `gameId` from `engine` in the same response |
| Chat history + unread counts | HTTP | Browser → gateway → `social` | User opens global chat or a private conversation, or scrolls to load older messages | Pull-style query driven by UI; pagination is a natural fit for request/response |
| Game creation on challenge accept | HTTP | `social` → `engine` | When a challenge is accepted | Synchronous: we need the `gameId` immediately to notify both players |
| Real-time notifications: friend lifecycle, challenge lifecycle, chat deliveries, online-status changes | WebSocket (server → client) | `social` → Browser | Whenever another user acts on the recipient, or a challenge timer expires | The receiver didn't ask for these — the server decides *when* they fire. Pushing is the only non-wasteful option; polling would be too laggy for chat and too expensive for status |
| Sending chat messages, read receipts, online-status batch queries on reconnect | WebSocket (client → server) | Browser → `social` | While the user is actively using chat | These are side-effects that fan out to other clients, so it is natural to keep *send* and *receive* on the same connection |
| Join / cancel ranked queue | WebSocket (client → server) | Browser → gateway → `matchmaking` | User clicks *Play* or *Cancel* on the home page | The result arrives asynchronously (unknown wait time); the client must stay connected to receive the match notification |
| Match found notification, live ELO range updates while waiting | WebSocket (server → client) | `matchmaking` → Browser | When the sweeper finds a pair, or every 5 seconds for waiting players | Server decides when these fire; polling would add lag to match delivery and waste requests during the wait |
| Game creation (ranked queue match) | HTTP | `matchmaking` → `engine` | Inside the sweeper tick when a pair is found | Synchronous: matchmaking needs the `gameId` in the same tick to notify both players |
| Join game room, player move | WebSocket (client → server) | Browser → `engine` | When the game page loads, and on every turn | Moves trigger immediate server-side computation and must reach both players without delay — polling would make the laser feel broken |
| Board state after move, laser result, game-over, reconnect events | WebSocket (server → client) | `engine` → Browser | After every validated move, or when a player disconnects / reconnects | The engine decides when these fire; both players must receive the same update simultaneously — impossible with independent polling |
| Market: browse items, balance, inventory, lootbox, equip | HTTP | Browser → gateway → `market` | User opens the shop or interacts with an item | All pull-based or transactional; no server-initiated push needed |
| Avatar lookup (other players' profile pictures) | HTTP | Browser → gateway → `market` | Any screen that displays a username with its avatar | Public, pull-on-demand; no authentication required |

**Connection lifecycle (WebSocket).** The browser opens a single Socket.IO connection to `social` (path `/social/socket.io`) right after login, passing the access token in the handshake query. The gateway verifies the token with the token service **before** upgrading the connection and injects the resolved `x-user-id` header; `social` trusts that header for the lifetime of the socket. The connection lives until the user closes the tab or loses network; on reconnect, the broker drains any queued notifications before handing control back to the normal live flow. A separate Socket.IO connection is opened to `matchmaking` only while the user is in the queue, and a third to `engine` only while a game is active — both are torn down as soon as they are no longer needed.

**Rationale, in one paragraph.** HTTP is used wherever the caller needs a definite reply before the UI can move on (login, friend-invite, challenge-create, game-create, market transactions) or where the data is pulled on demand (chat history, search, leaderboard, shop catalogue). WebSocket is used **only** where the server decides when the event happens — friend and challenge lifecycle events, online-status changes, chat deliveries, match notifications, and live game events. The hybrid pattern that falls out of this — *client POSTs over HTTP, server validates, server pushes the downstream effect over WebSocket to the other party* — gives us transactional validation and real-time fan-out at the same time, with the social broker closing the gap for users who happen to be offline at the moment an event fires.

### Per-service documentation

If a service wants to ship a more detailed document (endpoint-by-endpoint, Swagger, socket-event reference), it can be added as a `README.md` inside that service's folder and linked from this section.
