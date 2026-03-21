import { TokenManager } from "../js/tokenManager.js";
import { notificationManager } from "../js/notificationManager.js";
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

document.addEventListener('DOMContentLoaded', () => {
    initializeHome();
    notificationManager.init();
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
    emitGame("local")
})

aiButton.addEventListener('click', () => {
    sessionStorage.setItem("gameMode", "ai");
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
        onlineButton.textContent = `Searching...${rangeStr}`;
        localButton.disabled = true;
        aiButton.disabled = true;
    });

    matchmakingSocket.on('matchmaking:found', (data) => {
        console.log("[Matchmaking] Match found!", data);

        sessionStorage.setItem("gameId", data.gameId);
        sessionStorage.setItem("playerId", data.playerId.toString());
        sessionStorage.setItem("gameMode", "online");
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
    onlineButton.textContent = "Searching...";
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
    onlineButton.textContent = "Online";
    localButton.disabled = false;
    aiButton.disabled = false;
}
