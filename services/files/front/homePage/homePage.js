import { TokenManager } from "../js/tokenManager.js";
const API_URL = "http://localhost:8000/api";

// DOM elements - game buttons
const localButton = document.getElementById("localBtn");
const aiButton = document.getElementById("aiBtn");
const onlineButton = document.getElementById("onlineBtn");

// DOM elements - profile
const profileBtn = document.getElementById("profileBtn");
const profilePanel = document.getElementById("profilePanel");
const logoutBtn = document.getElementById("logoutBtn");
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
    socket.emit("game:create", gameMode);
}

localButton.addEventListener('click', () => {
    emitGame("local")
})

aiButton.addEventListener('click', () => {
    emitGame("ai")
})

onlineButton.addEventListener('click', () => {
    emitGame("online")
})

socket.on("game:created", (data) => {
    console.log("Game created with ID:", data.gameId);

    sessionStorage.setItem("gameId", data.gameId);

    window.location.href = '../gamePage/index.html';
});
