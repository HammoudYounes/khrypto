# Front part of the PS8 project

This folder should contain all the static files that could be returned by the file server to clients.

By default, the HTTP server used in `services/files/logic.js` will start checking for files inside this repo.
This means that when a client targets `projectName.ps8.academy/folder1/file1.png`*, 
the HTTP server will try to find `file1.png` inside `front/folder1`.

You are free to change this behavior, and to manage the folders and files inside this project however you like, 
but remember to update the `services/files/logic.js` file accordingly.

*Note: At the start of the project, you don't have a `ps8.academy` URL, so you will have to use localhost.

---

## Front-end architecture

The front-end is a **multi-page application**. Each page is a standalone `index.html` + `<page>.css` + `<page>.js` triplet served from `front/`. Navigation between pages is done with plain `<a>` links or `window.location` redirects. Shared behaviour (auth tokens, notifications, background animation) lives in a small set of ES modules under `front/js/` that every page imports.

### Pages

| Route (folder) | Role |
|---|---|
| `front/index.html` | Splash screen. Checks the stored tokens, auto-refreshes them, and redirects to `authPage` or `homePage`. |
| `front/authPage/` | Login and Register. Both forms live in the same page and are toggled via CSS classes (no separate `/register` page). Also contains the **Play as Guest** entry. |
| `front/homePage/` | Main hub: game-mode cards (Local / AI / Online / Rejoin), leaderboard, global chat, and a profile **dropdown panel** in the top-right. Links to shop and rules. |
| `front/gamePage/` | The actual game: board, per-player info panels, in-game emote panel. |
| `front/profilePage/` | Profile + social hub: profile info, friends list, user search, pending friend invitations and challenges, item's inventory, and private-chat. |
| `front/shopPage/` | Lootbox shop with the opening animation and result reveal shown in a **modal**. |
| `front/rulesPage/` | Static rules page with a sticky table of contents that scroll-spies the current section. |

### Pages vs. pop-ups

Some features are separate pages, others are pop-ups/modals inside an existing page:

- **Separate pages:** authentication, home, game, profile, shop, rules.
- **Dropdown on home page:** the profile panel (`Profile`, `Logout`, `My Profile & Friends`) slides out from the profile button — no navigation.
- **Inline panel swap on profile page:** private chat with a friend opens in place of the friends list rather than routing to a new page. Inventory is also rendered directly on the profile page, not in a separate "collection" route.
- **Modals:**
  - Game page: game-over modal (replay / leave) and a reconnect overlay when the socket drops.
  - Shop page: lootbox opening modal (two phases: animation, then result).
- **Toasts (top-right overlay):** friend-request, challenge-received, incoming-private-message notifications, as well as all success/error feedback. Interactive toasts (Accept / Decline buttons, 2-minute countdown for challenges) are used instead of blocking modals for friend requests and challenges, so the user can keep browsing while they decide.

### "Components" — shared modules under `front/js/`

We did not build a component systemW. Reuse is done via **shared ES modules** that expose a small API and manipulate the DOM of whatever page imports them. They are loaded by every relevant page's `index.html`.

| Module | Purpose | Used by |
|---|---|---|
| `tokenManager.js` | Get/set/clear access + refresh tokens in `localStorage`, and transparently refresh an expired access token against `/api/refresh`. | Every authenticated page (home, game, profile, shop) + splash auto-login. |
| `profileManager.js` | Loads `/api/profile` once and caches username / ELO / coins / email in `sessionStorage`, with getters used by the UI. | Home (profile button, coin balance), profile page, game page, shop (balance chip). |
| `notificationManager.js` | Singleton class. Connects to the social socket, listens for friend / challenge / private-chat events, and renders toasts (simple and interactive). Also owns the toast container and creates it on the fly if the page didn't declare one. | Home, profile, game, shop — any page where a real-time notification can arrive. |
| `matrixBackground.js` | Initialises the animated crypto-symbol canvas background used as the site-wide visual theme. | Every page (each page declares a `<canvas id="matrixCanvas">` and calls `initMatrixBackground`). |

Shared stylesheets play the same role for CSS: `theme.css` (design tokens, buttons, glass-card look, layout primitives) and `globalNotif.css` (toast styles) are imported by every page.

The game page is further broken down into **single-responsibility modules**, each owning one concern of the game screen:

| Module | Responsibility |
|---|---|
| `gameState.js` | In-memory state shared across the game-page modules. |
| `networkManager.js` | Socket connection, `game:*` events, reconnection. |
| `boardRenderer.js` | Builds the 10×10 grid, renders pieces, highlights selection and legal moves. |
| `interactionManager.js` | Click / drag-and-drop on cells and reserve pyramids, rotation buttons. |
| `laserAnimator.js` | Animates the laser beam on an overlay canvas after each turn. |
| `offboardUI.js` | Everything outside the board: player panels, reserve, cooldowns, turn indicator, game-over modal, reconnect overlay. |
| `index.js` | Wires the modules together and handles socket events. |

### Things that *should* be components but aren't

Several UI pieces are duplicated HTML blocks across pages or built imperatively in JS. If we were to introduce a component layer later, the obvious candidates are:

- **Toast / interactive toast** — currently assembled element-by-element inside `notificationManager.js` on every call.
- **Player info card** — the opposing-player and current-player panels on the game page are near-identical markup duplicated twice.
- **User list item** — friends list, search results, pending friend invitations, sent invitations, received challenges, and sent challenges all render very similar `<li>` structures from separate code paths.
- **Inventory grid item** — one tile per owned emote / profile picture, built by hand in `profilePage.js`.
- **Game-mode / shop / rules card** — the three "glass-card + icon + label" tiles on the home page are structurally the same.
- **Piece card** on the rules page — five near-identical blocks (Sphinx / Pharaoh / Anubis / Pyramid / Scarab) with image, name, badge, description, trait list.
- **Profile button + dropdown** — present on the home page and conceptually reimplemented (with different markup) as the avatar block on the profile page.
- **Page header / back button** — every secondary page (profile, shop, rules, game) repeats the same header pattern.
- **Matrix background include** — each page's `<head>` and `<body>` repeat the `<canvas id="matrixCanvas">` + `initMatrixBackground(...)` boilerplate.
- **Modal shell** — the game-over modal and the lootbox modal share the same `.modal-overlay > .modal-content.glass-card` shape but are declared independently.
