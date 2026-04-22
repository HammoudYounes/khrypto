import { TokenManager, ApiHost } from './tokenManager.js';

class NotificationManager {
    constructor() {
        this.socket = null;
        this.toastContainer = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.debugMode = true; // Set to false in production
    }

    _isNative() {
        return window.Capacitor && window.Capacitor.getPlatform() !== 'web';
    }

    async _requestNotificationPermission() {
        if (!this._isNative()) return;
        try {
            const { LocalNotifications } = window.Capacitor.Plugins;
            const { display } = await LocalNotifications.requestPermissions();
            this.debug(`Native notification permission: ${display}`);
            await LocalNotifications.createChannel({
                id: 'khrypto_default',
                name: 'Khrypto Notifications',
                importance: 5,
                visibility: 1,
                vibration: true,
            });
            await LocalNotifications.registerActionTypes({
                types: [
                    {
                        id: 'FRIEND_REQUEST',
                        actions: [
                            { id: 'accept_friend',  title: 'Accept',  foreground: true },
                            { id: 'decline_friend', title: 'Decline', foreground: true },
                        ]
                    },
                    {
                        id: 'CHALLENGE',
                        actions: [
                            { id: 'accept_challenge',  title: 'Accept',  foreground: true },
                            { id: 'decline_challenge', title: 'Decline', foreground: true },
                        ]
                    }
                ]
            });
            this._setupNotificationTapListener();
        } catch (e) {
            console.warn('[NotifMgr] Could not request notification permission', e);
        }
    }

    _setupNotificationTapListener() {
        if (!this._isNative()) return;
        const { LocalNotifications } = window.Capacitor.Plugins;
        LocalNotifications.addListener('localNotificationActionPerformed', async (event) => {
            const { actionId, notification } = event;
            const extra = notification.extra || {};
            this.debug('Notification action performed', { actionId, extra });

            if (actionId === 'accept_friend' && extra.referenceId) {
                await this._respondToFriendRequest(extra.referenceId, 'accept', null);
                return;
            }
            if (actionId === 'decline_friend' && extra.referenceId) {
                await this._respondToFriendRequest(extra.referenceId, 'decline', null);
                return;
            }
            if (actionId === 'accept_challenge' && extra.challengeId) {
                await this._respondToChallenge(extra.challengeId, 'accept', null);
                return;
            }
            if (actionId === 'decline_challenge' && extra.challengeId) {
                await this._respondToChallenge(extra.challengeId, 'decline', null);
                return;
            }

            // Plain tap — navigate
            if (extra.type === 'message' && extra.friendshipId) {
                const params = new URLSearchParams({
                    openChat: 'true',
                    friendshipId: extra.friendshipId,
                    friendId: extra.senderId,
                    friendUsername: extra.senderUsername,
                });
                window.location.href = `/profilePage/index.html?${params}`;
            } else {
                window.location.href = '/homePage/index.html';
            }
        });
    }

    async _sendNativeNotification(title, body, extra = {}, actionTypeId = null) {
        if (!this._isNative()) return;
        try {
            const { LocalNotifications } = window.Capacitor.Plugins;
            const notification = {
                id: Math.floor(Math.random() * 100000),
                title,
                body,
                channelId: 'khrypto_default',
                smallIcon: 'ic_stat_icon_config_sample',
                extra,
            };
            if (actionTypeId) notification.actionTypeId = actionTypeId;
            await LocalNotifications.schedule({ notifications: [notification] });
        } catch (e) {
            console.warn('[NotifMgr] Native notification failed', e);
        }
    }

    init(externalSocket = null) {
        // If an external socket is provided, use it instead of creating a new one
        if (externalSocket) {
            this.debug("Using external socket provided by caller");
            this.socket = externalSocket;
            this.socket._externalSocket = true; // Mark as external
            this.setupToastContainer();
            this.debug("Toast container setup complete");
            this._requestNotificationPermission();
            this.registerEventListeners();
            return;
        }

        // Prevent multiple connections - check if socket exists AND is connected
        if (this.socket) {
            if (this.socket.connected) {
                this.debug("Init called but socket already exists and is connected");
                return;
            } else {
                this.debug("Init called with stale socket, cleaning up...");
                this.socket.disconnect();
                this.socket = null;
            }
        }

        const token = TokenManager.getAccessToken();
        if (!token) {
            this.debug("Init failed: No token available");
            return;
        }

        this.setupToastContainer();
        this.debug("Toast container setup complete");
        this._requestNotificationPermission();

        // Initialize Socket
        this.socket = io(ApiHost.getHost(), {
            path: '/social/socket.io',
            auth: { token },
            query: { token },
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: this.maxReconnectAttempts
        });

        this.registerEventListeners();
    }

