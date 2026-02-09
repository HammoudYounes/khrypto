// Auto-login logic on page load
document.addEventListener('DOMContentLoaded', async () => {
    const startTime = Date.now();
    const MIN_LOADING_TIME = 1000; // 3 secondes minimum

    const accessToken = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');

    // Fonction pour attendre le temps minimum avant de rediriger
    const redirectWithMinDelay = async (url) => {
        const elapsedTime = Date.now() - startTime;
        const remainingTime = MIN_LOADING_TIME - elapsedTime;

        if (remainingTime > 0) {
            await new Promise(resolve => setTimeout(resolve, remainingTime));
        }

        window.location.href = url;
    };

    // Si aucun token, rediriger vers auth page
    if (!accessToken && !refreshToken) {
        await redirectWithMinDelay('./authPage/index.html');
        return;
    }

    // Si tokens présents, vérifier avec le backend
    try {
        const response = await fetch('/api/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: accessToken })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.valid) {
                // Token valide, rediriger vers home
                await redirectWithMinDelay('./homePage/index.html');
                return;
            }
        }

        // Token invalide, essayer de refresh
        const refreshResponse = await fetch('/api/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });

        if (refreshResponse.ok) {
            const refreshResult = await refreshResponse.json();
            if (refreshResult.success && refreshResult.accessToken) {
                localStorage.setItem('accessToken', refreshResult.accessToken);
                localStorage.setItem('refreshToken', refreshResult.refreshToken);
                await redirectWithMinDelay('./homePage/index.html');
                return;
            }
        }

        // Échec de vérification et refresh, rediriger vers auth page
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        await redirectWithMinDelay('./authPage/index.html');

    } catch (error) {
        console.error('Auto-login error:', error);
        await redirectWithMinDelay('./authPage/index.html');
    }
});
