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
      // Common items (5)
      {
        name: 'Golden Frame',
        type: 'profile_picture',
        rarity: 'common',
        assetPath: 'assets/items/golden_frame.png',
        description: 'A simple golden frame for your profile picture'
      },
      {
        name: 'Silver Border',
        type: 'profile_picture',
        rarity: 'common',
        assetPath: 'assets/items/silver_border.png',
        description: 'An elegant silver border'
      },
      {
        name: 'Laugh Emote',
        type: 'emote',
        rarity: 'common',
        assetPath: 'assets/items/emote_laugh.png',
        description: 'A simple laugh emote'
      },
      {
        name: 'Thumbs Up Emote',
        type: 'emote',
        rarity: 'common',
        assetPath: 'assets/items/emote_thumbsup.png',
        description: 'Thumbs up emote'
      },
      {
        name: 'Wave Emote',
        type: 'emote',
        rarity: 'common',
        assetPath: 'assets/items/emote_wave.png',
        description: 'A friendly wave emote'
      },

      // Rare items (3)
      {
        name: 'Neon Glow Frame',
        type: 'profile_picture',
        rarity: 'rare',
        assetPath: 'assets/items/neon_frame.png',
        description: 'A futuristic neon glowing frame'
      },
      {
        name: 'Crystal Border',
        type: 'profile_picture',
        rarity: 'rare',
        assetPath: 'assets/items/crystal_border.png',
        description: 'A shimmering crystal border'
      },
      {
        name: 'Fire Emote',
        type: 'emote',
        rarity: 'rare',
        assetPath: 'assets/items/emote_fire.png',
        description: 'A burning fire emote'
      },

      // Mythical items (2)
      {
        name: 'Diamond Crown Frame',
        type: 'profile_picture',
        rarity: 'mythical',
        assetPath: 'assets/items/diamond_crown_frame.png',
        description: 'The legendary diamond crown frame'
      },
      {
        name: 'Legendary Star Emote',
        type: 'emote',
        rarity: 'mythical',
        assetPath: 'assets/items/emote_legendary_star.png',
        description: 'A legendary star that shines with power'
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