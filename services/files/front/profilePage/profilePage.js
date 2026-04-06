import { TokenManager } from "../js/tokenManager.js";
import { notificationManager } from "../js/notificationManager.js";
import { ProfileManager } from "../js/profileManager.js";

// DOM Elements
const backBtn = document.getElementById('backBtn');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const pendingList = document.getElementById('pendingList');
const sentList = document.getElementById('sentList');
const challengesReceivedList = document.getElementById('challengesReceivedList');
const challengesSentList = document.getElementById('challengesSentList');
const friendsList = document.getElementById('friendsList');

// Private Chat Elements
const privateChatPanel = document.getElementById('privateChatPanel');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatFriendName = document.getElementById('chatFriendName');
const chatOnlineStatus = document.getElementById('chatOnlineStatus');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatLoading = document.getElementById('chatLoading');
const chatChallengeUnrankedBtn = document.getElementById('chatChallengeUnrankedBtn');
const chatChallengeRankedBtn = document.getElementById('chatChallengeRankedBtn');
const chatRemoveBtn = document.getElementById('chatRemoveBtn');

// In-memory caches
let cachedFriendIds = [];
let sentChallenges = []; // Track challenges we've sent (for profile page display)

// Private Chat State
let activeChatFriendshipId = null;
let activeChatFriendId = null;
let activeChatFriendUsername = null;
let chatOffset = 0;
let chatAllLoaded = false;
let chatFetching = false;

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    if (sessionStorage.getItem('isGuest') === 'true') {
        window.location.href = '../homePage/index.html';
        return;
    }

    let token = TokenManager.getAccessToken();
    if (!token) {
        const success = await TokenManager.refreshAccessToken();
        if (!success) window.location.href = '../index.html';
        token = TokenManager.getAccessToken();
    }

    if (token) {
        await ProfileManager.ensureProfile();
    }

    // Populate profile info from sessionStorage
    const username = sessionStorage.getItem('username') || 'Player';
    const elo = sessionStorage.getItem('elo') || '1000';
    const coins = sessionStorage.getItem('coins') || '0';
    const email = sessionStorage.getItem('email') || '—';
    const nameEl = document.getElementById('profileDisplayName');
    const eloEl = document.getElementById('profileElo');
    const coinsEl = document.getElementById('profileCoins');
    const emailEl = document.getElementById('profileEmail');
    if (nameEl) nameEl.textContent = username;
    if (eloEl) eloEl.textContent = elo;
    if (coinsEl) {
        coinsEl.textContent = coins;
        // Format negative balance in red
        if (parseInt(coins) < 0) {
            coinsEl.style.color = '#e74c3c';
        } else {
            coinsEl.style.color = '#2ecc71';
        }
    }
    if (emailEl) emailEl.textContent = email;

    notificationManager.init();
    initPrivateChatListeners();
    loadPendingInvitations(token);
    loadSentRequests(token);
    loadPendingChallenges(token);
    await loadFriendsListWithChat(token);
    requestOnlineStatuses();
    loadInventory(token);
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

            // Chat button
            const chatBtn = document.createElement('button');
            chatBtn.textContent = 'Chat';
            chatBtn.className = 'btn-chat';
            chatBtn.title = 'Open private chat';
            chatBtn.onclick = () => openPrivateChat(friend.friendshipId, friend._id, friend.username);

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

            actionsDiv.appendChild(chatBtn);
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
// PRIVATE CHAT FUNCTIONALITY
// ==========================================

