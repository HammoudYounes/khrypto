import { TokenManager } from "../js/tokenManager.js";
import { notificationManager } from "../js/notificationManager.js";

// DOM Elements
const backBtn = document.getElementById('backBtn');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const pendingList = document.getElementById('pendingList');
const sentList = document.getElementById('sentList');
const friendsList = document.getElementById('friendsList');

// In-memory cache of friend user IDs (for online status requests)
let cachedFriendIds = [];

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    let token = TokenManager.getAccessToken();
    if (!token) {
        const success = await TokenManager.refreshAccessToken();
        if (!success) window.location.href = '../index.html';
        token = TokenManager.getAccessToken();
    }

    notificationManager.init();
    loadPendingInvitations(token);
    loadSentRequests(token);
    await loadFriendsList(token);

    // Request initial online statuses once the friend list is loaded
    requestOnlineStatuses();
});

// Back Navigation
backBtn.addEventListener('click', () => {
    window.location.href = '../homePage/index.html';
});

// ==========================================
// REAL-TIME EVENT LISTENERS (WebSocket via DOM events)
// ==========================================

// New invitation received → refresh received list
document.addEventListener('notification:friend_invitation', () => {
    loadPendingInvitations(TokenManager.getAccessToken());
});

// Someone accepted our request → refresh friends + sent lists
document.addEventListener('notification:friend_accepted', () => {
    loadSentRequests(TokenManager.getAccessToken());
    loadFriendsList(TokenManager.getAccessToken()).then(() => requestOnlineStatuses());
});

// Someone declined our request → refresh sent list
document.addEventListener('notification:friend_declined', () => {
    loadSentRequests(TokenManager.getAccessToken());
});

// A friend was removed (by the other user) → remove from DOM
document.addEventListener('notification:friend_removed', (e) => {
    const payload = e.detail;
    const refId = payload.referenceId;
    if (refId) {
        const li = friendsList.querySelector(`li[data-friendship-id="${refId}"]`);
        if (li) {
            li.style.opacity = '0';
            li.style.transform = 'translateX(-20px)';
            setTimeout(() => li.remove(), 300);
            // Check if list is now empty
            setTimeout(() => {
                if (friendsList.children.length === 0) {
                    friendsList.innerHTML = '<li class="empty-msg">No friends yet — search for users to add!</li>';
                }
            }, 350);
        }
    }
});

// Bulk initial online statuses response
document.addEventListener('notification:friend_online_statuses', (e) => {
    const { onlineIds } = e.detail;
    if (!onlineIds) return;
    // Mark all dots as offline first, then set online ones
    friendsList.querySelectorAll('.status-dot').forEach(dot => {
        dot.classList.remove('online');
        dot.classList.add('offline');
    });
    onlineIds.forEach(id => {
        const dot = friendsList.querySelector(`li[data-user-id="${id}"] .status-dot`);
        if (dot) {
            dot.classList.remove('offline');
            dot.classList.add('online');
        }
    });
});

// Real-time single friend status change
document.addEventListener('notification:friend_status_change', (e) => {
    const { userId, status } = e.detail;
    const dot = friendsList.querySelector(`li[data-user-id="${userId}"] .status-dot`);
    if (dot) {
        dot.classList.remove('online', 'offline');
        dot.classList.add(status === 'online' ? 'online' : 'offline');
    }
});

// ==========================================
// SEARCH
// ==========================================
let searchTimeout = null;
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();

    if (query.length < 2) {
        searchResults.innerHTML = '';
        return;
    }

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

// ==========================================
// SEND INVITATION
// ==========================================
async function sendInvitation(username) {
    try {
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
            throw new Error(data.error || "Failed to send invitation.");
        }
        showToast(`Invitation sent to ${username}!`, 'success');
        searchInput.value = '';
        searchResults.innerHTML = '';
        loadSentRequests(token);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ==========================================
// PENDING INVITATIONS (RECEIVED)
// ==========================================
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
        const nameSpan = document.createElement('span');
        nameSpan.className = 'friend-name';
        nameSpan.textContent = invite.requesterUsername || 'Unknown User';
        li.appendChild(nameSpan);

        const btnGroup = document.createElement('div');
        btnGroup.className = 'btn-group';

        const acceptBtn = document.createElement('button');
        acceptBtn.textContent = 'Accept';
        acceptBtn.className = 'btn-accept';
        acceptBtn.onclick = () => respondToInvite(invite.friendshipId, true);

        const declineBtn = document.createElement('button');
        declineBtn.textContent = 'Decline';
        declineBtn.className = 'btn-decline';
        declineBtn.onclick = () => respondToInvite(invite.friendshipId, false);

        btnGroup.appendChild(acceptBtn);
        btnGroup.appendChild(declineBtn);
        li.appendChild(btnGroup);
        pendingList.appendChild(li);
    });
}

