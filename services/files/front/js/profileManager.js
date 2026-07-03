import { TokenManager, ApiHost } from './tokenManager.js';

export const ProfileManager = {
    async ensureProfile() {
        const hasFullProfile = sessionStorage.getItem('username') &&
                               sessionStorage.getItem('email') &&
                               sessionStorage.getItem('elo') &&
                               sessionStorage.getItem('coins');

        if (TokenManager.getAccessToken() && !hasFullProfile) {
            await this.loadProfile();
        }
    },

    async loadProfile() {
        const token = TokenManager.getAccessToken();
        if (!token) return false;

        try {
            const res = await fetch(`${ApiHost.getHost()}/api/profile`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                const { username, email, elo, coins } = await res.json();
                sessionStorage.setItem('username', username);
                sessionStorage.setItem('email', email);
                sessionStorage.setItem('elo', elo);
                sessionStorage.setItem('coins', coins);
                return true;
            }

            // Token is valid but the account no longer exists (e.g. stale
            // session against a reset database) — force a clean logout.
            if (res.status === 404) {
                console.warn('ProfileManager: account not found for stored session — clearing tokens');
                TokenManager.clear();
                this.clearProfile();
                window.location.href = '/authPage/index.html';
            }
            return false;
        } catch (error) {
            console.error("ProfileManager: Error loading profile", error);
            return false;
        }
    },

    clearProfile() {
        ['username', 'email', 'elo', 'coins'].forEach(k => sessionStorage.removeItem(k));
    },

    getUsername() { return sessionStorage.getItem('username') || 'Guest'; },
    getCoins()    { return sessionStorage.getItem('coins')    || '0'; },
    getElo()      { return sessionStorage.getItem('elo')      || '600'; },
};
