const http = require('http');
const db = require('./db');

const PORT = process.env.PORT || 8006;

// Start the server
const server = http.createServer(async (request, response) => {
    console.log(`Received query for social service: ${request.url}`);

    // Set CORS headers if needed for frontend direct access, though typically
    // Gateway handles this. We add basic JSON response headers for APIs.
    response.setHeader('Content-Type', 'application/json');

    if (request.url === "/api/social/health") {
        response.writeHead(200);
        response.end(JSON.stringify({ status: "ok", service: "social" }));
        return;
    }

    // Handle other routes here (e.g. /api/social/request, /api/social/accept)
    // ...

    // Default 404 for unknown routes
    response.writeHead(404);
    response.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, () => {
    console.log(`Friend service listening on port ${PORT}`);
});
