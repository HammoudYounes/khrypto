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
