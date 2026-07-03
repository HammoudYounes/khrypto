// Thin adapter between Game.js and the minimax bot.
// The bot works directly with engine state — no internal state tracking needed.

const bot = require('./smartBot');

const AI_PLAYER_ID = 1;

// Difficulty tiers. randomness = probability of playing a top-3-but-not-best
// move (never blundering into a forced loss). The bot computes after a short
// cosmetic delay in Game.playAITurn, so up to ~1s stays imperceptible.
const TIERS = {
    easy:   { timeLimitMs: 100, maxDepth: 2, randomness: 0.45 },
    medium: { timeLimitMs: 300, maxDepth: 4, randomness: 0.15 },
    hard:   { timeLimitMs: 800, maxDepth: 6, randomness: 0 }
};

const DEFAULT_OPTIONS = TIERS.hard;

function getTierOptions(difficulty) {
    return TIERS[difficulty] || DEFAULT_OPTIONS;
}

async function initializeAI(_gameState) {
    // No-op: bot reads current state directly, no initialization required
}

async function askBot(_humanEngineAction, currentEngineState, options = DEFAULT_OPTIONS) {
    console.log('[AI] Computing best move...');
    const start = Date.now();
    const bestMove = bot.getBestMove(currentEngineState, AI_PLAYER_ID, options);
    if (!bestMove) {
        console.warn('[AI] No move found, this should not happen');
        return null;
    }
    console.log(`[AI] Best move (${Date.now() - start}ms):`, bestMove);
    return bestMove;
}

module.exports = { initializeAI, askBot, getTierOptions, TIERS, DEFAULT_OPTIONS };
