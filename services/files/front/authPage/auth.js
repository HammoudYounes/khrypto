// Import ApiHost for Capacitor support
const { ApiHost } = await import('../js/tokenManager.js');

const getAuthApiUrl = () => {
    return `${ApiHost.getHost()}/api/auth`;
};

// DOM elements
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");

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
    alert('Forgot password functionality coming soon!');
});

// Login form submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const identifier = document.getElementById('loginIdentifier').value;
    const password = document.getElementById('loginPassword').value;

    console.log('Login attempt:', { identifier, password });

    const result = await auth("/login", { identifier, password });
    if (result && !result.error) {
        localStorage.setItem('accessToken', result.accessToken)
        localStorage.setItem('refreshToken', result.refreshToken)
        window.location.href = '../homePage/index.html';
    } else {
        alert('Login failed. Please check your credentials.');
    }
});

// Register form submission with validation
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

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

    const result = await auth("/register", { username, email, password });
    if (result && !result.error) {
        // Redirect to home page on success
        localStorage.setItem('accessToken', result.accessToken)
        localStorage.setItem('refreshToken', result.refreshToken)
        sessionStorage.setItem('username', username)
        window.location.href = '../homePage/index.html';
    } else {
        alert(`Registration failed: ${friendlyAuthError(result.message)}`);
    }
});

// Map raw backend errors ("Error 400: USERNAME ALREADY EXIST") to readable messages
function friendlyAuthError(message) {
    const m = String(message || '').replace(/ /g, '_').toUpperCase();
    if (m.includes('USERNAME_ALREADY_EXIST')) return 'this username is already taken.';
    if (m.includes('MAIL_ALREADY_EXIST')) return 'this email is already registered.';
    if (m.includes('INVALID_MAIL')) return 'invalid email format.';
    return message || 'please try again.';
}

// Auth API call
async function auth(endpoint, data) {
    try {
        const response = await fetch(getAuthApiUrl() + endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        // Error responses may be plain text ("Error 400: ..."), so don't
        // assume JSON — surface the server's actual reason to the user.
        const raw = await response.text();
        let result;
        try { result = JSON.parse(raw); } catch (e) { result = { message: raw }; }

        if (!response.ok) {
            console.log(`HTTP error! status: ${response.status}: ${raw}`);
            return { error: true, message: result.message || raw || "Request failed", status: response.status };
        }

        console.log('Success:', result);
        return result;
    } catch (error) {
        console.error('Auth Error:', error);
        return { error: true, message: "Connection failed" };
    }
}

// Guest entry
document.getElementById('guestBtn').addEventListener('click', () => {
    sessionStorage.setItem('isGuest', 'true');
    window.location.href = '../homePage/index.html';
});