    registerEventListeners() {
        if (!this.socket) {
            console.error("[NotifMgr] Cannot register event listeners - no socket");
            return;
        }

        // Only register connection events if we created the socket ourselves
        // If using external socket, these are already handled by the parent
        if (!this.socket._externalSocket) {
            this.socket.on('connect', () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.debug(" Connected to broker", { socketId: this.socket.id });
                console.log("[Notifications] Connected to broker");
            });

            this.socket.on('disconnect', (reason) => {
                this.isConnected = false;
                this.debug(" Disconnected from broker", { reason });
                console.warn("[Notifications] Disconnected:", reason);
            });

            this.socket.on('reconnect_attempt', (attemptNumber) => {
                this.reconnectAttempts = attemptNumber;
                this.debug(` Reconnection attempt ${attemptNumber}/${this.maxReconnectAttempts}`);
            });

            this.socket.on('reconnect', (attemptNumber) => {
                this.debug(` Reconnected after ${attemptNumber} attempts`);
                this.showToast('Notifications reconnected', 'success');
            });

            this.socket.on('reconnect_failed', () => {
                this.debug("Reconnection failed after all attempts");
                this.showToast('Unable to connect to notifications', 'error');
            });

            this.socket.on('connect_error', (err) => {
                console.error("[Notifications] WebSocket Error:", err.message);
            });
        }

        // ==========================================
        // FRIEND EVENTS
        // ==========================================

        this.socket.on('friend:invitation', (payload) => {
            this.debug("Friend invitation received", payload);
            this._sendNativeNotification(
                'Friend Request',
                `${payload.senderUsername || 'Someone'} sent you a friend request`,
                { type: 'friend_request', referenceId: payload.referenceId },
                'FRIEND_REQUEST'
            );
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
            this._sendNativeNotification('Friend Request Accepted', `${payload.senderUsername || 'A user'} accepted your friend request!`);
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
            this.debug("Private chat message received", payload);
            this._sendNativeNotification(
                payload.senderUsername || 'New Message',
                payload.content || 'Sent you a message',
                { type: 'message', friendshipId: payload.friendshipId, senderId: payload.senderId, senderUsername: payload.senderUsername }
            );
            // Add a flag so the profile page can mark the message as handled
            payload._handled = false;

            // Dispatch event for profile page to handle
            document.dispatchEvent(new CustomEvent('notification:private_chat_receive', { detail: payload }));

            // Give the event handler time to mark the message as handled
            // Use setTimeout instead of Promise.resolve() for more reliable timing
            setTimeout(() => {
                if (!payload._handled) {
                    this.debug("Message not handled by page, showing toast");
                    this.showToast(`New message from ${payload.senderUsername || 'a friend'}`, 'info');
                } else {
                    this.debug("Message handled by profile page, toast suppressed");
                }
            }, 10);
        });

        // ==========================================
        // CHALLENGE EVENTS
        // ==========================================

