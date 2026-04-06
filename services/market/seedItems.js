const { connectDB, getItemsCollection } = require('./db');

async function seedItems() {
  try {
    await connectDB();
    const itemsCollection = getItemsCollection();

    // Always wipe and re-seed so changes to this file take effect immediately
    await itemsCollection.deleteMany({});
    console.log('Cleared items collection — re-seeding...');

    await itemsCollection.insertMany([
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
        },
        // Common profile pictures (4)
        {
          name: 'Ankh',
          type: 'profile_picture',
          rarity: 'common',
          assetPath: 'assets/profiles/ankh_common.png',
          description: 'The ancient symbol of life'
        },
        {
          name: 'Anubis',
          type: 'profile_picture',
          rarity: 'common',
          assetPath: 'assets/profiles/anubis_common.png',
          description: 'The god of the afterlife watches over you'
        },
        {
          name: 'Sphinx',
          type: 'profile_picture',
          rarity: 'common',
          assetPath: 'assets/profiles/sphinx_common.png',
          description: 'The enigmatic guardian of the pyramids'
        },
        {
          name: 'Pyramid',
          type: 'profile_picture',
          rarity: 'common',
          assetPath: 'assets/profiles/pyramid_common.png',
          description: 'A monument to an ancient civilization'
        },
        // Rare profile pictures (3)
        {
          name: 'Egyptian Magician',
          type: 'profile_picture',
          rarity: 'rare',
          assetPath: 'assets/profiles/egyptian_magician_rare.png',
          description: 'A master of ancient arcane arts'
        },
        {
          name: 'Solana Boat',
          type: 'profile_picture',
          rarity: 'rare',
          assetPath: 'assets/profiles/solana_boat_rare.png',
          description: 'Sailing the crypto seas'
        },
        {
          name: 'Horus',
          type: 'profile_picture',
          rarity: 'rare',
          assetPath: 'assets/profiles/horus_rare.png',
          description: 'The falcon-headed god of the sky'
        },
        // Mythical profile pictures (3)
        {
          name: 'Bitcoin Temple',
          type: 'profile_picture',
          rarity: 'mythical',
          assetPath: 'assets/profiles/bitcoin_temple_mythical.png',
          description: 'Where ancient gods meet the blockchain'
        },
        {
          name: 'Shiba',
          type: 'profile_picture',
          rarity: 'mythical',
          assetPath: 'assets/profiles/shiba_mythical.png',
          description: 'Such wow. Very rare. Much mythical.'
        },
        {
          name: 'Goat Trader',
          type: 'profile_picture',
          rarity: 'goat',
          assetPath: 'assets/profiles/goat_trader_goat.png',
          description: 'The Greatest Of All Time trader — an ultra-rare legend'
        }
      ]);
    console.log('Re-seeded all items (20 total)');

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