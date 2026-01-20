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