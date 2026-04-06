/**
 * gameState.js
 * Global mutable state for the game using singleton pattern
 * All managers import this to access/modify shared state
 */

export const state = {
    currentGameState: null,
    selectedPiece: null, // {x, y}
    selectedReservePieceId: null, // null or player ID when reserve is clicked
    reserveOrientations: {
        0: 1,
        1: 1
    },
    myPlayerId: null,    // null for local/AI, 0 or 1 for online
    gameMode: 'local',   // 'local', 'ai', or 'online'
};