// Update friends list to make items clickable
async function loadFriendsListWithChat(token) {
    await loadFriendsList(token);

    // Make friend list items clickable
    friendsList.querySelectorAll('li:not(.empty-msg)').forEach(li => {
        const friendInfo = li.querySelector('.friend-info');
        if (friendInfo) {
            friendInfo.style.cursor = 'pointer';
            friendInfo.onclick = () => {
                const friendshipId = li.dataset.friendshipId;
                const userId = li.dataset.userId;
                const username = li.querySelector('.friend-name').textContent;
                openPrivateChat(friendshipId, userId, username);
            };
        }
    });

    // Fetch unread counts and add badges
    try {
        const unreadRes = await fetch('/api/chat/private/unread/count', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (unreadRes.ok) {
            const unreadData = await unreadRes.json();
            const unread = unreadData.unread || {};
            Object.keys(unread).forEach(friendshipId => {
                const li = friendsList.querySelector(`li[data-friendship-id="${friendshipId}"]`);
                if (li && !li.querySelector('.unread-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'unread-badge';
                    badge.textContent = unread[friendshipId];
                    const friendInfo = li.querySelector('.friend-info');
                    if (friendInfo) friendInfo.appendChild(badge);
                }
            });
        }
    } catch (err) {
        console.error('Failed to fetch unread counts:', err);
    }
}

function openPrivateChat(friendshipId, friendId, friendUsername) {
    // Store active chat info
    activeChatFriendshipId = friendshipId;
    activeChatFriendId = friendId;
    activeChatFriendUsername = friendUsername;

    // Reset pagination
    chatOffset = 0;
    chatAllLoaded = false;

    // Update UI
    chatFriendName.textContent = friendUsername;
    // Clear messages but preserve the chatLoading element
    chatMessages.innerHTML = '';
    chatLoading.style.display = 'none';
    chatMessages.appendChild(chatLoading);
    chatInput.value = '';

    // Update online status
    const friendLi = friendsList.querySelector(`li[data-user-id="${friendId}"]`);
    if (friendLi) {
        const statusDot = friendLi.querySelector('.status-dot');
        if (statusDot) {
            chatOnlineStatus.className = statusDot.className;
        }
        // Clear unread badge when opening the chat
        const badge = friendLi.querySelector('.unread-badge');
        if (badge) badge.remove();
    }

    // Show chat panel, hide friends list
    document.querySelector('.friends-panel').style.display = 'none';
    privateChatPanel.style.display = 'flex';

    // Fetch initial messages
    fetchChatMessages();

    // Mark messages as read
    markMessagesAsRead();
}

function closePrivateChat() {
    activeChatFriendshipId = null;
    activeChatFriendId = null;
    activeChatFriendUsername = null;
    chatOffset = 0;
    chatAllLoaded = false;

    privateChatPanel.style.display = 'none';
    document.querySelector('.friends-panel').style.display = 'block';
}

async function fetchChatMessages() {
    if (chatFetching || chatAllLoaded || !activeChatFriendshipId) return;

    chatFetching = true;
    chatLoading.style.display = 'block';

    try {
        const token = TokenManager.getAccessToken();
        const res = await fetch(`/api/chat/private/${activeChatFriendshipId}?limit=15&offset=${chatOffset}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            if (res.status === 401) {
                const refreshed = await TokenManager.refreshAccessToken();
                if (refreshed) {
                    chatFetching = false;
                    chatLoading.style.display = 'none';
                    return fetchChatMessages();
                }
            }
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const messages = data.messages || [];

        if (messages.length < 15) {
            chatAllLoaded = true;
        }

        // Prepend older messages at the top
        const prevScrollHeight = chatMessages.scrollHeight;

        // Iterate in reverse so oldest messages end up at the top
        for (let i = messages.length - 1; i >= 0; i--) {
            prependMessage(messages[i]);
        }

        chatOffset += messages.length;

        // Restore scroll position
        if (chatOffset > 15) {
            chatMessages.scrollTop = chatMessages.scrollHeight - prevScrollHeight;
        } else {
            // Initial load: scroll to bottom
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    } catch (err) {
        console.error('[Chat] Error fetching messages:', err);
        showToast('Failed to load messages', 'error');
    } finally {
        chatFetching = false;
        chatLoading.style.display = 'none';
    }
}

function createMessageElement(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    if (msg.senderUsername === sessionStorage.getItem('username')) {
        div.classList.add('chat-msg-own');
    }

    const sender = document.createElement('div');
    sender.className = 'chat-msg-sender';
    sender.textContent = msg.senderUsername;

    const content = document.createElement('div');
    content.className = 'chat-msg-content';
    content.textContent = msg.content;

    const time = document.createElement('div');
    time.className = 'chat-msg-time';
    const date = new Date(msg.createdAt);
    time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.appendChild(sender);
    div.appendChild(content);
    div.appendChild(time);
    return div;
}

function appendMessage(msg) {
    const el = createMessageElement(msg);
    chatMessages.appendChild(el);
}

function prependMessage(msg) {
    const el = createMessageElement(msg);
    chatLoading.insertAdjacentElement('afterend', el);
}

function sendChatMessage() {
    const content = chatInput.value.trim();
    if (!content || !activeChatFriendshipId) return;

    const socket = notificationManager.getSocket();
    if (!socket || !socket.connected) {
        showToast('Not connected to server', 'error');
        return;
    }

    socket.emit('private-chat:send', {
        friendshipId: activeChatFriendshipId,
        content: content
    });

    chatInput.value = '';
}

function markMessagesAsRead() {
    if (!activeChatFriendshipId) return;

    const socket = notificationManager.getSocket();
    if (socket && socket.connected) {
        socket.emit('private-chat:mark-read', {
            friendshipId: activeChatFriendshipId
        });
    }
}

function initPrivateChatListeners() {
    // Close chat button
    closeChatBtn.addEventListener('click', closePrivateChat);

    // Send message
    chatSendBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendChatMessage();
        }
    });

    // Scroll pagination
    chatMessages.addEventListener('scroll', () => {
        if (chatMessages.scrollTop === 0 && !chatFetching && !chatAllLoaded) {
            fetchChatMessages();
        }
    });

    // Challenge buttons in chat
    chatChallengeUnrankedBtn.addEventListener('click', () => {
        if (activeChatFriendId) {
            sendChallenge(activeChatFriendId, 'unranked');
        }
    });

    chatChallengeRankedBtn.addEventListener('click', () => {
        if (activeChatFriendId) {
            sendChallenge(activeChatFriendId, 'ranked');
        }
    });

    chatRemoveBtn.addEventListener('click', async () => {
        if (activeChatFriendshipId) {
            const confirmed = confirm(`Remove ${activeChatFriendUsername} from your friends?`);
            if (confirmed) {
                try {
                    const token = TokenManager.getAccessToken();
                    const res = await fetch(`/api/friend/${activeChatFriendshipId}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (!res.ok) throw new Error("Could not remove friend.");

                    closePrivateChat();
                    showToast('Friend removed.', 'success');
                    loadFriendsListWithChat(token);
                } catch (err) {
                    showToast(err.message, 'error');
                }
            }
        }
    });

    // Listen for incoming private messages
    document.addEventListener('notification:private_chat_receive', (e) => {
        const msg = e.detail;

        // If we're in the chat with this person, append the message
        if (activeChatFriendshipId === msg.friendshipId) {
            msg._handled = true; // Suppress toast in notificationManager
            const isAtBottom = chatMessages.scrollTop + chatMessages.clientHeight >= chatMessages.scrollHeight - 30;
            appendMessage(msg);
            if (isAtBottom) {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
            // Mark as read
            markMessagesAsRead();
        } else {
            // Not viewing this chat — add/update unread badge on the friend's list item
            const li = friendsList.querySelector(`li[data-friendship-id="${msg.friendshipId}"]`);
            if (li) {
                const existing = li.querySelector('.unread-badge');
                if (existing) {
                    const count = parseInt(existing.textContent) || 0;
                    existing.textContent = count + 1;
                } else {
                    const badge = document.createElement('span');
                    badge.className = 'unread-badge';
                    badge.textContent = '1';
                    const friendInfo = li.querySelector('.friend-info');
                    if (friendInfo) friendInfo.appendChild(badge);
                }
            }
        }
    });

    // Update online status in chat header
    document.addEventListener('notification:friend_status_change', (e) => {
        const { userId, status } = e.detail;
        if (activeChatFriendId === userId) {
            chatOnlineStatus.classList.remove('online', 'offline');
            chatOnlineStatus.classList.add(status === 'online' ? 'online' : 'offline');
        }
    });
}

