/**
 * gameState.js
 * Global mutable state for the game using singleton pattern
 * All managers import this to access/modify shared state
 */

export const state = {
    currentGameState: null,
    selectedPiece: null, // {x, y}
    reserveOrientations: {
        0: 1,
        1: 1
    }
};
