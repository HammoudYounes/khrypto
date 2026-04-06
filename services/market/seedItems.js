const { connectDB, getItemsCollection } = require('./db');

async function seedItems() {
  try {
    await connectDB();
    const itemsCollection = getItemsCollection();

    // Check if items already exist
    const count = await itemsCollection.countDocuments();
    if (count > 0) {
      console.log(`Items collection already has ${count} items. Skipping seed.`);
      return;
    }

    const items = [
      // Common emotes (5)
      {
        name: 'Flamed Scarab',
        type: 'emote',
        rarity: 'common',
        assetPath: 'assets/emotes/flamed_scarab_common.png',
        description: 'A flaming scarab emote to intimidate your opponent'
      },
      {
        name: 'GG',
        type: 'emote',
        rarity: 'common',
        assetPath: 'assets/emotes/gg_common.png',
        description: 'The classic good game emote'
      },
      {
        name: 'Haha',
        type: 'emote',
        rarity: 'common',
        assetPath: 'assets/emotes/haha_common.png',
        description: 'Laugh at your opponent with this emote'
      },
      {
        name: 'Question Marks',
        type: 'emote',
        rarity: 'common',
        assetPath: 'assets/emotes/question_marks_common.png',
        description: 'Express total confusion with this emote'
      },
      {
        name: 'Shield',
        type: 'emote',
        rarity: 'common',
        assetPath: 'assets/emotes/shield_common.png',
        description: 'Show off your defensive playstyle'
      },

      // Rare emotes (3)
      {
        name: 'EZ',
        type: 'emote',
        rarity: 'rare',
        assetPath: 'assets/emotes/ez_rare.png',
        description: 'For when the game was just too easy'
      },
      {
        name: 'MVP',
        type: 'emote',
        rarity: 'rare',
        assetPath: 'assets/emotes/mvp_rare.png',
        description: 'Claim your MVP status after a dominant performance'
      },
      {
        name: 'Sad',
        type: 'emote',
        rarity: 'rare',
        assetPath: 'assets/emotes/sad_rare.png',
        description: 'A sad emote for those heartbreaking losses'
      },

      // Mythical emotes (2)
      {
        name: 'FF',
        type: 'emote',
        rarity: 'mythical',
        assetPath: 'assets/emotes/ff_mythical.png',
        description: 'The ultimate surrender emote — make them forfeit'
      },
      {
        name: 'What A Move',
        type: 'emote',
        rarity: 'mythical',
        assetPath: 'assets/emotes/what_a_move_mythical.png',
        description: 'Celebrate an incredible play with this legendary emote'
      }
    ];

    const result = await itemsCollection.insertMany(items);
    console.log(`Successfully seeded ${result.insertedCount} items into the database`);

  } catch (error) {
    console.error("Error seeding items:", error);
    throw error;
  }
}

// Run if this file is executed directly
if (require.main === module) {
  seedItems().then(() => {
    console.log("Seed completed");
    process.exit(0);
  }).catch(err => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}

module.exports = seedItems;