// ==========================================
// INVENTORY
// ==========================================

async function loadInventory(token) {
    try {
        const res = await fetch('/api/market/inventory', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        renderInventory(data.inventory || []);
    } catch (err) {
        console.error('Failed to load inventory:', err);
    }
}

function renderInventory(items) {
    const emptyEl = document.getElementById('inventoryEmpty');
    const groupPP = document.getElementById('groupProfilePictures');
    const groupEm = document.getElementById('groupEmotes');
    const gridPP = document.getElementById('gridProfilePictures');
    const gridEm = document.getElementById('gridEmotes');

    const profilePics = items.filter(i => i.type === 'profile_picture');
    const emotes = items.filter(i => i.type === 'emote');

    if (items.length === 0) {
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';

    // Update avatar from equipped profile picture
    const equippedPic = profilePics.find(i => i.equipped);
    updateProfileAvatar(equippedPic);

    if (profilePics.length > 0) {
        groupPP.style.display = 'block';
        gridPP.innerHTML = '';
        profilePics.forEach(item => gridPP.appendChild(createItemCard(item, true)));
    }

    if (emotes.length > 0) {
        groupEm.style.display = 'block';
        gridEm.innerHTML = '';
        emotes.forEach(item => gridEm.appendChild(createItemCard(item, false)));
    }
}

function createItemCard(item, showEquip) {
    const card = document.createElement('div');
    card.className = 'inventory-item' + (item.equipped ? ' equipped' : '');
    card.dataset.itemId = item._id;

    const img = document.createElement('img');
    img.className = 'inventory-item-img';
    img.src = `/api/market/${item.assetPath}`;
    img.alt = item.name;

    const name = document.createElement('span');
    name.className = 'inventory-item-name';
    name.textContent = item.name;

    const badge = document.createElement('span');
    badge.className = `rarity-badge ${item.rarity}`;
    badge.textContent = item.rarity === 'goat' ? '🐐 GOAT' : item.rarity;

    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(badge);

    if (showEquip) {
        const btn = document.createElement('button');
        btn.className = 'btn-equip' + (item.equipped ? ' equipped' : '');
        btn.textContent = item.equipped ? 'Equipped' : 'Equip';
        btn.onclick = () => equipItem(item._id);
        card.appendChild(btn);
    }

    return card;
}

async function equipItem(itemId) {
    try {
        const token = TokenManager.getAccessToken();
        const res = await fetch('/api/market/equip', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId })
        });
        if (!res.ok) throw new Error('Failed to equip item');
        loadInventory(token);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function updateProfileAvatar(equippedPic) {
    const img = document.getElementById('profileAvatarImg');
    const fallback = document.getElementById('profileAvatarFallback');
    if (equippedPic && img && fallback) {
        img.src = `/api/market/${equippedPic.assetPath}`;
        img.style.display = 'block';
        fallback.style.display = 'none';
    } else if (img && fallback) {
        img.style.display = 'none';
        fallback.style.display = 'block';
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