// The http module contains methods to handle http queries.
const http = require('http');
const httpProxy = require('http-proxy');


const PORTS = {
    FILES: process.env.FILES_URL || 'http://127.0.0.1:8001',
    ENGINE: process.env.ENGINE_URL || 'http://127.0.0.1:8002',
    AUTH: process.env.AUTH_URL || 'http://127.0.0.1:8003',
    TOKEN: process.env.TOKEN_URL || 'http://127.0.0.1:8004',
    MATCHMAKING: process.env.MATCHMAKING_URL || 'http://127.0.0.1:8005'
};

const proxy = httpProxy.createProxyServer();

// Handle proxy errors gracefully to prevent crashes
proxy.on('error', (err, req, res) => {
    console.error('Proxy Error:', err.message);
    if (res && res.writeHead) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service temporarily unavailable' }));
    }
});

const server = http.createServer(function (request, response) {

    let filePath = request.url.split("/").filter(function (elem) {
        return elem !== "..";
    });


    try {
        if (filePath[1] === "api") {
            if (filePath[2] === "auth") {
                console.log("Routing API request to Auth Service");
                proxy.web(request, response, { target: PORTS.AUTH });
            }
            if (filePath[2] === "refresh" || filePath[2] === "verify" || filePath[2] === "sign") {
                console.log("Routing API request to Token Service");
                proxy.web(request, response, { target: PORTS.TOKEN });
            }
        }
        else if (filePath[1] === "matchmaking") {
            // Matchmaking Socket.IO or API requests
            console.log("Routing to Matchmaking Service");
            return proxyWithTokenCheck(request, response, PORTS.MATCHMAKING);
        }
        else if (filePath[1] === "socket.io") {
            return proxyWithTokenCheck(request, response, PORTS.ENGINE);
        }
        else {
            console.log("Request for a file received, transferring to the file service")
            proxy.web(request, response, { target: PORTS.FILES });
        }
    } catch (error) {
        console.log(`error while processing ${request.url}: ${error}`)
        response.statusCode = 400;
        response.end(`Something in your request (${request.url}) is strange...`);
    }


})

server.on('upgrade', async function (req, socket, head) {
    // Route WebSocket upgrades to the correct service
    if (req.url.startsWith('/matchmaking/')) {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const token = urlObj.searchParams.get('token');

        // Verify via Gateway's helper
        const check = await callTokenService('/verify', { token });

        if (check.valid && check.userId) {
            // Inject userId into a custom header for the Matchmaking service
            req.headers['x-user-id'] = check.userId;
            console.log("Proxying WebSocket upgrade to Matchmaking");
            proxy.ws(req, socket, head, { target: PORTS.MATCHMAKING });
        } else {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
        }
    } else {
        console.log("Proxying WebSocket upgrade to Engine");
        proxy.ws(req, socket, head, { target: PORTS.ENGINE });
    }
});


const PORT = process.env.PORT || 8000;

server.listen(PORT, () => {
    console.log(`Gateway listening on port ${PORT}`);
});



// --- FONCTION D'APPEL AU SERVICE TOKEN ---
function callTokenService(path, body) {
    return new Promise((resolve, reject) => {
        const tokenUrl = new URL(PORTS.TOKEN);

        const options = {
            hostname: tokenUrl.hostname,
            port: tokenUrl.port,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(JSON.stringify(body))
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve({}); }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(JSON.stringify(body));
        req.end();
    });
}

// --- LE "SMART PROXY" (Middleware Token) ---
async function proxyWithTokenCheck(req, res, targetUrl) {
    let accessToken = null;

    // 1. Recherche du Token (Header ou Query)
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        accessToken = authHeader.split(' ')[1];
    } else {
        try {
            // Support pour Socket.IO via Query Param
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            accessToken = urlObj.searchParams.get('token');
        } catch (e) { }
    }

    // 2. Si pas de token, on jette
    if (!accessToken) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "Token missing" }));
    }

    try {
        // 3. Vérification simple (Est-ce qu'il est valide ?)
        const check = await callTokenService('/verify', { token: accessToken });

        if (check.valid) {
            if (check.userId) {
                req.headers['x-user-id'] = check.userId;
            }
            // OUI -> On laisse passer vers l'Engine ou Matchmaking
            return proxy.web(req, res, { target: targetUrl });
        } else {
            // NON -> Erreur 401. Le Front devra faire le refresh lui-même via /api/refresh
            console.log("Gateway: Token expired. Rejected (401).");
            res.writeHead(401);
            return res.end(JSON.stringify({ error: "Token expired" }));
        }

    } catch (err) {
        console.error("Gateway Check Error", err);
        res.writeHead(500); res.end();
    }
}