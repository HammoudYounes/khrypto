const GATEWAY_URL = '';

export const TokenManager = {
    getAccessToken: () => localStorage.getItem('accessToken'),
    getRefreshToken: () => localStorage.getItem('refreshToken'),

    setTokens: (access, refresh) => {
        if (access) localStorage.setItem('accessToken', access);
        if (refresh) localStorage.setItem('refreshToken', refresh);
    },

    clear: () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
    },

    refreshAccessToken: async () => {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) return false;

        try {
            const response = await fetch(`${GATEWAY_URL}/api/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            if (response.ok) {
                const data = await response.json();
                TokenManager.setTokens(data.accessToken, data.refreshToken);
                
                try {
                    const { ProfileManager } = await import('./profileManager.js');
                    await ProfileManager.loadProfile();
                } catch (err) {
                    console.error("Failed to load ProfileManager after token refresh", err);
                }
                
                return true;
            }
            return false;
        } catch (error) {
            console.error("TokenManager: Refresh error:", error);
            return false;
        }
    }
};