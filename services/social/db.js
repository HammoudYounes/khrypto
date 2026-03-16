const { MongoClient } = require('mongodb');

let DB_NAME = null;
const FRIENDSHIPS_COLLECTION_NAME = 'friendships';
const MESSAGE_QUEUE_COLLECTION_NAME = 'message_queue';
const USERS_COLLECTION_NAME = 'users';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/khrypto';

const client = new MongoClient(MONGO_URL);

let friendships_collection;
let message_queue_collection;
let users_collection;

async function runGetStarted() {
    try {
        await client.connect();
        console.log("Successfully connected to MongoDB server");

        const khryto_db = client.db();
        friendships_collection = khryto_db.collection(FRIENDSHIPS_COLLECTION_NAME);
        message_queue_collection = khryto_db.collection(MESSAGE_QUEUE_COLLECTION_NAME);
        users_collection = khryto_db.collection(USERS_COLLECTION_NAME);
        DB_NAME = khryto_db.databaseName;

        // --- Friendships Collection Indexes ---
        // 1. Compound unique index on { requesterId, receiverId } to prevent duplicate invitations
        await friendships_collection.createIndex(
            { requesterId: 1, receiverId: 1 },
            { unique: true }
        );

        // 2. Secondary index on receiverId + status for fast lookup of pending invitations
        await friendships_collection.createIndex(
            { receiverId: 1, status: 1 }
        );

        // 3. Secondary index on status for listing accepted friendships
        await friendships_collection.createIndex(
            { status: 1 }
        );

        console.log("Successfully created indexes for friendships collection");

        // --- Message Queue Collection Indexes ---
        // 1. Secondary index on recipientId + delivered for fast retrieval of undelivered messages
        await message_queue_collection.createIndex(
            { recipientId: 1, delivered: 1 }
        );

        // 2. TTL index on createdAt to auto-expire old delivered messages (e.g., 30 days)
        // 30 days * 24 hours * 60 minutes * 60 seconds = 2592000 seconds
        await message_queue_collection.createIndex(
            { createdAt: 1 },
            { expireAfterSeconds: 2592000 }
        );

        console.log("Successfully created indexes for message_queue collection");

    } catch (error) {
        console.log(error);
    }
}

runGetStarted().catch(console.dir);

module.exports = {
    client,
    getFriendshipsCollection: () => friendships_collection,
    getMessageQueueCollection: () => message_queue_collection,
    getUsersCollection: () => users_collection
};
