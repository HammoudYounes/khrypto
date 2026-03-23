import { TokenManager } from "../js/tokenManager.js";
import { notificationManager } from "../js/notificationManager.js";

// DOM Elements
const backBtn = document.getElementById('backBtn');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const pendingList = document.getElementById('pendingList');
const sentList = document.getElementById('sentList');
const challengesReceivedList = document.getElementById('challengesReceivedList');
const challengesSentList = document.getElementById('challengesSentList');
const friendsList = document.getElementById('friendsList');

// In-memory caches
let cachedFriendIds = [];
let sentChallenges = []; // Track challenges we've sent (for profile page display)

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
    loadPendingChallenges(token);
    await loadFriendsList(token);
    requestOnlineStatuses();
});

// Back Navigation
backBtn.addEventListener('click', () => {
    window.location.href = '../homePage/index.html';
});

// ==========================================
// REAL-TIME EVENT LISTENERS (WebSocket via DOM events)
// ==========================================

// Friend request events → refresh lists
document.addEventListener('notification:friend_invitation', () => {
    loadPendingInvitations(TokenManager.getAccessToken());
});
document.addEventListener('notification:friend_accepted', () => {
    loadSentRequests(TokenManager.getAccessToken());
    loadFriendsList(TokenManager.getAccessToken()).then(() => requestOnlineStatuses());
});
document.addEventListener('notification:friend_declined', () => {
    loadSentRequests(TokenManager.getAccessToken());
});

// Friend removed → remove from DOM
document.addEventListener('notification:friend_removed', (e) => {
    const refId = e.detail?.referenceId;
    if (refId) {
        const li = friendsList.querySelector(`li[data-friendship-id="${refId}"]`);
        if (li) {
            li.style.opacity = '0';
            li.style.transform = 'translateX(-20px)';
            setTimeout(() => li.remove(), 300);
            setTimeout(() => {
                if (friendsList.children.length === 0) {
                    friendsList.innerHTML = '<li class="empty-msg">No friends yet — search for users to add!</li>';
                }
            }, 350);
        }
    }
});

// Online status events
document.addEventListener('notification:friend_online_statuses', (e) => {
    const { onlineIds } = e.detail;
    if (!onlineIds) return;
    friendsList.querySelectorAll('.status-dot').forEach(dot => {
        dot.classList.remove('online');
        dot.classList.add('offline');
    });
    onlineIds.forEach(id => {
        const dot = friendsList.querySelector(`li[data-user-id="${id}"] .status-dot`);
        if (dot) { dot.classList.remove('offline'); dot.classList.add('online'); }
    });
});

document.addEventListener('notification:friend_status_change', (e) => {
    const { userId, status } = e.detail;
    const dot = friendsList.querySelector(`li[data-user-id="${userId}"] .status-dot`);
    if (dot) {
        dot.classList.remove('online', 'offline');
        dot.classList.add(status === 'online' ? 'online' : 'offline');
    }
});

// Challenge events → refresh challenges section
document.addEventListener('notification:challenge_received', (e) => {
    addReceivedChallenge(e.detail);
});
document.addEventListener('notification:challenge_declined', () => {
    // Remove from sent list if visible
    refreshSentChallengesUI();
});
document.addEventListener('notification:challenge_expired', () => {
    refreshSentChallengesUI();
});

