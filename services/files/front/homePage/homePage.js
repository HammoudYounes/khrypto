import { TokenManager, ApiHost } from "../js/tokenManager.js";
import { notificationManager } from "../js/notificationManager.js";
import { ProfileManager } from "../js/profileManager.js";
const getApiUrl = () => `${ApiHost.getHost()}/api`;

// DOM elements - game buttons
const localButton = document.getElementById("localBtn");
const aiButton = document.getElementById("aiBtn");
const onlineButton = document.getElementById("onlineBtn");
const rejoinBtn = document.getElementById("rejoinBtn");
const rejoinCountdown = document.getElementById("rejoinCountdown");

// DOM elements - profile
const profileBtn = document.getElementById("profileBtn");
const profilePanel = document.getElementById("profilePanel");
const logoutBtn = document.getElementById("logoutBtn");
const goToProfileBtn = document.getElementById("goToProfileBtn");

// DOM elements - mobile header
const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatCloseBtn = document.getElementById("chatCloseBtn");


const socket = io(ApiHost.getHost(), {
    path: '/socket.io',

    autoConnect: false, // IMPORTANT : On attend d'avoir vérifié le token
    auth: (cb) => {
        // Envoie le token stocké à chaque tentative
        cb({ token: TokenManager.getAccessToken() });
    },
    query: {
        token: TokenManager.getAccessToken()
    }
});

// Guest UI: hides features unavailable without an account
function applyGuestUI() {
    if (onlineButton) onlineButton.style.display = 'none';
    if (rejoinBtn) rejoinBtn.style.display = 'none';
    const chatSection = document.querySelector('.chat-section');
    if (chatSection) chatSection.style.display = 'none';
    if (chatToggleBtn) chatToggleBtn.style.display = 'none';
    if (goToProfileBtn) goToProfileBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.textContent = 'Exit Guest Mode';
}

// ========== REJOIN GAME ==========

function initRejoinButton() {
    if (!rejoinBtn) return; // element removed from HTML on this branch

    const activeGameId = localStorage.getItem('activeGameId');
    const expiresAt = parseInt(localStorage.getItem('activeGameExpiresAt') || '0', 10);
    const remaining = expiresAt - Date.now();

    if (!activeGameId || remaining <= 0) {
        clearRejoinState();
        return;
    }

    // Show Rejoin, hide Online
    onlineButton.style.display = 'none';
    rejoinBtn.style.display = '';

    // Live countdown
    let secondsLeft = Math.ceil(remaining / 1000);
    if (rejoinCountdown) rejoinCountdown.textContent = `${secondsLeft}s`;
    const countdownInterval = setInterval(() => {
        secondsLeft--;
        if (rejoinCountdown) rejoinCountdown.textContent = `${secondsLeft}s`;
        if (secondsLeft <= 0) {
            clearInterval(countdownInterval);
            clearRejoinState();
        }
    }, 1000);

    // Auto-hide when timer expires
    setTimeout(() => {
        clearInterval(countdownInterval);
        clearRejoinState();
    }, remaining);

    // Click → navigate to game page (gamePage auto-rejoins via socket connect handler)
    rejoinBtn.addEventListener('click', () => {
        window.location.href = '../gamePage/index.html';
    });
}

function clearRejoinState() {
    localStorage.removeItem('activeGameId');
    localStorage.removeItem('activePlayerId');
    localStorage.removeItem('activeGameExpiresAt');
    localStorage.removeItem('activeMyUsername');
    localStorage.removeItem('activeOpponentUsername');
    localStorage.removeItem('activeMyElo');
    localStorage.removeItem('activeOpponentElo');
    // Force profileManager to refetch fresh elo/coins from server on next profile visit
    sessionStorage.removeItem('elo');
    sessionStorage.removeItem('coins');
    if (rejoinBtn) rejoinBtn.style.display = 'none';
    if (onlineButton) onlineButton.style.display = '';
}

initRejoinButton();

