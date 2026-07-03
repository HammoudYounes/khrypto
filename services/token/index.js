const http = require('http');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 8004;
// Secrets come from env; the literals are a legacy fallback so existing
// deployments keep working until JWT_* env vars are set. Set them — the
// fallbacks are public in git history and unfit for anything real.
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || '0638586715';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || '0745565215';
if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    console.warn('[Token] JWT_ACCESS_SECRET / JWT_REFRESH_SECRET not set — using insecure legacy fallback secrets');
}
const ACCESS_LIFE = '75m';
const REFRESH_LIFE = '30d';
const RENEW_WINDOW = 604800; // 7 days

// Helper body parser
const getBody = (req) => new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
});

http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const { url, method } = req;
    try {
        // 1. SIGN (Appelé par le service Login)
        if ((url === '/sign' || url === '/api/sign') && method === 'POST') {
            const { userId } = await getBody(req);
            const payload = { id: userId };
            const accessToken = jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_LIFE });
            const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_LIFE });
            console.log(`Token Service: Generated tokens for user (ID: ${userId})`);
            res.writeHead(200);
            return res.end(JSON.stringify({ accessToken, refreshToken }));
        }

        // 2. VERIFY (Vérification simple pour le Gateway)
        if (url === '/verify' && method === 'POST') {
            const { token } = await getBody(req);
            try {
                const decodedPayload = jwt.verify(token, ACCESS_SECRET);
                const userId = decodedPayload.id || decodedPayload.userId;
                if (!userId) throw new Error("Invalid token payload");
                res.writeHead(200);
                // Return valid: true and the userId that was encoded in the token
                return res.end(JSON.stringify({ valid: true, userId: userId }));
            } catch (e) {
                res.writeHead(200);
                return res.end(JSON.stringify({ valid: false }));
            }
        }

        // 3. REFRESH (Renouvellement intelligent)
        if ((url === '/refresh' || url === '/api/refresh') && method === 'POST') {
            const { refreshToken } = await getBody(req);
            try {
                const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
                const userId = decoded.id || decoded.userId;
                if (!userId) throw new Error("Invalid token payload");
                const payload = { id: userId };

                // Nouvel Access Token (Toujours)
                const newAccess = jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_LIFE });

                // Gestion du Refresh Token (Sliding window)
                let newRefresh = refreshToken;
                const now = Math.floor(Date.now() / 1000);

                // Si expiration dans < 7 jours
                if (decoded.exp - now < RENEW_WINDOW) {
                    console.log("Token Service: Refresh Token renouvelé (Zone < 7j)");
                    newRefresh = jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_LIFE });
                }

                res.writeHead(200);
                return res.end(JSON.stringify({ success: true, accessToken: newAccess, refreshToken: newRefresh }));
            } catch (e) {
                res.writeHead(403);
                return res.end(JSON.stringify({ error: "Invalid Refresh Token" }));
            }
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: "Endpoint inconnu" }));

    } catch (e) {
        console.error(e);
        res.writeHead(500); res.end();
    }
}).listen(PORT, () => console.log(`Token Service running on port ${PORT}`));