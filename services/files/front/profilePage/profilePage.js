import { TokenManager } from "../js/tokenManager.js";

// DOM Elements
const backBtn = document.getElementById('backBtn');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const pendingList = document.getElementById('pendingList');
const friendsList = document.getElementById('friendsList');
const toastContainer = document.getElementById('toastContainer');

let friendSocket = null;

// Initialize Page
document.addEventListener('DOMContentLoaded', async () => {
    let token = TokenManager.getAccessToken();
    if (!token) {
        const success = await TokenManager.refreshAccessToken();
        if (!success) window.location.href = '../index.html';
        token = TokenManager.getAccessToken();
    }

    initWebSocket(token);
    loadPendingInvitations(token);
    loadFriendsList(token);
});

// Back Navigation
backBtn.addEventListener('click', () => {
    window.location.href = '../homePage/index.html';
});

// ==========================================
// WEBSOCKET INTEGRATION
// ==========================================
function initWebSocket(token) {
    friendSocket = io({
        path: '/social/socket.io',
        auth: { token },
        query: { token }
    });

    friendSocket.on('connect', () => console.log("[Friends] Connected to broker"));

    // Real-time Event: Received a new friend invitation
    friendSocket.on('friend:invitation', (payload) => {
        showToast(`New friend request from ${payload.senderUsername || 'someone'}!`, 'info');
        loadPendingInvitations(TokenManager.getAccessToken());
    });

    // Real-time Event: Someone accepted your invitation
    friendSocket.on('friend:accepted', (payload) => {
        showToast(`${payload.senderUsername || 'A user'} accepted your friend request!`, 'success');
        loadFriendsList(TokenManager.getAccessToken());
    });

    friendSocket.on('friend:declined', (payload) => {
        showToast(`${payload.senderUsername || 'A user'} declined your friend request!`, 'error');
        loadFriendsList(TokenManager.getAccessToken());
    });

    friendSocket.on('connect_error', (err) => {
        console.error("[Friends] WebSocket Error:", err.message);
    });
}

// ==========================================
// REST API INTEGRATION
// ==========================================

// 1. Search Users with Autocomplete
let searchTimeout = null;
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    
    if (query.length < 2) {
        searchResults.innerHTML = '';
        return;
    }

    // Debounce search
    searchTimeout = setTimeout(async () => {
        try {
            const token = TokenManager.getAccessToken();
            const res = await fetch(`/api/friend/search?username=${encodeURIComponent(query)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error("Search failed");
            
        const data = await res.json();
        renderSearchResults(data.users);
        } catch (err) {
            console.error(err);
        }
    }, 300);
});

function renderSearchResults(users) {
    searchResults.innerHTML = '';
    if (users.length === 0) {
        searchResults.innerHTML = '<li class="empty-msg">No users found.</li>';
        return;
    }

    users.forEach(user => {
        const li = document.createElement('li');
        li.textContent = user.username;
        
        const inviteBtn = document.createElement('button');
        inviteBtn.textContent = 'Send Invite';
        inviteBtn.className = 'btn-invite';
        inviteBtn.onclick = () => sendInvitation(user.username);

        li.appendChild(inviteBtn);
        searchResults.appendChild(li);
    });
}

// 2. Send Invitation
async function sendInvitation(username) {
    try {
        console.log(username)
        const token = TokenManager.getAccessToken();
        const res = await fetch('/api/friend/invite', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username }) 
        });

        const data = await res.json();
        if (!res.ok) {
            // Handle User Not Found, Duplicate, Self-invite
            throw new Error(data.message || "Failed to send invitation.");
        }
        showToast(`Invitation sent to ${username}!`, 'success');
        searchInput.value = '';
        searchResults.innerHTML = '';
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// 3. Load Pending Invitations
async function loadPendingInvitations(token) {
    try {
        const res = await fetch('/api/friend/pending', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Could not load pending invites.");
        const data = await res.json();
        renderPending(data.pending);
    } catch (err) {
        console.error(err);
    }
}

function renderPending(invites) {
    pendingList.innerHTML = '';
    if (!invites || invites.length === 0) {
        pendingList.innerHTML = '<li class="empty-msg">No pending invitations.</li>';
        return;
    }

    invites.forEach(invite => {
        const li = document.createElement('li');
        // Fallbacks based on common API payloads
        const senderName = invite.requesterUsername || 'Unknown User';
        li.textContent = senderName;

        const btnGroup = document.createElement('div');
        
        const acceptBtn = document.createElement('button');
        acceptBtn.textContent = 'Accept';
        acceptBtn.className = 'btn-accept';
        acceptBtn.onclick = () => respondToInvite(invite.friendshipId, true);

        const declineBtn = document.createElement('button');
        declineBtn.textContent = 'Decline';
        declineBtn.className = 'btn-decline';
        declineBtn.onclick = () => respondToInvite(invite.friendshipId , false);

        btnGroup.appendChild(acceptBtn);
        btnGroup.appendChild(declineBtn);
        li.appendChild(btnGroup);
        pendingList.appendChild(li);
    });
}

// 4. Respond to Invitation
async function respondToInvite(friendshipId, accept) {
    try {
        const token = TokenManager.getAccessToken();
        const res = await fetch('/api/friend/respond', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendshipId, action : accept ? "accept" : "decline" })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.message || "Action failed.");
        }

        showToast(`Invitation ${accept ? "accepted" : "declined"}.`, 'success');
        loadPendingInvitations(token);
        if (accept) loadFriendsList(token);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// 5. Load Friends List (Assuming standard /api/friend/list route)
async function loadFriendsList(token) {
    try {
        const res = await fetch('/api/friend/list', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        
        const data = await res.json();
        const friends = data.friends;
        friendsList.innerHTML = '';
        
        if (!friends || friends.length === 0) {
            friendsList.innerHTML = '<li class="empty-msg">You have no friends yet.</li>';
            return;
        }

        friends.forEach(friend => {
            const li = document.createElement('li');
            li.textContent = friend.username;
            friendsList.appendChild(li);
        });
    } catch (err) {
        console.error("Failed to load friends", err);
    }
}

// ==========================================
// UI HELPERS (Toasts)
// ==========================================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    // Remove toast after 4 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}