const http = require('http');
const url = require('url');
const { connectDB, getItemsCollection, getInventoryCollection } = require('./db');
const seedItems = require('./seedItems');

const PORT = process.env.PORT || 8007;

// Initialize database and seed items on startup
connectDB().then(async () => {
  console.log("Market service database initialized");
  await seedItems();
}).catch(err => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});

// Helper function to send JSON responses
const sendResponse = (res, statusCode, data) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

// HTTP Server
const server = http.createServer(async (req, res) => {
  console.log(`Received query for market service: ${req.url}`);

  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  try {
    // GET /api/market/items
    if (pathname === '/api/market/items' && method === 'GET') {
      const itemsCollection = getItemsCollection();
      const items = await itemsCollection.find({}).toArray();
      return sendResponse(res, 200, { items });
    }

    // GET /api/market/items/rarity/:rarity
    if (pathname.startsWith('/api/market/items/rarity/') && method === 'GET') {
      const rarity = pathname.split('/').pop();
      const itemsCollection = getItemsCollection();
      const items = await itemsCollection.find({ rarity }).toArray();
      return sendResponse(res, 200, { items });
    }

    // Health check
    if (pathname === '/market/health') {
      return sendResponse(res, 200, { status: 'ok', service: 'market' });
    }

    // Not found
    sendResponse(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Error processing request:', error);
    sendResponse(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => console.log(`Market service listening on port ${PORT}`));