// 3. FONCTION D'INITIALISATION (Check Session)
async function initializeHome() {
    // Guest short-circuit: skip auth, connect without token
    if (sessionStorage.getItem('isGuest') === 'true') {
        applyGuestUI();
        socket.io.opts.query = {};
        socket.connect();
        return;
    }

    let accessToken = TokenManager.getAccessToken();
    const refreshToken = TokenManager.getRefreshToken();

    // Si pas d'Access Token mais un Refresh Token -> On tente de restaurer la session
    if (!accessToken && refreshToken) {
        console.log("Session expirée, tentative de restauration...");
        const success = await TokenManager.refreshAccessToken();
        if (success) accessToken = TokenManager.getAccessToken();
    }

    // Si toujours pas de token valide -> Retour Login
    if (!accessToken) {
        console.log("Non connecté. Redirection...");
        window.location.href = '../index.html'; // Page de Login
        return;
    }

    await ProfileManager.ensureProfile();

    // Si tout est bon, on connecte le socket
    console.log("Session valide, connexion au serveur...");
    socket.io.opts.query = { token: TokenManager.getAccessToken() };
    socket.connect();
}

// 4. GESTION DES ERREURS DE CONNEXION (Ex: Token expiré pendant l'attente)
socket.on("connect_error", async (err) => {
    if (sessionStorage.getItem('isGuest') === 'true') return;
    console.log("Erreur connexion socket:", err.message);

    // Tentative de refresh automatique
    const success = await TokenManager.refreshAccessToken();

    if (success) {
        console.log("Token rafraîchi, reconnexion...");
        socket.io.opts.query = { token: TokenManager.getAccessToken() };
        socket.connect();
    } else {
        // Si le refresh échoue, on déconnecte tout
        console.log("Session impossible à récupérer.");
        TokenManager.clear();
        ProfileManager.clearProfile();
        window.location.href = '../index.html';
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    await initializeHome();

    // Populate username in profile button and panel
    const username = sessionStorage.getItem('username') || 'Guest';
    const profileUsernameEl = document.getElementById('profileUsername');
    const usernameDisplayEl = document.getElementById('usernameDisplay');
    if (profileUsernameEl) profileUsernameEl.textContent = username;
    if (usernameDisplayEl) {
        const span = usernameDisplayEl.querySelector('span');
        if (span) span.textContent = username;
    }

    // Show shop button, load balance/avatar, and init social socket for logged-in users
    if (sessionStorage.getItem('isGuest') !== 'true') {
        const shopNavBtn = document.getElementById('shopNavBtn');
        if (shopNavBtn) shopNavBtn.style.display = 'flex';
        fetchAndDisplayBalance();
        fetchAndDisplayAvatar();
        // Init social socket here so auth is guaranteed ready (no timing race)
        if (TokenManager.getAccessToken()) {
            initSocialSocket();
        }
    }

    loadLeaderboard();
});

async function fetchAndDisplayAvatar() {
    try {
        const username = sessionStorage.getItem('username');
        if (!username) return;
        const res = await fetch(`${ApiHost.getHost()}/api/market/avatar/${encodeURIComponent(username)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.assetPath) {
            const img = document.getElementById('navAvatarImg');
            if (img) {
                img.src = `${ApiHost.getHost()}/api/market/${data.assetPath}`;
                img.classList.add('loaded');
            }
        }
    } catch (err) {
        console.error('Failed to fetch avatar:', err);
    }
}

async function fetchAndDisplayBalance() {
    try {
        const token = TokenManager.getAccessToken();
        if (!token) return;
        const res = await fetch(`${ApiHost.getHost()}/api/market/balance`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        // Header button coin display
        const el = document.getElementById('navCoinBalance');
        if (el) el.textContent = data.coins;
        const sep = document.getElementById('profileCoinSep');
        const wrap = document.getElementById('profileCoinWrap');
        if (sep) sep.style.display = 'inline';
        if (wrap) wrap.style.display = 'flex';
        // Profile panel balance
        const panelCoinBalance = document.getElementById('panelCoinBalance');
        const panelBalanceRow = document.getElementById('panelBalanceRow');
        if (panelCoinBalance) panelCoinBalance.textContent = data.coins;
        if (panelBalanceRow) panelBalanceRow.style.display = 'flex';
        sessionStorage.setItem('coins', data.coins);
    } catch (err) {
        console.error('Failed to fetch balance:', err);
    }
}

async function loadLeaderboard() {
    const list = document.getElementById('leaderboardList');
    if (!list) return;
    try {
        const res = await fetch(`${ApiHost.getHost()}/api/leaderboard?limit=10`);
        if (!res.ok) return;
        const { leaderboard } = await res.json();

        list.innerHTML = '';
        leaderboard.forEach((user, index) => {
            const rank = index + 1;
            const li = document.createElement('li');
            li.className = `leaderboard-row rank-${rank}`;
            li.innerHTML = `
                <span class="lb-rank">#${rank}</span>
                <div class="lb-avatar">
                    <img class="lb-avatar-img" alt="" />
                    <span class="lb-avatar-fallback">⬡</span>
                </div>
                <span class="lb-username">${user.username}</span>
                <span class="lb-elo">${user.elo} ELO</span>
                <span class="lb-coins">◈ ${user.coins}</span>
            `;
            list.appendChild(li);

            const img = li.querySelector('.lb-avatar-img');
            fetch(`${ApiHost.getHost()}/api/market/avatar/${encodeURIComponent(user.username)}`)
                .then(r => r.json())
                .then(data => {
                    if (data.assetPath) {
                        img.src = `${ApiHost.getHost()}/api/market/${data.assetPath}`;
                        img.classList.add('loaded');
                    }
                })
                .catch(() => {});
        });
    } catch (e) {
        console.error('[Leaderboard] Failed to load', e);
    }
}

// Toggle profile panel
profileBtn.addEventListener('click', () => {
    profilePanel.classList.toggle('active');
    // Close chat overlay when opening profile
    const chatSection = document.querySelector('.chat-section');
    if (chatSection) chatSection.classList.remove('chat-open');
    if (chatToggleBtn) chatToggleBtn.classList.remove('chat-active');
});

// Chat toggle button (mobile)
if (chatToggleBtn) {
    chatToggleBtn.addEventListener('click', () => {
        const chatSection = document.querySelector('.chat-section');
        if (!chatSection) return;
        const isOpen = chatSection.classList.toggle('chat-open');
        chatToggleBtn.classList.toggle('chat-active', isOpen);
        // Close profile panel when opening chat
        if (isOpen) profilePanel.classList.remove('active');
    });
}

// Chat close button (mobile)
if (chatCloseBtn) {
    chatCloseBtn.addEventListener('click', () => {
        const chatSection = document.querySelector('.chat-section');
        if (chatSection) chatSection.classList.remove('chat-open');
        if (chatToggleBtn) chatToggleBtn.classList.remove('chat-active');
    });
}

// Logout button click
logoutBtn.addEventListener('click', () => {
    TokenManager.clear();
    ProfileManager.clearProfile();
    sessionStorage.clear();
    localStorage.removeItem('activeGameId');
    localStorage.removeItem('activePlayerId');
    localStorage.removeItem('activeGameExpiresAt');
    localStorage.removeItem('activeMyUsername');
    localStorage.removeItem('activeOpponentUsername');
    localStorage.removeItem('activeMyElo');
    localStorage.removeItem('activeOpponentElo');
    window.location.href = '../index.html';
});

// Navigate to Profile Page
if (goToProfileBtn) {
    goToProfileBtn.addEventListener('click', () => {
        window.location.href = '../profilePage/index.html';
    });
}

// Close panels when clicking outside
document.addEventListener('click', (e) => {
    if (!profilePanel.contains(e.target) && !profileBtn.contains(e.target)) {
        profilePanel.classList.remove('active');
    }
    const chatSection = document.querySelector('.chat-section');
    if (chatSection && chatToggleBtn &&
        !chatSection.contains(e.target) && !chatToggleBtn.contains(e.target)) {
        chatSection.classList.remove('chat-open');
        chatToggleBtn.classList.remove('chat-active');
    }
});

// Game mode functions
function emitGame(gameMode) {
    if (!socket.connected) {
        console.warn("Waiting for server conncection...");
        return;
    }

    // Clear any stale game session data before starting a new game
    sessionStorage.removeItem("gameId");
    sessionStorage.removeItem("playerId");
    sessionStorage.removeItem("gameMode");
    sessionStorage.removeItem("myUsername");
    sessionStorage.removeItem("opponentUsername");
    sessionStorage.removeItem("myElo");
    sessionStorage.removeItem("opponentElo");
    socket.emit("game:create", gameMode);
}

localButton.addEventListener('click', () => {
    sessionStorage.setItem("gameMode", "local");
    sessionStorage.setItem("isRanked", "false");
    emitGame("local")
})

aiButton.addEventListener('click', () => {
    showAiDifficultyPicker();
})

// ========== AI DIFFICULTY PICKER ==========

function showAiDifficultyPicker() {
    if (document.getElementById('ai-difficulty-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'ai-difficulty-overlay';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.65)',
        'display:flex', 'flex-direction:column', 'align-items:center',
        'justify-content:center', 'z-index:9999', 'gap:0.8rem'
    ].join(';');

    const title = document.createElement('p');
    title.textContent = '🤖 Choose difficulty';
    title.style.cssText = 'color:white;font-size:1.4rem;font-weight:bold;margin-bottom:0.4rem;';
    overlay.appendChild(title);

    const tiers = [
        { id: 'easy',   label: '🟢 Easy' },
        { id: 'medium', label: '🟡 Medium' },
        { id: 'hard',   label: '🔴 Hard' }
    ];

    for (const tier of tiers) {
        const btn = document.createElement('button');
        btn.textContent = tier.label;
        btn.className = 'mode-card glass-card';
        btn.style.cssText = 'min-width:200px;padding:0.8rem 1.5rem;font-size:1.1rem;cursor:pointer;';
        btn.addEventListener('click', () => {
            overlay.remove();
            sessionStorage.setItem("gameMode", "ai");
            sessionStorage.setItem("isRanked", "false");
            sessionStorage.setItem("aiDifficulty", tier.id);
            emitGame({ mode: "ai", difficulty: tier.id });
        });
        overlay.appendChild(btn);
    }

    // Click outside the buttons to cancel
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}

socket.on("game:created", (data) => {
    console.log("Game created with ID:", data.gameId);

    sessionStorage.setItem("gameId", data.gameId);

    window.location.href = '../gamePage/index.html';
});

// ========== ONLINE & WAGER MATCHMAKING ==========

let matchmakingSocket = null;
let activeSearchButton = null;

const wagerButton = document.getElementById("wagerBtn");
const WAGER_TIERS = [0.01, 0.1, 0.5, 1, 5];

onlineButton.addEventListener('click', () => {
    if (matchmakingSocket && matchmakingSocket.connected) {
        cancelMatchmaking();
        return;
    }
    startMatchmaking(null, onlineButton);
});

if (wagerButton) {
    wagerButton.addEventListener('click', async () => {
        if (matchmakingSocket && matchmakingSocket.connected) {
            cancelMatchmaking();
            return;
        }
        // Wagering requires a linked wallet — check before queueing
        try {
            const res = await fetch(`${ApiHost.getHost()}/api/profile`, {
                headers: { 'Authorization': `Bearer ${TokenManager.getAccessToken()}` }
            });
            const profile = await res.json();
            if (!profile.walletAddress) {
                alert('Link your Phantom wallet on the profile page before wagering.');
                return;
            }
        } catch (e) {
            alert('Could not verify your wallet link. Try again.');
            return;
        }
        showWagerTierPicker();
    });

    // Reveal the wager card only when escrow is configured (and not a guest)
    if (sessionStorage.getItem('isGuest') !== 'true' && TokenManager.getAccessToken()) {
        fetch(`${ApiHost.getHost()}/api/escrow/status`, {
            headers: { 'Authorization': `Bearer ${TokenManager.getAccessToken()}` }
        }).then(r => r.json())
          .then(s => { if (s.enabled) wagerButton.style.display = ''; })
          .catch(() => {});
    }
}

function showWagerTierPicker() {
    if (document.getElementById('wager-tier-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'wager-tier-overlay';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.65)',
        'display:flex', 'flex-direction:column', 'align-items:center',
        'justify-content:center', 'z-index:9999', 'gap:0.7rem'
    ].join(';');

    const title = document.createElement('p');
    title.textContent = '💰 Choose your stake (devnet SOL)';
    title.style.cssText = 'color:white;font-size:1.3rem;font-weight:bold;margin-bottom:0.4rem;';
    overlay.appendChild(title);

    for (const tier of WAGER_TIERS) {
        const btn = document.createElement('button');
        btn.textContent = `◎ ${tier} SOL`;
        btn.className = 'mode-card glass-card';
        btn.style.cssText = 'min-width:200px;padding:0.7rem 1.5rem;font-size:1.1rem;cursor:pointer;';
        btn.addEventListener('click', () => {
            overlay.remove();
            startMatchmaking(tier, wagerButton);
        });
        overlay.appendChild(btn);
    }

    const hint = document.createElement('p');
    hint.textContent = 'You only match opponents wagering the same amount. Winner takes the pot.';
    hint.style.cssText = 'color:#aaa;font-size:0.85rem;max-width:320px;text-align:center;';
    overlay.appendChild(hint);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

function startMatchmaking(wagerTier, triggerButton) {
    activeSearchButton = triggerButton;

    // Connect to the matchmaking service via its own Socket.IO path
    matchmakingSocket = io(ApiHost.getHost(), {
        path: '/matchmaking/socket.io',
        autoConnect: false,
        auth: (cb) => {
            cb({ token: TokenManager.getAccessToken() });
        },
        query: {
            token: TokenManager.getAccessToken()
        }
    });

    // Wire up matchmaking events
    matchmakingSocket.on('connect', () => {
        console.log("[Matchmaking] Connected, joining queue...");
        const username = sessionStorage.getItem('username') || 'Player';
        matchmakingSocket.emit('matchmaking:join',
            wagerTier ? { username, mode: 'wager', stakeSol: wagerTier } : { username });
    });

    matchmakingSocket.on('matchmaking:waiting', (data) => {
        console.log("[Matchmaking] Waiting for an opponent...");
        const rangeStr = data && data.eloRange ? ` (+/- ${data.eloRange})` : '';
        const label = activeSearchButton.querySelector('.mode-label');
        if (label) label.textContent = `Searching...${rangeStr}`;
        setModeButtonsDisabled(true);
    });

    matchmakingSocket.on('matchmaking:found', (data) => {
        console.log("[Matchmaking] Match found!", data);
        removeDepositOverlay();

        sessionStorage.setItem("gameId", data.gameId);
        sessionStorage.setItem("playerId", data.playerId.toString());
        sessionStorage.setItem("gameMode", "online");
        sessionStorage.setItem("isRanked", "true");
        sessionStorage.setItem("myUsername", data.myUsername || 'Player');
        sessionStorage.setItem("opponentUsername", data.opponentUsername || 'Opponent');
        if (data.myElo) sessionStorage.setItem("myElo", data.myElo.toString());
        if (data.opponentElo) sessionStorage.setItem("opponentElo", data.opponentElo.toString());

        // Wager games carry a fixed stake; the game page shows the escrow panel
        if (data.mode === 'wager' && data.stakeSol) {
            sessionStorage.setItem("wagerStake", data.stakeSol.toString());
            localStorage.setItem("activeWagerStake", data.stakeSol.toString());
        } else {
            sessionStorage.removeItem("wagerStake");
            localStorage.removeItem("activeWagerStake");
        }

        // Clean up matchmaking socket before navigating
        matchmakingSocket.disconnect();
        matchmakingSocket = null;

        window.location.href = '../gamePage/index.html';
    });

    matchmakingSocket.on('matchmaking:error', (data) => {
        console.error("[Matchmaking] Error:", data.message);
        // Hard rejections (wallet not linked, bad tier) end the search
        if (data.message && /wallet|tier/i.test(data.message)) {
            alert(data.message);
            cancelMatchmaking();
        }
        // Otherwise stay in queue — the server re-queued us
    });

    // Wager staking gate: both players must lock their stake before the
    // game starts. The server sends deposit_required, tracks progress,
    // and only emits matchmaking:found once both deposits confirm.
    matchmakingSocket.on('matchmaking:deposit_required', (data) => {
        showDepositOverlay(data);
    });

    matchmakingSocket.on('matchmaking:deposit_status', (data) => {
        updateDepositOverlay(data);
    });

    matchmakingSocket.on('matchmaking:wager_aborted', (data) => {
        removeDepositOverlay();
        alert(data.message || 'Wager cancelled — stakes refunded.');
        cancelMatchmaking();
    });

    matchmakingSocket.on('connect_error', async (err) => {
        console.error("[Matchmaking] Connection error:", err.message);

        const success = await TokenManager.refreshAccessToken();
        if (success) {
            matchmakingSocket.io.opts.query = { token: TokenManager.getAccessToken() };
            matchmakingSocket.connect();
        } else {
            cancelMatchmaking();
        }
    });

    // Show searching state & connect
    const label = activeSearchButton.querySelector('.mode-label');
    if (label) label.textContent = "Searching...";
    setModeButtonsDisabled(true);

    matchmakingSocket.io.opts.query = { token: TokenManager.getAccessToken() };
    matchmakingSocket.connect();
}

function setModeButtonsDisabled(disabled) {
    localButton.disabled = disabled;
    aiButton.disabled = disabled;
    // The searching button itself stays clickable so it can act as Cancel
    if (activeSearchButton !== onlineButton) onlineButton.disabled = disabled;
    if (wagerButton && activeSearchButton !== wagerButton) wagerButton.disabled = disabled;
}

// ========== PRE-GAME STAKE DEPOSIT OVERLAY ==========

let depositCountdownTimer = null;

function showDepositOverlay({ gameId, stakeSol, deadlineAt, opponentUsername }) {
    removeDepositOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'deposit-overlay';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.8)',
        'display:flex', 'flex-direction:column', 'align-items:center',
        'justify-content:center', 'z-index:9999', 'gap:0.8rem', 'color:white', 'text-align:center'
    ].join(';');

    overlay.innerHTML = `
        <p style="font-size:1.4rem;font-weight:bold;color:#c9a227;">💰 Opponent found: ${opponentUsername}</p>
        <p>Stake <b>◎ ${stakeSol} SOL</b> to start the match — winner takes <b>◎ ${(stakeSol * 2).toFixed(3)}</b></p>
        <p id="depositBalance" style="color:#888;font-size:0.85rem;margin:0;"></p>
        <p id="depositCountdown" style="font-size:1.6rem;font-weight:bold;"></p>
        <button id="depositNowBtn" class="mode-card glass-card" style="min-width:220px;padding:0.8rem 1.5rem;font-size:1.1rem;cursor:pointer;">Deposit stake</button>
        <p id="depositState" style="color:#ccc;font-size:0.95rem;">Waiting for deposits…</p>
        <button id="depositCancelBtn" style="background:none;border:1px solid #666;color:#aaa;border-radius:8px;padding:6px 16px;cursor:pointer;">Cancel (refunds stakes)</button>
    `;
    document.body.appendChild(overlay);

    // Show the player's devnet balance and warn early about insufficient
    // funds (deposits also need ~0.001 SOL headroom for fees + rent floor)
    (async () => {
        try {
            const provider = window.solana;
            if (!provider || typeof solanaWeb3 === 'undefined') return;
            const conn = await provider.connect({ onlyIfTrusted: true }).catch(() => provider.connect());
            const rpc = new solanaWeb3.Connection('https://api.devnet.solana.com', 'confirmed');
            const balance = await rpc.getBalance(conn.publicKey) / 1e9;
            const balEl = overlay.querySelector('#depositBalance');
            if (!balEl) return;
            const needed = stakeSol + 0.001;
            if (balance < needed) {
                balEl.textContent = `⚠ Wallet balance ◎ ${balance.toFixed(4)} — you need at least ◎ ${needed.toFixed(3)} (stake + fees). Top up or cancel.`;
                balEl.style.color = '#e74c3c';
            } else {
                balEl.textContent = `Wallet balance: ◎ ${balance.toFixed(4)} (devnet)`;
            }
        } catch (e) { /* balance display is best-effort */ }
    })();

    const countdownEl = overlay.querySelector('#depositCountdown');
    depositCountdownTimer = setInterval(() => {
        const left = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
        countdownEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        countdownEl.style.color = left <= 20 ? '#e74c3c' : 'white';
        if (left <= 0) clearInterval(depositCountdownTimer);
    }, 500);

    overlay.querySelector('#depositCancelBtn').addEventListener('click', () => {
        removeDepositOverlay();
        cancelMatchmaking();
    });

    overlay.querySelector('#depositNowBtn').addEventListener('click', async () => {
        const stateEl = overlay.querySelector('#depositState');
        const btn = overlay.querySelector('#depositNowBtn');
        const provider = window.solana;
        if (!provider || !provider.isPhantom) { stateEl.textContent = 'Phantom extension not found'; return; }
        if (typeof solanaWeb3 === 'undefined') { stateEl.textContent = 'Solana web3 library failed to load'; return; }
        btn.disabled = true;
        try {
            stateEl.textContent = 'Building transaction…';
            const res = await fetch(`${ApiHost.getHost()}/api/escrow/deposit-tx`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TokenManager.getAccessToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId })
            });
            const body = await res.json();
            if (!res.ok) { stateEl.textContent = body.error || 'Failed to build deposit'; btn.disabled = false; return; }

            await provider.connect();
            const tx = solanaWeb3.Transaction.from(Uint8Array.from(atob(body.transaction), c => c.charCodeAt(0)));
            stateEl.textContent = 'Confirm in Phantom…';
            const { signature } = await provider.signAndSendTransaction(tx);
            stateEl.textContent = `Deposit sent (${signature.slice(0, 8)}…) — waiting for confirmation`;
        } catch (e) {
            console.error('Deposit error:', e);
            stateEl.textContent = e.code === 4001 ? 'Deposit cancelled — try again' : 'Deposit failed — try again';
            btn.disabled = false;
        }
    });
}

function updateDepositOverlay({ you, opponent }) {
    const overlay = document.getElementById('deposit-overlay');
    if (!overlay) return;
    const stateEl = overlay.querySelector('#depositState');
    const btn = overlay.querySelector('#depositNowBtn');
    if (you) {
        btn.style.display = 'none';
        stateEl.textContent = opponent ? 'Both stakes locked — starting…' : 'Stake locked ✓ waiting for opponent…';
        stateEl.style.color = opponent ? '#2ecc71' : '#f1c40f';
    } else if (opponent) {
        stateEl.textContent = 'Opponent already staked — your turn!';
        stateEl.style.color = '#f1c40f';
    }
}

function removeDepositOverlay() {
    if (depositCountdownTimer) clearInterval(depositCountdownTimer);
    const overlay = document.getElementById('deposit-overlay');
    if (overlay) overlay.remove();
}

function cancelMatchmaking() {
    removeDepositOverlay();
    if (matchmakingSocket) {
        matchmakingSocket.emit('matchmaking:cancel');
        matchmakingSocket.disconnect();
        matchmakingSocket = null;
    }
    const onlineLabel = onlineButton.querySelector('.mode-label');
    if (onlineLabel) onlineLabel.textContent = "Online";
    if (wagerButton) {
        const wagerLabel = wagerButton.querySelector('.mode-label');
        if (wagerLabel) wagerLabel.textContent = "Wager";
    }
    activeSearchButton = null;
    localButton.disabled = false;
    aiButton.disabled = false;
    onlineButton.disabled = false;
    if (wagerButton) wagerButton.disabled = false;
}

// ========== GLOBAL CHAT ==========

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatEmpty = document.getElementById('chatEmpty');
const chatLoading = document.getElementById('chatLoading');

let socialSocket = null;
let chatOffset = 0;
let chatAllLoaded = false;
let chatFetching = false;

function initSocialSocket() {
    socialSocket = io(ApiHost.getHost(), {
        path: '/social/socket.io',
        autoConnect: false,
        query: { token: TokenManager.getAccessToken() }
    });

    socialSocket.on('connect', () => {
        console.log('[Social] Connected to social broker');
        // Initialize notification manager with this socket to avoid duplicate connections
        notificationManager.init(socialSocket);
        // Fetch initial messages
        fetchChatMessages();
    });

    socialSocket.on('global-chat:receive', (msg) => {
        // Check if we should auto-scroll (user is at the bottom)
        const isAtBottom = chatMessages.scrollTop + chatMessages.clientHeight >= chatMessages.scrollHeight - 30;

        appendMessage(msg);

        if (isAtBottom) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    });

    socialSocket.on('connect_error', async (err) => {
        console.error('[Social] Connection error:', err.message);
        const success = await TokenManager.refreshAccessToken();
        if (success) {
            socialSocket.io.opts.query = { token: TokenManager.getAccessToken() };
            socialSocket.connect();
        }
    });

    socialSocket.io.opts.query = { token: TokenManager.getAccessToken() };
    socialSocket.connect();
}

async function fetchChatMessages() {
    if (chatFetching || chatAllLoaded) return;
    chatFetching = true;
    chatLoading.style.display = 'block';

    try {
        const token = TokenManager.getAccessToken();
        const res = await fetch(`${ApiHost.getHost()}/api/chat/global?limit=15&offset=${chatOffset}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            // Try refresh if 401
            if (res.status === 401) {
                const refreshed = await TokenManager.refreshAccessToken();
                if (refreshed) {
                    chatFetching = false;
                    chatLoading.style.display = 'none';
                    return fetchChatMessages();
                }
            }
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const messages = data.messages || [];

        if (messages.length < 15) {
            chatAllLoaded = true;
        }

        if (messages.length > 0 || chatOffset > 0) {
            chatEmpty.style.display = 'none';
        }

        // Prepend older messages at the top (messages array is chronological)
        const prevScrollHeight = chatMessages.scrollHeight;

        // Iterate in reverse so oldest messages end up at the top
        for (let i = messages.length - 1; i >= 0; i--) {
            prependMessage(messages[i]);
        }

        chatOffset += messages.length;

        // Restore scroll position so it doesn't jump
        if (chatOffset > 15) {
            // Only restore for pagination loads (not initial)
            chatMessages.scrollTop = chatMessages.scrollHeight - prevScrollHeight;
        } else {
            // Initial load: scroll to bottom
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    } catch (err) {
        console.error('[Chat] Error fetching messages:', err);
    } finally {
        chatFetching = false;
        chatLoading.style.display = 'none';
    }
}

function createMessageElement(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    if (msg.senderUsername === sessionStorage.getItem('username')) {
        div.classList.add('chat-msg-own');
    }

    const sender = document.createElement('div');
    sender.className = 'chat-msg-sender';
    sender.textContent = msg.senderUsername;

    const content = document.createElement('div');
    content.className = 'chat-msg-content';
    content.textContent = msg.content;

    const time = document.createElement('div');
    time.className = 'chat-msg-time';
    const date = new Date(msg.createdAt);
    time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.appendChild(sender);
    div.appendChild(content);
    div.appendChild(time);
    return div;
}

function appendMessage(msg) {
    chatEmpty.style.display = 'none';
    const el = createMessageElement(msg);
    chatMessages.appendChild(el);
}

function prependMessage(msg) {
    const el = createMessageElement(msg);
    // Insert after the loading indicator
    chatLoading.insertAdjacentElement('afterend', el);
}

// Send message
function sendChatMessage() {
    const content = chatInput.value.trim();
    if (!content || !socialSocket || !socialSocket.connected) return;

    socialSocket.emit('global-chat:send', { content });
    chatInput.value = '';
}

chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendChatMessage();
    }
});

// Scroll pagination — load older messages when scrolled to top
chatMessages.addEventListener('scroll', () => {
    if (chatMessages.scrollTop === 0 && !chatFetching && !chatAllLoaded) {
        fetchChatMessages();
    }
});

