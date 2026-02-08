const http = require('http');
const jwt = require('jsonwebtoken');

const PORT = 8004;
const ACCESS_SECRET = '0638586715';
const REFRESH_SECRET = '0745565215';
const ACCESS_LIFE = '10s';
const REFRESH_LIFE = '60s';
const RENEW_WINDOW = 50; // 7 jours

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
        if (url === '/sign' && method === 'POST') {
            const user = await getBody(req);
            const accessToken = jwt.sign(user, ACCESS_SECRET, { expiresIn: ACCESS_LIFE });
            const refreshToken = jwt.sign(user, REFRESH_SECRET, { expiresIn: REFRESH_LIFE });
            res.writeHead(200);
            return res.end(JSON.stringify({ accessToken, refreshToken }));
        }

        // 2. VERIFY (Vérification simple pour le Gateway)
        if (url === '/verify' && method === 'POST') {
            const { token } = await getBody(req);
            try {
                jwt.verify(token, ACCESS_SECRET);
                res.writeHead(200);
                return res.end(JSON.stringify({ valid: true }));
            } catch (e) {
                res.writeHead(200);
                return res.end(JSON.stringify({ valid: false }));
            }
        }

        // 3. REFRESH (Renouvellement intelligent)
        if ((url === '/refresh' || url === '/api/refresh') && method === 'POST') {
            console.log("HALLOOOO")
            const { refreshToken } = await getBody(req);
            try {
                const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
                const payload = { id: decoded.id, role: decoded.role, username: decoded.username };

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