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

        // Global Event Listeners
        this.socket.on('friend:invitation', (payload) => {
            this.showToast(`New friend request from ${payload.senderUsername || 'someone'}!`, 'info');
            // Broadcast event to the rest of the page
            document.dispatchEvent(new CustomEvent('notification:friend_invitation', { detail: payload }));
        });

        this.socket.on('friend:accepted', (payload) => {
            this.showToast(`${payload.senderUsername || 'A user'} accepted your friend request!`, 'success');
            document.dispatchEvent(new CustomEvent('notification:friend_accepted', { detail: payload }));
        });

        this.socket.on('friend:declined', (payload) => {
            this.showToast(`${payload.senderUsername || 'A user'} declined your friend request!`, 'error');
            document.dispatchEvent(new CustomEvent('notification:friend_declined', { detail: payload }));
        });

        this.socket.on('connect_error', (err) => {
            console.error("[Notifications] WebSocket Error:", err.message);
        });
    }

    // Dynamically injects the toast container so you don't need to add it to every HTML file
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

        // Remove toast after 4 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
}

// Export a single, shared instance
export const notificationManager = new NotificationManager();