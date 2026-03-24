import { TokenManager } from './tokenManager.js';

class NotificationManager {
    constructor() {
        this.socket = null;
        this.toastContainer = null;
    }

    init() {
        // Prevent multiple connections on the same page
        if (this.socket) return;

        const token = TokenManager.getAccessToken();
        if (!token) return;

        this.setupToastContainer();

        // Initialize Socket
        this.socket = io({
            path: '/social/socket.io',
            auth: { token },
            query: { token }
        });

        this.socket.on('connect', () => console.log("[Notifications] Connected to broker"));

        // ==========================================
        // FRIEND EVENTS
        // ==========================================

        this.socket.on('friend:invitation', (payload) => {
            this.showInteractiveToast(
                `Friend request from ${payload.senderUsername || 'someone'}`,
                'info',
                [
                    {
                        label: 'Accept', className: 'toast-btn-accept',
                        onClick: (toast) => this._respondToFriendRequest(payload.referenceId, 'accept', toast)
                    },
                    {
                        label: 'Decline', className: 'toast-btn-decline',
                        onClick: (toast) => this._respondToFriendRequest(payload.referenceId, 'decline', toast)
                    }
                ]
            );
            document.dispatchEvent(new CustomEvent('notification:friend_invitation', { detail: payload }));
        });

        this.socket.on('friend:accepted', (payload) => {
            this.showToast(`${payload.senderUsername || 'A user'} accepted your friend request!`, 'success');
            document.dispatchEvent(new CustomEvent('notification:friend_accepted', { detail: payload }));
        });

        this.socket.on('friend:declined', (payload) => {
            this.showToast(`${payload.senderUsername || 'A user'} declined your friend request.`, 'error');
            document.dispatchEvent(new CustomEvent('notification:friend_declined', { detail: payload }));
        });

        this.socket.on('friend:removed', (payload) => {
            document.dispatchEvent(new CustomEvent('notification:friend_removed', { detail: payload }));
        });

        this.socket.on('friend:status-change', (payload) => {
            document.dispatchEvent(new CustomEvent('notification:friend_status_change', { detail: payload }));
        });

        this.socket.on('friend:online-statuses', (payload) => {
            document.dispatchEvent(new CustomEvent('notification:friend_online_statuses', { detail: payload }));
        });

        // ==========================================
        // PRIVATE CHAT EVENTS
        // ==========================================

        this.socket.on('private-chat:receive', (payload) => {
            // Add a flag so the profile page can mark the message as handled
            payload._handled = false;

            // Dispatch event for profile page to handle
            document.dispatchEvent(new CustomEvent('notification:private_chat_receive', { detail: payload }));

            // After a microtask, check if the profile page handled it
            // If not (user is on another page or has a different chat open), show a toast
            Promise.resolve().then(() => {
                if (!payload._handled) {
                    this.showToast(`New message from ${payload.senderUsername || 'a friend'}`, 'info');
                }
            });
        });

        // ==========================================
        // CHALLENGE EVENTS
        // ==========================================

        this.socket.on('challenge:received', (payload) => {
            const modeLabel = payload.mode === 'ranked' ? 'Ranked' : 'Unranked';
            this.showInteractiveToast(
                `${payload.senderUsername} challenges you! (${modeLabel})`,
                'info',
                [
                    {
                        label: 'Accept', className: 'toast-btn-accept',
                        onClick: (toast) => this._respondToChallenge(payload.challengeId, 'accept', toast)
                    },
                    {
                        label: 'Decline', className: 'toast-btn-decline',
                        onClick: (toast) => this._respondToChallenge(payload.challengeId, 'decline', toast)
                    }
                ],
                120000 // 2 minute countdown
            );
            document.dispatchEvent(new CustomEvent('notification:challenge_received', { detail: payload }));
        });

        this.socket.on('challenge:accepted', (payload) => {
            this.showToast('Challenge accepted! Joining game...', 'success');
            this._redirectToGame(payload, payload.challenger.playerId);
        });

        this.socket.on('challenge:declined', (payload) => {
            this.showToast(`${payload.responderUsername || 'Friend'} declined your challenge.`, 'error');
            document.dispatchEvent(new CustomEvent('notification:challenge_declined', { detail: payload }));
        });

        this.socket.on('challenge:expired', (payload) => {
            this.showToast('Your challenge has expired.', 'error');
            document.dispatchEvent(new CustomEvent('notification:challenge_expired', { detail: payload }));
        });

        this.socket.on('connect_error', (err) => {
            console.error("[Notifications] WebSocket Error:", err.message);
        });
    }

    getSocket() {
        return this.socket;
    }

    // ==========================================
    // INTERNAL API HELPERS (called from toasts on any page)
    // ==========================================

