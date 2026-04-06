const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');
const { connectDB, getItemsCollection, getInventoryCollection, getUsersCollection } = require('./db');
const seedItems = require('./seedItems');
const { openLootbox, LOOTBOX_PRICE } = require('./lootbox');

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
    // Serve static assets: GET /api/market/assets/**
    if (method === 'GET' && pathname.startsWith('/api/market/assets/')) {
      const relativePath = pathname.replace('/api/market/', '');
      const filePath = path.join(__dirname, relativePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.gif': 'image/gif' };
      if (!mimeTypes[ext]) return sendResponse(res, 415, { error: 'Unsupported media type' });
      if (!fs.existsSync(filePath)) return sendResponse(res, 404, { error: 'Asset not found' });
      res.writeHead(200, { 'Content-Type': mimeTypes[ext], 'Cache-Control': 'public, max-age=86400' });
      return fs.createReadStream(filePath).pipe(res);
    }

    const userId = req.headers['x-user-id'];

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

    // GET /api/market/avatar/:username — public, returns equipped profile picture
    if (pathname.startsWith('/api/market/avatar/') && method === 'GET') {
      const username = decodeURIComponent(pathname.split('/api/market/avatar/')[1]);
      if (!username) return sendResponse(res, 400, { error: 'Username required' });
      const usersCollection = getUsersCollection();
      const user = await usersCollection.findOne({ username }, { projection: { _id: 1 } });
      if (!user) return sendResponse(res, 404, { error: 'User not found' });
      const userIdStr = user._id.toString();
      const inventoryCollection = getInventoryCollection();
      const itemsCollection = getItemsCollection();
      const entry = await inventoryCollection.findOne({ userId: userIdStr, equipped: true });
      if (!entry) return sendResponse(res, 200, { assetPath: null });
      const item = await itemsCollection.findOne({ _id: entry.itemId, type: 'profile_picture' });
      return sendResponse(res, 200, { assetPath: item ? item.assetPath : null });
    }

    // GET /api/market/balance
    if (pathname === '/api/market/balance' && method === 'GET') {
      if (!userId) return sendResponse(res, 401, { error: 'Unauthorized' });
      const usersCollection = getUsersCollection();
      const user = await usersCollection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { coins: 1 } }
      );
      if (!user) return sendResponse(res, 404, { error: 'User not found' });
      return sendResponse(res, 200, { coins: user.coins ?? 0 });
    }

    // GET /api/market/inventory
    if (pathname === '/api/market/inventory' && method === 'GET') {
      if (!userId) return sendResponse(res, 401, { error: 'Unauthorized' });
      const inventoryCollection = getInventoryCollection();
      const itemsCollection = getItemsCollection();
      const entries = await inventoryCollection.find({ userId }).toArray();
      const itemIds = entries.map(e => e.itemId);
      const items = await itemsCollection.find({ _id: { $in: itemIds } }).toArray();
      const itemMap = Object.fromEntries(items.map(i => [i._id.toString(), i]));
      const inventory = entries.map(e => ({
        ...itemMap[e.itemId.toString()],
        equipped: e.equipped,
        obtainedAt: e.obtainedAt
      }));
      return sendResponse(res, 200, { inventory });
    }

    // POST /api/market/buy-lootbox
    if (pathname === '/api/market/buy-lootbox' && method === 'POST') {
      if (!userId) return sendResponse(res, 401, { error: 'Unauthorized' });
      const result = await openLootbox(userId);
      if (!result.success) {
        if (result.error === 'insufficient_funds') {
          return sendResponse(res, 402, { error: 'Not enough coins', required: LOOTBOX_PRICE });
        }
        return sendResponse(res, 500, { error: 'Lootbox opening failed' });
      }
      return sendResponse(res, 200, result);
    }

    // POST /api/market/equip
    if (pathname === '/api/market/equip' && method === 'POST') {
      if (!userId) return sendResponse(res, 401, { error: 'Unauthorized' });
      let body = '';
      req.on('data', chunk => { body += chunk; });
      await new Promise(resolve => req.on('end', resolve));
      const { itemId } = JSON.parse(body);
      if (!itemId) return sendResponse(res, 400, { error: 'itemId required' });

      const inventoryCollection = getInventoryCollection();
      const itemsCollection = getItemsCollection();

      const entry = await inventoryCollection.findOne({ userId, itemId: new ObjectId(itemId) });
      if (!entry) return sendResponse(res, 404, { error: 'Item not in inventory' });

      const item = await itemsCollection.findOne({ _id: new ObjectId(itemId) });
      if (!item) return sendResponse(res, 404, { error: 'Item not found' });

      // Unequip all items of the same type, then equip the target
      await inventoryCollection.updateMany(
        { userId, itemId: { $in: (await itemsCollection.find({ type: item.type }).toArray()).map(i => i._id) } },
        { $set: { equipped: false } }
      );
      await inventoryCollection.updateOne(
        { userId, itemId: new ObjectId(itemId) },
        { $set: { equipped: true } }
      );
      return sendResponse(res, 200, { success: true });
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