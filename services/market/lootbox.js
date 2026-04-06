const { ObjectId } = require('mongodb');
const { getItemsCollection, getInventoryCollection, getUsersCollection } = require('./db');

const LOOTBOX_PRICE = 50;
const DUPLICATE_COMPENSATION = 10;

const WEIGHTS = { common: 70, rare: 24, mythical: 5, goat: 1 };
const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

function pickRarity() {
  let random = Math.random() * TOTAL_WEIGHT;
  for (const [rarity, weight] of Object.entries(WEIGHTS)) {
    random -= weight;
    if (random <= 0) return rarity;
  }
  return 'common';
}

async function pickItem(rarity) {
  const itemsCollection = getItemsCollection();
  const available = await itemsCollection.find({ rarity }).toArray();
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

async function openLootbox(userId) {
  const usersCollection = getUsersCollection();
  const inventoryCollection = getInventoryCollection();

  const userObjectId = new ObjectId(userId);

  // Atomic balance debit — only succeeds if coins >= price
  const debitResult = await usersCollection.findOneAndUpdate(
    { _id: userObjectId, coins: { $gte: LOOTBOX_PRICE } },
    { $inc: { coins: -LOOTBOX_PRICE } },
    { returnDocument: 'after' }
  );

  if (!debitResult) {
    return { success: false, error: 'insufficient_funds' };
  }

  // Draw one item based on weighted rarity
  const rarity = pickRarity();
  const drawnItem = await pickItem(rarity);

  if (!drawnItem) {
    // No items exist for this rarity — compensate and bail
    await usersCollection.updateOne(
      { _id: userObjectId },
      { $inc: { coins: DUPLICATE_COMPENSATION } }
    );
    const updatedUser = await usersCollection.findOne({ _id: userObjectId });
    return {
      success: true,
      duplicate: true,
      item: null,
      compensation: DUPLICATE_COMPENSATION,
      newBalance: updatedUser.coins
    };
  }

  // Check if the user already owns this item
  const alreadyOwned = await inventoryCollection.findOne({ userId, itemId: drawnItem._id });

  if (alreadyOwned) {
    await usersCollection.updateOne(
      { _id: userObjectId },
      { $inc: { coins: DUPLICATE_COMPENSATION } }
    );
    const updatedUser = await usersCollection.findOne({ _id: userObjectId });
    return {
      success: true,
      duplicate: true,
      item: drawnItem,
      compensation: DUPLICATE_COMPENSATION,
      newBalance: updatedUser.coins
    };
  }

  // New item — insert into inventory
  try {
    await inventoryCollection.insertOne({
      userId,
      itemId: drawnItem._id,
      equipped: false,
      obtainedAt: new Date()
    });
  } catch (err) {
    // Race condition: another request inserted the same item — compensate instead
    if (err.code === 11000) {
      await usersCollection.updateOne(
        { _id: userObjectId },
        { $inc: { coins: DUPLICATE_COMPENSATION } }
      );
      const updatedUser = await usersCollection.findOne({ _id: userObjectId });
      return {
        success: true,
        duplicate: true,
        item: drawnItem,
        compensation: DUPLICATE_COMPENSATION,
        newBalance: updatedUser.coins
      };
    }
    throw err;
  }

  const updatedUser = await usersCollection.findOne({ _id: userObjectId });
  return {
    success: true,
    duplicate: false,
    item: drawnItem,
    newBalance: updatedUser.coins
  };
}

module.exports = { openLootbox, LOOTBOX_PRICE };
