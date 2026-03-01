/**
 * queue.js
 * Simple FIFO matchmaking queue.
 * Phase 1: pairs the first two players who join.
 * Phase 2: replace with ELO-based matching logic.
 */

class MatchmakingQueue {
    constructor() {
        this.waiting = []; // Array of { socket, userId }
    }

    /**
     * Add a player to the queue.
     * @param {object} socket - The Socket.IO socket
     * @param {string} userId - The authenticated user's ID
     */
    add(socket, userId) {
        // Prevent duplicate entries
        if (this.waiting.some(entry => entry.socket.id === socket.id)) {
            console.log(`[Queue] Socket ${socket.id} already in queue, skipping.`);
            return;
        }
        this.waiting.push({ socket, userId });
        console.log(`[Queue] Player added. Queue size: ${this.waiting.length}`);
    }

    /**
     * Remove a player from the queue by socket ID.
     * @param {string} socketId
     */
    remove(socketId) {
        const before = this.waiting.length;
        this.waiting = this.waiting.filter(entry => entry.socket.id !== socketId);
        if (this.waiting.length < before) {
            console.log(`[Queue] Player removed. Queue size: ${this.waiting.length}`);
        }
    }

    /**
     * Try to find a match. Returns two entries if possible, null otherwise.
     * @returns {[object, object] | null}
     */
    findMatch() {
        if (this.waiting.length >= 2) {
            const player1 = this.waiting.shift();
            const player2 = this.waiting.shift();
            console.log(`[Queue] Match found! Queue size: ${this.waiting.length}`);
            return [player1, player2];
        }
        return null;
    }

    get size() {
        return this.waiting.length;
    }
}

module.exports = MatchmakingQueue;
