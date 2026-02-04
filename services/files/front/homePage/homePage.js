const API_URL = "http://localhost:8000/api";

// DOM elements - game buttons
const localButton = document.getElementById("localBtn");
const aiButton = document.getElementById("aiBtn");
const onlineButton = document.getElementById("onlineBtn");

// DOM elements - profile
const profileBtn = document.getElementById("profileBtn");
const profilePanel = document.getElementById("profilePanel");
const logoutBtn = document.getElementById("logoutBtn");

// Socket.io connection
const socket = io("http://localhost:8000", {
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

// Toggle profile panel
profileBtn.addEventListener('click', () => {
    profilePanel.classList.toggle('active');
});

// Logout button click
logoutBtn.addEventListener('click', () => {
    // Clear any session data
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
    // Clear any existing gameId to avoid conflicts
    sessionStorage.removeItem("gameId");
    socket.emit("game:create", gameMode)
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
