const { MongoClient } = require('mongodb');

let DB_NAME = null;
const COLLECTION_NAME = 'socialships';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/khrypto';

const client = new MongoClient(MONGO_URL);

let socialships_collection;

async function runGetStarted() {
    try {
        await client.connect();
        console.log("Successfully connected to MongoDB server");

        const khryto_db = client.db();
        socialships_collection = khryto_db.collection(COLLECTION_NAME);
        DB_NAME = khryto_db.databaseName;

        // 1. Compound unique index on { requesterId, receiverId } to prevent duplicate invitations
        await socialships_collection.createIndex(
            { requesterId: 1, receiverId: 1 },
            { unique: true }
        );

        // 2. Secondary index on receiverId + status for fast lookup of pending invitations
        await socialships_collection.createIndex(
            { receiverId: 1, status: 1 }
        );

        // 3. Secondary index on status for listing accepted socialships
        await socialships_collection.createIndex(
            { status: 1 }
        );

        console.log("Successfully created indexes for socialships collection");

    } catch (error) {
        console.log(error);
    }
}

runGetStarted().catch(console.dir);

module.exports = {
    client,
    getFriendshipsCollection: () => socialships_collection
};
