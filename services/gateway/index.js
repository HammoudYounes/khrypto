// The http module contains methods to handle http queries.
const http = require('http');
const httpProxy = require('http-proxy');


const PORTS = {
    FILES: 'http://127.0.0.1:8001',
    ENGINE: 'http://127.0.0.1:8002',
    AUTH: 'http://127.0.0.1:8003',
    TOKEN: 'http://127.0.0.1:8004'
};

// We will need a proxy to send requests to the other services.
const proxy = httpProxy.createProxyServer();

/* The http module contains a createServer function, which takes one argument, which is the function that
** will be called whenever a new request arrives to the server.
 */
const server = http.createServer(function (request, response) {
    // First, let's check the URL to see if it's a REST request or a file request.
    // We will remove all cases of "../" in the url for security purposes.
    let filePath = request.url.split("/").filter(function (elem) {
        return elem !== "..";
    });


    try {
        // If the URL starts by /api, then it's a REST request (you can change that if you want).
        if (filePath[1] === "api") {
            if (filePath[2] === "auth") {
                console.log("Routing API request to Auth Service");
                proxy.web(request, response, { target: PORTS.AUTH });
            }
            if (filePath[2] === "refresh" || filePath[2] === "verify" || filePath[2] === "sign"){
                console.log("Routing API request to Token Service");
                proxy.web(request, response, { target: PORTS.TOKEN });
            }
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


    // For the server to be listening to request, it needs a port, which is set thanks to the listen function.
})

server.on('upgrade', function (req, socket, head) {
    console.log("Proxying WebSocket upgrade");
    proxy.ws(req, socket, head, { target: 'http://127.0.0.1:8002' });
});


server.listen(8000, () => {
    console.log("Gateway listening on port 8000");
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
    const authHeader = req.headers['authorization'];
    const refreshToken = req.headers['x-refresh-token'];
    const accessToken = authHeader && authHeader.split(' ')[1];

    if (!accessToken) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: "Token missing" }));
    }

    try {
        // 1. On vérifie l'Access Token
        const check = await callTokenService('/verify', { token: accessToken });

        if (check.valid) {
            // Token valide -> On laisse passer
            return proxy.web(req, res, { target: targetUrl });
        }

        // 2. Si invalide, on tente le Refresh
        if (refreshToken) {
            console.log("Gateway: Access expired, call the Token Service to refresh...");
            const refreshRes = await callTokenService('/refresh', { refreshToken });

            if (refreshRes.success) {
                console.log("Gateway: Refresh done ! Retry call.");

                // A. On met à jour la requête vers le backend (Engine)
                req.headers['authorization'] = `Bearer ${refreshRes.accessToken}`;

                // B. On renvoie les nouveaux tokens au Front
                res.setHeader('x-new-access-token', refreshRes.accessToken);
                res.setHeader('x-new-refresh-token', refreshRes.refreshToken);
                res.setHeader('Access-Control-Expose-Headers', 'x-new-access-token, x-new-refresh-token');

                // C. On forward la requête
                return proxy.web(req, res, { target: targetUrl });
            }
        }

        // 3. Tout a échoué
        res.writeHead(403);
        res.end(JSON.stringify({ error: "Session expired" }));

    } catch (err) {
        console.error("Token Check Error", err);
        res.writeHead(500); res.end();
    }
}