/**
 * networkManager.js
 * Manages Socket.io connection and all outgoing network communication
 */

import { state } from './gameState.js';
import { gameId } from './index.js';
import { TokenManager } from "../js/tokenManager.js";

// 1. Socket Configuration (Manual Connect)
export const socket = io({
    autoConnect: false,
    auth: (cb) => {
        // Called on every connection attempt
        cb({ token: TokenManager.getAccessToken() });
    }
});

// 2. Initialization Routine (Called on page load)
export async function initializeConnection() {
    let accessToken = TokenManager.getAccessToken();
    const refreshToken = TokenManager.getRefreshToken();

    // Scenario: Access Token missing/expired, but Refresh Token exists
    if (!accessToken && refreshToken) {
        console.log("Stale session detected. Attempting to restore...");
        const refreshed = await TokenManager.refreshAccessToken();
        if (refreshed) {
            accessToken = TokenManager.getAccessToken(); // Update local var
        }
    }

    // Final check
    if (!accessToken) {
        console.log("No valid session found. Redirecting to Login.");
        TokenManager.clear();
        window.location.href = '../index.html';
        return;
    }

    console.log("Initiating Socket connection...");
    socket.connect();
}

// 3. Error Handling (Safety net during gameplay)
socket.on("connect_error", async (err) => {
    console.log(" Connection rejected by server:", err.message);

    // Assuming rejection is due to expired token -> Try Refresh
    const refreshed = await TokenManager.refreshAccessToken();

    if (refreshed) {
        console.log("Token refreshed! Retrying socket connection...");
        // Short delay to ensure storage sync
        setTimeout(() => {
            socket.connect();
        }, 100);
    } else {
        console.log("Fatal session error. Logging out.");
        TokenManager.clear();
        window.location.href = '../index.html';
    }
});

socket.on("connect", () => {
    console.log(" Connected to Game Server! Socket ID:", socket.id);
});

// PLACE action
export function sendPlaceAction(x, y, orientation, playerId) {
    console.log(`Sending PLACE action at (${x}, ${y}) for Player ${playerId}`);

    socket.emit('player:action', {
        gameId : gameId, 
        playerId: playerId,
        action: {
            type: 'PLACE',
            x: x,
            y: y,
            orientation: orientation
        }
    });
}

// ROTATE action
export function sendRotateAction(x, y, direction) {
    const playerId = state.currentGameState.turn;

    console.log(`Envoi Rotation -> X:${x}, Y:${y}, Sens:${direction}`);

    socket.emit('player:action', {
        gameId : gameId, 
        playerId: playerId,
        action: {
            type: 'ROTATE',
            x: x,
            y: y,
            direction: direction
        }
    });
}

// MOVE action
export function sendMoveAction(originX, originY, destX, destY) {
    const playerId = state.currentGameState.turn;

    console.log(`Envoi Move : (${originX},${originY}) vers (${destX},${destY})`);

    socket.emit('player:action', {
        gameId : gameId, 
        playerId: playerId,
        action: {
            type: 'MOVE',
            x: originX,     
            y: originY,
            destX: destX,   
            destY: destY
        }
    });
}

// SWAP action
export function sendSwapAction(x, y, targetX, targetY, playerId) {
    console.log(`Sending SWAP action: (${x},${y}) <-> (${targetX},${targetY}) for Player ${playerId}`);
    socket.emit('player:action', {
        gameId : gameId, 
        playerId: playerId,
        action: {
            type: 'SWAP',
            x: x,
            y: y,
            targetX: targetX,
            targetY: targetY
        }
    });
}