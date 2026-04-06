// Thin adapter between Game.js and the minimax bot.
// The new bot works directly with engine state — no internal state tracking needed.

const bot = require('./smartBot');

const AI_PLAYER_ID = 1;

async function initializeAI(_gameState) {
    // No-op: bot reads current state directly, no initialization required
}

async function askBot(_humanEngineAction, currentEngineState) {
    console.log('[AI] Computing best move...');
    const bestMove = bot.getBestMove(currentEngineState, AI_PLAYER_ID, 200);
    if (!bestMove) {
        console.warn('[AI] No move found, this should not happen');
        return null;
    }
    console.log('[AI] Best move:', bestMove);
    return bestMove;
}

module.exports = { initializeAI, askBot };
