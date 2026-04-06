import { TokenManager } from './tokenManager.js';

export const ProfileManager = {
    // Auto-load profile if tokens exist but sessionStorage is missing full data
    async ensureProfile() {
        const hasFullProfile = sessionStorage.getItem('username') &&
                               sessionStorage.getItem('email') &&
                               sessionStorage.getItem('elo') &&
                               sessionStorage.getItem('coins');

        if (TokenManager.getAccessToken() && !hasFullProfile) {
            await this.loadProfile();
        }
    },
    
    // Fetch from /api/profile and store
    async loadProfile() {
        const token = TokenManager.getAccessToken();
        if (!token) return false;

        try {
            const res = await fetch('/api/profile', {
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
            return false;
        } catch (error) {
            console.error("ProfileManager: Error loading profile", error);
            return false;
        }
    },
    
    // Get profile (from sessionStorage or fetch if missing)
    getUsername() {
        return sessionStorage.getItem('username') || 'Guest';
    },

    getCoins() {
        return sessionStorage.getItem('coins') || '0';
    },

    getElo() {
        return sessionStorage.getItem('elo') || '600';
    }
};
