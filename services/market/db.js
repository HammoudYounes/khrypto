const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/khrypto';

const client = new MongoClient(MONGO_URL);

let db;
let itemsCollection;
let inventoryCollection;
let usersCollection;

async function connectDB() {
  try {
    await client.connect();
    console.log("Successfully connected to MongoDB server");

    db = client.db();

    // Initialize collections
    itemsCollection = db.collection('items');
    inventoryCollection = db.collection('inventory');
    usersCollection = db.collection('users');

    // Create indexes for items collection
    await itemsCollection.createIndex({ rarity: 1 });
    console.log("Created index on items.rarity");

    // Create indexes for inventory collection
    await inventoryCollection.createIndex({ userId: 1, itemId: 1 }, { unique: true });
    console.log("Created unique index on inventory.userId + itemId");

    await inventoryCollection.createIndex({ userId: 1, equipped: 1 });
    console.log("Created index on inventory.userId + equipped");

  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    throw error;
  }
}

function getItemsCollection() {
  return itemsCollection;
}

function getInventoryCollection() {
  return inventoryCollection;
}

function getUsersCollection() {
  return usersCollection;
}

module.exports = {
  connectDB,
  getItemsCollection,
  getInventoryCollection,
  getUsersCollection,
  client
};