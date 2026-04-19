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

The application is then accessible at **http://localhost:443**.

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

The back-end is split into a handful of small HTTP/WebSocket services orchestrated with `docker-compose`, fronted by a single **gateway** that terminates TLS, validates access tokens, and proxies the rest of the traffic to the service that owns each route. Persistent data lives in MongoDB instances — each service reads/writes its own collections and does not share files or in-process state with other services.

This section focuses on the **auth** and **social** services (the two I designed). Teammates document `engine`, `matchmaking`, `market`, `token`, `files`, and `gateway` in their own subsections below.

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

**Responsibility.** Owns user identity logic — register, login, profile read, leaderboard read. User data lives in a MongoDB `users` collection (`username`, `mail`, bcrypt `password`, `elo`, `coins`); auth is the only service that writes to it. Login accepts either username or email, and both registration and login return a freshly minted access+refresh token pair. See [services/auth/index.js](services/auth/index.js).

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

**Connection lifecycle (WebSocket).** The browser opens a single Socket.IO connection to `social` (path `/social/socket.io`) right after login, passing the access token in the handshake query. The gateway verifies the token with the token service **before** upgrading the connection and injects the resolved `x-user-id` header; `social` trusts that header for the lifetime of the socket. The connection lives until the user closes the tab or loses network; on reconnect, the broker drains any queued notifications before handing control back to the normal live flow.

**Rationale, in one paragraph.** HTTP is used wherever the caller needs a definite reply before the UI can move on (login, friend-invite, challenge-create, game-create) or where the data is pulled on demand (chat history, search, leaderboard). WebSocket is used **only** where the server decides when the event happens — friend and challenge lifecycle events, online-status changes, and chat deliveries. The hybrid pattern that falls out of this — *client POSTs over HTTP, server validates, server pushes the downstream effect over WebSocket to the other party* — gives us transactional validation and real-time fan-out at the same time, with the broker closing the gap for users who happen to be offline at the moment an event fires.

### Per-service documentation

If a service wants to ship a more detailed document (endpoint-by-endpoint, Swagger, socket-event reference), it can be added as a `README.md` inside that service's folder and linked from this section.
