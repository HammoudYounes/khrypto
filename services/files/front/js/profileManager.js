import { TokenManager } from './tokenManager.js';

export const ProfileManager = {
    // Auto-load profile if tokens exist but sessionStorage is empty
    async ensureProfile() {
        if (TokenManager.getAccessToken() && !sessionStorage.getItem('username')) {
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
                const { username, email, elo } = await res.json();
                sessionStorage.setItem('username', username);
                sessionStorage.setItem('email', email);
                sessionStorage.setItem('elo', elo);
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
    }
};
