const http = require('http');
const db = require('./db');

const PORT = process.env.PORT || 8006;

// Start the server
const server = http.createServer(async (request, response) => {
    console.log(`Received query for friend service: ${request.url}`);

    // Set CORS headers if needed for frontend direct access, though typically
    // Gateway handles this. We add basic JSON response headers for APIs.
    response.setHeader('Content-Type', 'application/json');

    if (request.url === "/api/friend/health") {
        response.writeHead(200);
        response.end(JSON.stringify({ status: "ok", service: "friend" }));
        return;
    }

    // Handle other routes here (e.g. /api/friend/request, /api/friend/accept)
    // ...

    // Default 404 for unknown routes
    response.writeHead(404);
    response.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, () => {
    console.log(`Friend service listening on port ${PORT}`);
});
