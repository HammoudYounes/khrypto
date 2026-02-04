const AUTH_API_URL = "http://localhost:8000/api/auth";

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

    const success = await auth("/login", { identifier, password });
    if (success) {
        // Redirect to home page on success
        window.location.href = './homePage/index.html';
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

    const success = await auth("/register", { username, email, password });
    if (success) {
        // Redirect to home page on success
        window.location.href = './homePage/index.html';
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