// ==========================================
// SENT REQUESTS
// ==========================================
async function loadSentRequests(token) {
    try {
        const res = await fetch('/api/friend/sent', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Could not load sent requests.");
        const data = await res.json();
        renderSentRequests(data.sent);
    } catch (err) {
        console.error(err);
    }
}

function renderSentRequests(requests) {
    sentList.innerHTML = '';
    if (!requests || requests.length === 0) {
        sentList.innerHTML = '<li class="empty-msg">No sent requests.</li>';
        return;
    }

    requests.forEach(req => {
        const li = document.createElement('li');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'friend-name';
        nameSpan.textContent = req.receiverUsername || 'Unknown User';
        li.appendChild(nameSpan);

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'btn-cancel';
        cancelBtn.onclick = () => cancelSentRequest(req.friendshipId, li);

        li.appendChild(cancelBtn);
        sentList.appendChild(li);
    });
}

async function cancelSentRequest(friendshipId, liElement) {
    try {
        const token = TokenManager.getAccessToken();
        const res = await fetch(`/api/friend/${friendshipId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Could not cancel request.");

        // Optimistic removal
        liElement.style.opacity = '0';
        liElement.style.transform = 'translateX(-20px)';
        setTimeout(() => {
            liElement.remove();
            if (sentList.children.length === 0) {
                sentList.innerHTML = '<li class="empty-msg">No sent requests.</li>';
            }
        }, 300);
        showToast('Request cancelled.', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ==========================================
// RESPOND TO INVITATION
// ==========================================
async function respondToInvite(friendshipId, accept) {
    try {
        const token = TokenManager.getAccessToken();
        const res = await fetch('/api/friend/respond', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendshipId, action: accept ? "accept" : "decline" })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Action failed.");
        }

        showToast(`Invitation ${accept ? "accepted" : "declined"}.`, 'success');
        loadPendingInvitations(token);
        if (accept) {
            await loadFriendsList(token);
            requestOnlineStatuses();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ==========================================
// FRIENDS LIST
// ==========================================
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
            friendsList.innerHTML = '<li class="empty-msg">No friends yet — search for users to add!</li>';
            cachedFriendIds = [];
            return;
        }

        cachedFriendIds = friends.map(f => f._id);

        friends.forEach(friend => {
            const li = document.createElement('li');
            li.dataset.userId = friend._id;
            li.dataset.friendshipId = friend.friendshipId;

            // Left side: status dot + username
            const friendInfo = document.createElement('div');
            friendInfo.className = 'friend-info';

            const dot = document.createElement('span');
            dot.className = 'status-dot offline';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'friend-name';
            nameSpan.textContent = friend.username;

            friendInfo.appendChild(dot);
            friendInfo.appendChild(nameSpan);

            // Right side: remove button
            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.className = 'btn-remove';
            removeBtn.onclick = () => removeFriend(friend.friendshipId, li);

            li.appendChild(friendInfo);
            li.appendChild(removeBtn);
            friendsList.appendChild(li);
        });
    } catch (err) {
        console.error("Failed to load friends", err);
    }
}

async function removeFriend(friendshipId, liElement) {
    try {
        const token = TokenManager.getAccessToken();
        const res = await fetch(`/api/friend/${friendshipId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Could not remove friend.");

        // Optimistic removal with animation
        liElement.style.opacity = '0';
        liElement.style.transform = 'translateX(-20px)';
        setTimeout(() => {
            liElement.remove();
            if (friendsList.children.length === 0) {
                friendsList.innerHTML = '<li class="empty-msg">No friends yet — search for users to add!</li>';
            }
        }, 300);
        showToast('Friend removed.', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ==========================================
// ONLINE STATUS (WebSocket, no HTTP polling)
// ==========================================
function requestOnlineStatuses() {
    if (cachedFriendIds.length === 0) return;
    const socket = notificationManager.getSocket();
    if (socket && socket.connected) {
        socket.emit('friend:get-online-statuses', { friendIds: cachedFriendIds });
    } else {
        // If socket not yet connected, wait for connection
        const checkInterval = setInterval(() => {
            const s = notificationManager.getSocket();
            if (s && s.connected) {
                s.emit('friend:get-online-statuses', { friendIds: cachedFriendIds });
                clearInterval(checkInterval);
            }
        }, 500);
        // Safety: stop checking after 10s
        setTimeout(() => clearInterval(checkInterval), 10000);
    }
}

// ==========================================
// UI HELPERS (Toasts)
// ==========================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}