        this.socket.on('challenge:received', (payload) => {
            this.debug("Challenge received", payload);
            const modeLabel = payload.mode === 'ranked' ? 'Ranked' : 'Unranked';
            this._sendNativeNotification(
                'Challenge Received',
                `${payload.senderUsername} challenges you! (${modeLabel})`,
                { type: 'challenge', challengeId: payload.challengeId },
                'CHALLENGE'
            );
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
            const res = await fetch(`${ApiHost.getHost()}/api/friend/respond`, {
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
            const res = await fetch(`${ApiHost.getHost()}/api/friend/challenge/respond`, {
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

        // Clear any stale active game state from a previous session
        localStorage.removeItem('activeGameId');
        localStorage.removeItem('activePlayerId');
        localStorage.removeItem('activeGameExpiresAt');
        localStorage.removeItem('activeMyUsername');
        localStorage.removeItem('activeOpponentUsername');
        localStorage.removeItem('activeMyElo');
        localStorage.removeItem('activeOpponentElo');

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
        // Always try to get existing container first
        let container = document.getElementById('toastContainer');

        // If container exists but is not in DOM, remove the reference
        if (container && !container.parentNode) {
            this.debug("Toast container exists but not in DOM, will recreate");
            container = null;
        }

        // Create container if needed
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';

            // Ensure document.body exists
            if (document.body) {
                document.body.appendChild(container);
                this.debug("Created new toast container");
            } else {
                console.error("[NotifMgr] Cannot create toast container - document.body not ready");
                return;
            }
        } else {
            this.debug("Toast container already exists");
        }

        this.toastContainer = container;
    }

    showToast(message, type = 'info') {

        // Ensure toast container exists and is in DOM
        if (!this.toastContainer || !this.toastContainer.parentNode) {
            this.debug("Toast container missing, recreating...");
            this.setupToastContainer();

            // Double-check after recreation
            if (!this.toastContainer || !this.toastContainer.parentNode) {
                console.error("[NotifMgr] Failed to create toast container, cannot show toast");
                return;
            }
        }

        this.debug(`Showing toast: [${type}] ${message}`);

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        this.toastContainer.appendChild(toast);

        // Force a reflow to ensure animation plays
        toast.offsetHeight;

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
        if (this._isNative()) return;

        // Ensure toast container exists and is in DOM
        if (!this.toastContainer || !this.toastContainer.parentNode) {
            this.debug("Toast container missing, recreating...");
            this.setupToastContainer();

            // Double-check after recreation
            if (!this.toastContainer || !this.toastContainer.parentNode) {
                console.error("[NotifMgr] Failed to create toast container, cannot show interactive toast");
                return;
            }
        }

        this.debug(`Showing interactive toast: [${type}] ${message}`, { actions: actions.length, countdown: countdownMs });

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
                this.debug("️ Toast countdown expired, dismissing");
                this._dismissToast(toast);
            }, countdownMs);
            toast._countdownTimer = timer;
        }

        this.toastContainer.appendChild(toast);

        // Force a reflow to ensure animation plays
        toast.offsetHeight;
    }

    _dismissToast(toast) {
        if (!toast || !toast.parentNode) return;
        if (toast._countdownTimer) clearTimeout(toast._countdownTimer);
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }

    // ==========================================
    // DEBUG & DIAGNOSTICS
    // ==========================================

    debug(message, data = null) {
        if (!this.debugMode) return;

        const timestamp = new Date().toISOString().substr(11, 12);
        if (data) {
            console.log(`[NotifMgr ${timestamp}] ${message}`, data);
        } else {
            console.log(`[NotifMgr ${timestamp}] ${message}`);
        }
    }

    /**
     * Get current connection status and diagnostics
     * Call this from browser console: notificationManager.getStatus()
     */
    getStatus() {
        const status = {
            isConnected: this.isConnected,
            socketExists: !!this.socket,
            socketConnected: this.socket ? this.socket.connected : false,
            socketId: this.socket ? this.socket.id : null,
            reconnectAttempts: this.reconnectAttempts,
            toastContainerExists: !!this.toastContainer,
            toastContainerInDOM: this.toastContainer ? !!this.toastContainer.parentNode : false,
            debugMode: this.debugMode
        };

        console.table(status);
        return status;
    }

    /**
     * Test the notification system
     * Call this from browser console: notificationManager.test()
     */
    test() {
        console.log("Testing notification system...");

        this.showToast("Test notification - Info", "info");

        setTimeout(() => {
            this.showToast("Test notification - Success", "success");
        }, 500);

        setTimeout(() => {
            this.showToast("Test notification - Error", "error");
        }, 1000);

        setTimeout(() => {
            this.showInteractiveToast(
                "Test interactive notification",
                "info",
                [
                    {
                        label: "OK",
                        className: "toast-btn-accept",
                        onClick: (toast) => {
                            console.log("Test button clicked");
                            this._dismissToast(toast);
                        }
                    }
                ],
                10000
            );
        }, 1500);

        console.log("Test notifications sent");
    }
}

// Export a single, shared instance
export const notificationManager = new NotificationManager();