    async _respondToFriendRequest(friendshipId, action, toastElement) {
        try {
            const token = TokenManager.getAccessToken();
            const res = await fetch('/api/friend/respond', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ friendshipId, action })
            });
            if (!res.ok) throw new Error("Action failed");

            this._dismissToast(toastElement);
            this.showToast(`Friend request ${action}ed!`, action === 'accept' ? 'success' : 'info');

            // Re-dispatch so profile page refreshes if open
            if (action === 'accept') {
                document.dispatchEvent(new CustomEvent('notification:friend_accepted', { detail: {} }));
            }
            document.dispatchEvent(new CustomEvent('notification:friend_invitation', { detail: {} }));
        } catch (err) {
            console.error("Failed to respond to friend request:", err);
            this.showToast('Failed to respond. Try again.', 'error');
        }
    }

    async _respondToChallenge(challengeId, action, toastElement) {
        try {
            const token = TokenManager.getAccessToken();
            const res = await fetch('/api/friend/challenge/respond', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ challengeId, action })
            });

            const data = await res.json();
            this._dismissToast(toastElement);

            if (!res.ok) {
                this.showToast(data.error || 'Action failed', 'error');
                return;
            }

            if (action === 'decline') {
                this.showToast('Challenge declined.', 'info');
                return;
            }

            // Accept: redirect to game
            this.showToast('Challenge accepted! Joining game...', 'success');
            this._redirectToGame(data, data.responder.playerId);
        } catch (err) {
            console.error("Failed to respond to challenge:", err);
            this.showToast('Failed to respond. Try again.', 'error');
        }
    }

    _redirectToGame(data, myPlayerId) {
        const opponent = myPlayerId === 0 ? data.responder : data.challenger;
        const me = myPlayerId === 0 ? data.challenger : data.responder;

        sessionStorage.setItem('gameId', data.gameId);
        sessionStorage.setItem('gameMode', 'online');
        sessionStorage.setItem('playerId', String(myPlayerId));
        sessionStorage.setItem('myUsername', me.username);
        sessionStorage.setItem('opponentUsername', opponent.username);
        sessionStorage.setItem('myElo', String(me.elo));
        sessionStorage.setItem('opponentElo', String(opponent.elo));
        sessionStorage.setItem('isRanked', data.gameMode === 'ranked' ? 'true' : 'false');

        window.location.href = '/gamePage/index.html';
    }

    // ==========================================
    // TOAST UI
    // ==========================================

    setupToastContainer() {
        this.toastContainer = document.getElementById('toastContainer');
        if (!this.toastContainer) {
            this.toastContainer = document.createElement('div');
            this.toastContainer.id = 'toastContainer';
            this.toastContainer.className = 'toast-container';
            document.body.appendChild(this.toastContainer);
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        this.toastContainer.appendChild(toast);

        setTimeout(() => {
            this._dismissToast(toast);
        }, 4000);
    }

    /**
     * Show an interactive toast with action buttons.
     * Does not auto-dismiss until user clicks a button or countdown expires.
     * @param {string} message
     * @param {string} type - CSS class (info, success, error)
     * @param {Array} actions - [{ label, className, onClick(toastEl) }]
     * @param {number|null} countdownMs - Optional countdown in ms
     */
    showInteractiveToast(message, type, actions = [], countdownMs = null) {
        const toast = document.createElement('div');
        toast.className = `toast interactive ${type}`;

        const msgEl = document.createElement('div');
        msgEl.className = 'toast-message';
        msgEl.textContent = message;
        toast.appendChild(msgEl);

        if (actions.length > 0) {
            const actionsEl = document.createElement('div');
            actionsEl.className = 'toast-actions';

            actions.forEach(action => {
                const btn = document.createElement('button');
                btn.textContent = action.label;
                btn.className = action.className || 'toast-btn';
                btn.onclick = () => action.onClick(toast);
                actionsEl.appendChild(btn);
            });

            toast.appendChild(actionsEl);
        }

        // Optional countdown bar
        if (countdownMs) {
            const bar = document.createElement('div');
            bar.className = 'toast-countdown';
            bar.style.animationDuration = `${countdownMs}ms`;
            toast.appendChild(bar);

            // Auto-dismiss when countdown expires
            const timer = setTimeout(() => {
                this._dismissToast(toast);
            }, countdownMs);
            toast._countdownTimer = timer;
        }

        this.toastContainer.appendChild(toast);
    }

    _dismissToast(toast) {
        if (!toast || !toast.parentNode) return;
        if (toast._countdownTimer) clearTimeout(toast._countdownTimer);
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }
}

// Export a single, shared instance
export const notificationManager = new NotificationManager();