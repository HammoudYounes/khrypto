import { TokenManager, ApiHost } from './tokenManager.js';

// On Capacitor native, sessionStorage is wiped on every page navigation,
// so we fall back to localStorage scoped with a prefix.
const isNative = !!(window.Capacitor && window.Capacitor.getPlatform() !== 'web');
const _profileStorage = {
    getItem: (k) => isNative ? localStorage.getItem('profile_' + k) : sessionStorage.getItem(k),
    setItem: (k, v) => isNative ? localStorage.setItem('profile_' + k, v) : sessionStorage.setItem(k, v),
    removeItem: (k) => isNative ? localStorage.removeItem('profile_' + k) : sessionStorage.removeItem(k),
};

export const ProfileManager = {
    async ensureProfile() {
        const hasFullProfile = _profileStorage.getItem('username') &&
                               _profileStorage.getItem('email') &&
                               _profileStorage.getItem('elo') &&
                               _profileStorage.getItem('coins');

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
                _profileStorage.setItem('username', username);
                _profileStorage.setItem('email', email);
                _profileStorage.setItem('elo', elo);
                _profileStorage.setItem('coins', coins);
                return true;
            }
            return false;
        } catch (error) {
            console.error("ProfileManager: Error loading profile", error);
            return false;
        }
    },

    clearProfile() {
        ['username', 'email', 'elo', 'coins'].forEach(k => _profileStorage.removeItem(k));
    },

    getUsername() { return _profileStorage.getItem('username') || 'Guest'; },
    getCoins()    { return _profileStorage.getItem('coins')    || '0'; },
    getElo()      { return _profileStorage.getItem('elo')      || '600'; },
};
