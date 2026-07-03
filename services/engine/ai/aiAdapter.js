// Thin adapter between Game.js and the minimax bot.
// The bot works directly with engine state — no internal state tracking needed.

const bot = require('./smartBot');

const AI_PLAYER_ID = 1;

// Default (hard) search settings. The bot computes after a short cosmetic
// delay in Game.playAITurn, so up to ~1s here stays imperceptible.
const DEFAULT_OPTIONS = { timeLimitMs: 800, maxDepth: 6, randomness: 0 };

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

module.exports = { initializeAI, askBot, DEFAULT_OPTIONS };
