const { MongoClient } = require('mongodb');

const url = process.env.MONGO_URL || 'mongodb://mongo:27017/khrypto';
const client = new MongoClient(url);

const TARGET_USERNAME = process.argv[2] || 'daftag';
const COINS_TO_ADD = parseInt(process.argv[3] || '10000', 10);

async function run() {
    try {
        await client.connect();
        const db = client.db();
        const result = await db.collection('users').findOneAndUpdate(
            { username: TARGET_USERNAME },
            { $inc: { coins: COINS_TO_ADD } },
            { returnDocument: 'after' }
        );
        if (!result) {
            console.error(`User "${TARGET_USERNAME}" not found.`);
        } else {
            console.log(`Added ${COINS_TO_ADD} coins to "${TARGET_USERNAME}". New balance: ${result.coins}`);
        }
    } catch (e) {
        console.error('Failed:', e);
    } finally {
        await client.close();
    }
}

run();
