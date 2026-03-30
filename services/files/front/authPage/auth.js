const AUTH_API_URL = "/api/auth";

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
        alert('Registration failed. Please try again.');
    }
});

// Auth API call
async function auth(endpoint, data) {
    try {
        const response = await fetch(AUTH_API_URL + endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!response.ok) {
            console.log(`HTTP error! status: ${response.status}`);
            return { error: true, message: result.message || "Request failed", status: response.status };
        }

        console.log('Success:', result);
        return result;
    } catch (error) {
        console.error('Auth Error:', error);
        return { error: true, message: "Connection failed" };
    }
}
