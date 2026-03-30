import { TokenManager } from "../js/tokenManager.js";
import { notificationManager } from "../js/notificationManager.js";
import { ProfileManager } from "../js/profileManager.js";
const API_URL = "/api";

// DOM elements - game buttons
const localButton = document.getElementById("localBtn");
const aiButton = document.getElementById("aiBtn");
const onlineButton = document.getElementById("onlineBtn");

// DOM elements - profile
const profileBtn = document.getElementById("profileBtn");
const profilePanel = document.getElementById("profilePanel");
const logoutBtn = document.getElementById("logoutBtn");
const goToProfileBtn = document.getElementById("goToProfileBtn");


const socket = io({
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

// 3. FONCTION D'INITIALISATION (Check Session)
async function initializeHome() {
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
});

// Toggle profile panel
profileBtn.addEventListener('click', () => {
    profilePanel.classList.toggle('active');
});

// Logout button click
logoutBtn.addEventListener('click', () => {
    TokenManager.clear();
    sessionStorage.clear();
    // Redirect to auth page
    window.location.href = '../index.html';
});

// Navigate to Profile Page
if (goToProfileBtn) {
    goToProfileBtn.addEventListener('click', () => {
        window.location.href = '../profilePage/index.html';
    });
}

// Close profile panel when clicking outside
document.addEventListener('click', (e) => {
    if (!profilePanel.contains(e.target) && !profileBtn.contains(e.target)) {
        profilePanel.classList.remove('active');
    }
});

// Game mode functions
function emitGame(gameMode) {
    if (!socket.connected) {
        console.warn("Waiting for server conncection...");
        return;
    }

    // Clear any existing gameId to avoid conflicts
    sessionStorage.removeItem("gameId");
    sessionStorage.removeItem("playerId");
    sessionStorage.removeItem("gameMode");
    socket.emit("game:create", gameMode);
}

localButton.addEventListener('click', () => {
    sessionStorage.setItem("gameMode", "local");
    sessionStorage.setItem("isRanked", "false");
    emitGame("local")
})

aiButton.addEventListener('click', () => {
    sessionStorage.setItem("gameMode", "ai");
    sessionStorage.setItem("isRanked", "false");
    emitGame("ai")
})

socket.on("game:created", (data) => {
    console.log("Game created with ID:", data.gameId);

    sessionStorage.setItem("gameId", data.gameId);

    window.location.href = '../gamePage/index.html';
});

// ========== ONLINE MATCHMAKING ==========

let matchmakingSocket = null;

onlineButton.addEventListener('click', () => {
    if (matchmakingSocket && matchmakingSocket.connected) {
        // Already searching — treat as cancel
        cancelMatchmaking();
        return;
    }

    // Connect to the matchmaking service via its own Socket.IO path
    matchmakingSocket = io({
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
        matchmakingSocket.emit('matchmaking:join', { username });
    });

    matchmakingSocket.on('matchmaking:waiting', (data) => {
        console.log("[Matchmaking] Waiting for an opponent...");
        const rangeStr = data && data.eloRange ? ` (+/- ${data.eloRange})` : '';
        const label = onlineButton.querySelector('.mode-label');
        if (label) label.textContent = `Searching...${rangeStr}`;
        localButton.disabled = true;
        aiButton.disabled = true;
    });

    matchmakingSocket.on('matchmaking:found', (data) => {
        console.log("[Matchmaking] Match found!", data);

        sessionStorage.setItem("gameId", data.gameId);
        sessionStorage.setItem("playerId", data.playerId.toString());
        sessionStorage.setItem("gameMode", "online");
        sessionStorage.setItem("isRanked", "true");
        sessionStorage.setItem("myUsername", data.myUsername || 'Player');
        sessionStorage.setItem("opponentUsername", data.opponentUsername || 'Opponent');
        if (data.myElo) sessionStorage.setItem("myElo", data.myElo.toString());
        if (data.opponentElo) sessionStorage.setItem("opponentElo", data.opponentElo.toString());

        // Clean up matchmaking socket before navigating
        matchmakingSocket.disconnect();
        matchmakingSocket = null;

        window.location.href = '../gamePage/index.html';
    });

    matchmakingSocket.on('matchmaking:error', (data) => {
        console.error("[Matchmaking] Error:", data.message);
        // Stay in queue — the server re-queued us
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
    const label = onlineButton.querySelector('.mode-label');
    if (label) label.textContent = "Searching...";
    localButton.disabled = true;
    aiButton.disabled = true;

    matchmakingSocket.io.opts.query = { token: TokenManager.getAccessToken() };
    matchmakingSocket.connect();
});

function cancelMatchmaking() {
    if (matchmakingSocket) {
        matchmakingSocket.emit('matchmaking:cancel');
        matchmakingSocket.disconnect();
        matchmakingSocket = null;
    }
    const label = onlineButton.querySelector('.mode-label');
    if (label) label.textContent = "Online";
    localButton.disabled = false;
    aiButton.disabled = false;
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
    socialSocket = io({
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
        const res = await fetch(`/api/chat/global?limit=15&offset=${chatOffset}`, {
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

// Initialize social socket when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure auth is ready
    setTimeout(() => {
        if (TokenManager.getAccessToken()) {
            initSocialSocket();
        }
    }, 500);
});
