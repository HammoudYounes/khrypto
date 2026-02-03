const API_URL = "http://localhost:8000/api";

// DOM elements - game buttons
const localButton = document.getElementById("localBtn");
const aiButton = document.getElementById("aiBtn");
const onlineButton = document.getElementById("onlineBtn");

// DOM elements - auth
const authBtn = document.getElementById("authBtn");
const authPanel = document.getElementById("authPanel");
const authFormsSection = document.getElementById("authFormsSection");
const profileSection = document.getElementById("profileSection");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const logoutBtn = document.getElementById("logoutBtn");

// Socket.io connection
const socket = io("http://localhost:8000", {
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

// Auth state
let isAuthenticated = false;

// Initialize UI based on auth state
function updateUIForAuthState() {
    if (isAuthenticated) {
        authBtn.textContent = "Profile";
        // Show profile section, hide auth forms
        authFormsSection.style.display = "none";
        profileSection.style.display = "block";
    } else {
        authBtn.textContent = "Login / Register";
        // Show auth forms, hide profile section
        authFormsSection.style.display = "block";
        profileSection.style.display = "none";
    }
}

// Toggle auth panel
authBtn.addEventListener('click', () => {
    // Always toggle panel regardless of auth state
    authPanel.classList.toggle('active');
});

// Logout button click
logoutBtn.addEventListener('click', () => {
    // Logout
    isAuthenticated = false;
    updateUIForAuthState();
    authPanel.classList.remove('active');
});

// Close auth panel when clicking outside
document.addEventListener('click', (e) => {
    if (!authPanel.contains(e.target) && !authBtn.contains(e.target)) {
        authPanel.classList.remove('active');
    }
});

// Switch to login form
loginBtn.addEventListener('click', () => {
    loginBtn.classList.add('active');
    registerBtn.classList.remove('active');
    loginForm.classList.add('active');
    registerForm.classList.remove('active');
});

// Switch to register form
registerBtn.addEventListener('click', () => {
    registerBtn.classList.add('active');
    loginBtn.classList.remove('active');
    registerForm.classList.add('active');
    loginForm.classList.remove('active');
});

// Forgot password button click
forgotPasswordBtn.addEventListener('click', () => {
    // TODO: Implement forgot password functionality
    console.log('Forgot password clicked');
});

// Login form submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault()

    const identifier = document.getElementById('loginIdentifier').value;
    const password = document.getElementById('loginPassword').value;

    console.log('Login attempt:', { identifier, password });

    const success = await auth("/login", { identifier, password });
    if (success) {
        isAuthenticated = true;
        updateUIForAuthState();
        authPanel.classList.remove('active');
        loginForm.reset();
    }
    else {
        alert('Login failed');
    }
});

// Register form submission with validation
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const passwordConfirm = document.getElementById('registerPasswordConfirm').value;

    // Email regex validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        alert('Please enter a valid email address');
        return;
    }

    // Password confirmation check
    if (password !== passwordConfirm) {
        alert('Passwords do not match');
        return;
    }

    console.log('Register attempt:', { username, email, password });

    const success = await auth("/register", { username, email, password });
    if (success) {
        isAuthenticated = true;
        updateUIForAuthState();
        authPanel.classList.remove('active');
        registerForm.reset();
    }
    else {
        alert('Registration failed');
    }
});

// Auth API call
async function auth(endpoint, data) {
    try {
        const response = await fetch(API_URL + endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            console.log(`HTTP error! status: ${response.status}`);
            return false;
        }

        const result = await response.json();
        console.log('Success:', result);
        return true;
    } catch (error) {
        console.log('Error:', error);
        return false;
    }
}

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

// Initialize
updateUIForAuthState();