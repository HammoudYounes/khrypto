/**
 * networkManager.js
 * Manages Socket.io connection and all outgoing network communication
 */

import { state } from './gameState.js';

// Initialize socket connection
export const socket = io("http://localhost:8000", {
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

// PLACE action
export function sendPlaceAction(x, y, orientation, playerId) {
    console.log(`Sending PLACE action at (${x}, ${y}) for Player ${playerId}`);

    socket.emit('player:action', {
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