// ==========================================
// SEARCH
// ==========================================
let searchTimeout = null;
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length < 2) { searchResults.innerHTML = ''; return; }

    searchTimeout = setTimeout(async () => {
        try {
            const token = TokenManager.getAccessToken();
            const res = await fetch(`/api/friend/search?username=${encodeURIComponent(query)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error("Search failed");
            const data = await res.json();
            renderSearchResults(data.users);
        } catch (err) { console.error(err); }
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
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to send invitation.");
        showToast(`Invitation sent to ${username}!`, 'success');
        searchInput.value = '';
        searchResults.innerHTML = '';
        loadSentRequests(token);
    } catch (err) { showToast(err.message, 'error'); }
}

// ==========================================
// PENDING INVITATIONS (RECEIVED)
// ==========================================
async function loadPendingInvitations(token) {
    try {
        const res = await fetch('/api/friend/pending', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error("Could not load pending invites.");
        const data = await res.json();
        renderPending(data.pending);
    } catch (err) { console.error(err); }
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
        const res = await fetch('/api/friend/sent', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error("Could not load sent requests.");
        const data = await res.json();
        renderSentRequests(data.sent);
    } catch (err) { console.error(err); }
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
            method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Could not cancel request.");
        liElement.style.opacity = '0';
        liElement.style.transform = 'translateX(-20px)';
        setTimeout(() => {
            liElement.remove();
            if (sentList.children.length === 0) sentList.innerHTML = '<li class="empty-msg">No sent requests.</li>';
        }, 300);
        showToast('Request cancelled.', 'success');
    } catch (err) { showToast(err.message, 'error'); }
}

// ==========================================
// RESPOND TO INVITATION
// ==========================================
async function respondToInvite(friendshipId, accept) {
    try {
        const token = TokenManager.getAccessToken();
        const res = await fetch('/api/friend/respond', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
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
    } catch (err) { showToast(err.message, 'error'); }
}

// ==========================================
// FRIENDS LIST (with challenge buttons)
// ==========================================
async function loadFriendsList(token) {
    try {
        const res = await fetch('/api/friend/list', { headers: { 'Authorization': `Bearer ${token}` } });
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

            // Left: status dot + username
            const friendInfo = document.createElement('div');
            friendInfo.className = 'friend-info';
            const dot = document.createElement('span');
            dot.className = 'status-dot offline';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'friend-name';
            nameSpan.textContent = friend.username;
            friendInfo.appendChild(dot);
            friendInfo.appendChild(nameSpan);

            // Right: action buttons
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'btn-group';

            // Challenge buttons (always shown now)
            const unrankedBtn = document.createElement('button');
            unrankedBtn.textContent = 'Unranked';
            unrankedBtn.className = 'btn-challenge';
            unrankedBtn.title = 'Challenge (Unranked)';
            unrankedBtn.dataset.challengeBtn = 'true';
            unrankedBtn.onclick = () => sendChallenge(friend._id, 'unranked');

            const rankedBtn = document.createElement('button');
            rankedBtn.textContent = 'Ranked';
            rankedBtn.className = 'btn-challenge';
            rankedBtn.title = 'Challenge (Ranked)';
            rankedBtn.dataset.challengeBtn = 'true';
            rankedBtn.onclick = () => sendChallenge(friend._id, 'ranked');

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.className = 'btn-remove';
            removeBtn.onclick = () => removeFriend(friend.friendshipId, li);

            actionsDiv.appendChild(unrankedBtn);
            actionsDiv.appendChild(rankedBtn);
            actionsDiv.appendChild(removeBtn);

            li.appendChild(friendInfo);
            li.appendChild(actionsDiv);
            friendsList.appendChild(li);
        });
    } catch (err) { console.error("Failed to load friends", err); }
}



// ==========================================
// CHALLENGE FRIENDS
// ==========================================
async function loadPendingChallenges(token) {
    try {
        const res = await fetch('/api/friend/challenge/pending', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        // Populate received challenges
        if (data.received && data.received.length > 0) {
            challengesReceivedList.innerHTML = '';
            data.received.forEach(ch => addReceivedChallenge(ch));
        }

        // Populate sent challenges
        if (data.sent && data.sent.length > 0) {
            data.sent.forEach(ch => sentChallenges.push(ch));
            refreshSentChallengesUI();
        }
    } catch (err) { console.error('Failed to load pending challenges', err); }
}

async function sendChallenge(receiverId, mode) {
    try {
        const token = TokenManager.getAccessToken();
        const res = await fetch('/api/friend/challenge', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ receiverId, mode })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to send challenge.");

        showToast(`Challenge sent! (${mode})`, 'success');

        // Track in sent challenges list
        addSentChallenge({ challengeId: data.challengeId, receiverId, mode });
    } catch (err) { showToast(err.message, 'error'); }
}

// === Challenges UI (profile page sections) ===

function addReceivedChallenge(payload) {
    // Remove empty message if present
    const emptyMsg = challengesReceivedList.querySelector('.empty-msg');
    if (emptyMsg) emptyMsg.remove();

    const li = document.createElement('li');
    li.dataset.challengeId = payload.challengeId;

    const modeLabel = payload.mode === 'ranked' ? 'Ranked' : 'Unranked';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'friend-name';
    nameSpan.textContent = `${payload.senderUsername} (${modeLabel})`;
    li.appendChild(nameSpan);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'btn-group';

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept';
    acceptBtn.className = 'btn-accept';
    acceptBtn.onclick = async () => {
        try {
            const token = TokenManager.getAccessToken();
            const res = await fetch('/api/friend/challenge/respond', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ challengeId: payload.challengeId, action: 'accept' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed");
            // Redirect to game
            notificationManager._redirectToGame(data, data.responder.playerId);
        } catch (err) { showToast(err.message, 'error'); }
    };

    const declineBtn = document.createElement('button');
    declineBtn.textContent = 'Decline';
    declineBtn.className = 'btn-decline';
    declineBtn.onclick = async () => {
        try {
            const token = TokenManager.getAccessToken();
            await fetch('/api/friend/challenge/respond', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ challengeId: payload.challengeId, action: 'decline' })
            });
            li.style.opacity = '0';
            setTimeout(() => {
                li.remove();
                if (challengesReceivedList.children.length === 0) {
                    challengesReceivedList.innerHTML = '<li class="empty-msg">No pending challenges.</li>';
                }
            }, 300);
        } catch (err) { showToast(err.message, 'error'); }
    };

    btnGroup.appendChild(acceptBtn);
    btnGroup.appendChild(declineBtn);
    li.appendChild(btnGroup);
    challengesReceivedList.appendChild(li);
}

function addSentChallenge(data) {
    sentChallenges.push(data);
    refreshSentChallengesUI();
}

function refreshSentChallengesUI() {
    challengesSentList.innerHTML = '';
    if (sentChallenges.length === 0) {
        challengesSentList.innerHTML = '<li class="empty-msg">No sent challenges.</li>';
        return;
    }
    sentChallenges.forEach(ch => {
        const li = document.createElement('li');
        const modeLabel = ch.mode === 'ranked' ? 'Ranked' : 'Unranked';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'friend-name';
        nameSpan.textContent = `Waiting... (${modeLabel})`;
        li.appendChild(nameSpan);
        challengesSentList.appendChild(li);
    });
}

// ==========================================
// REMOVE FRIEND
// ==========================================
async function removeFriend(friendshipId, liElement) {
    try {
        const token = TokenManager.getAccessToken();
        const res = await fetch(`/api/friend/${friendshipId}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Could not remove friend.");
        liElement.style.opacity = '0';
        liElement.style.transform = 'translateX(-20px)';
        setTimeout(() => {
            liElement.remove();
            if (friendsList.children.length === 0) {
                friendsList.innerHTML = '<li class="empty-msg">No friends yet — search for users to add!</li>';
            }
        }, 300);
        showToast('Friend removed.', 'success');
    } catch (err) { showToast(err.message, 'error'); }
}

// ==========================================
// ONLINE STATUS (WebSocket, no polling)
// ==========================================
function requestOnlineStatuses() {
    if (cachedFriendIds.length === 0) return;
    const socket = notificationManager.getSocket();
    if (socket && socket.connected) {
        socket.emit('friend:get-online-statuses', { friendIds: cachedFriendIds });
    } else {
        const checkInterval = setInterval(() => {
            const s = notificationManager.getSocket();
            if (s && s.connected) {
                s.emit('friend:get-online-statuses', { friendIds: cachedFriendIds });
                clearInterval(checkInterval);
            }
        }, 500);
        setTimeout(() => clearInterval(checkInterval), 10000);
    }
}

// ==========================================
// UI HELPERS
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