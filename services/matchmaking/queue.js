/**
 * queue.js
 * Simple FIFO matchmaking queue.
 * Phase 1: pairs the first two players who join.
 * Phase 2: replace with ELO-based matching logic.
 */

class MatchmakingQueue {
    constructor() {
        this.waiting = []; // Array of { socket, userId, username, elo, joinedAt }
    }

    /**
     * Add a player to the queue.
     * @param {object} socket - The Socket.IO socket
     * @param {string} userId - The authenticated user's ID
     * @param {string} username - The user's username
     * @param {number} elo - The user's Elo rating
     */
    add(socket, userId, username = 'Player', elo = 600) {
        // Prevent duplicate entries
        if (this.waiting.some(entry => entry.socket.id === socket.id)) {
            console.log(`[Queue] Socket ${socket.id} already in queue, skipping.`);
            return;
        }
        this.waiting.push({ socket, userId, username, elo, joinedAt: Date.now() });
        console.log(`[Queue] Player added (${username}, Elo: ${elo}). Queue size: ${this.waiting.length}`);
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
     * Calculate a specific player's current accepted Elo tolerance based on time waited.
     * Base = 50. Widens by X every 15s. X = 25, 50, 75...
     * @param {object} player - Queue entry
     * @param {number} now - Current timestamp 
     * @returns {number}
     */
    getAcceptedRange(player, now) {
        const n = Math.floor((now - player.joinedAt) / 15000); // 15 seconds intervals
        if (n <= 0) return 50;

        // Sum of arithmetic progression for added tolerance: 25 * (1 + 2 + ... + n)
        return 50 + 25 * (n * (n + 1) / 2);
    }

    /**
     * Try to find a match by comparing Elo ranges in O(N^2). Returns two matched entries if possible, null otherwise.
     * @returns {[object, object] | null}
     */
    findMatch() {
        if (this.waiting.length < 2) return null;

        const now = Date.now();

        // Check combinations starting with the player that has waited the longest
        for (let i = 0; i < this.waiting.length; i++) {
            const p1 = this.waiting[i];
            const p1Range = this.getAcceptedRange(p1, now);

            for (let j = i + 1; j < this.waiting.length; j++) {
                const p2 = this.waiting[j];
                const p2Range = this.getAcceptedRange(p2, now);

                const eloDiff = Math.abs(p1.elo - p2.elo);

                // Both players must mutually accept the Elo difference
                if (eloDiff <= p1Range && eloDiff <= p2Range) {
                    console.log(`[Queue] Match found! ${p1.username}(${p1.elo}) [±${p1Range}] vs ${p2.username}(${p2.elo}) [±${p2Range}] (Diff: ${eloDiff})`);

                    // Remove both from the queue
                    // Remove j first so array shifting doesn't mess up i's index execution (j > i)
                    this.waiting.splice(j, 1);
                    this.waiting.splice(i, 1);

                    return [p1, p2];
                }
            }
        }
        return null;
    }

    get size() {
        return this.waiting.length;
    }

    /**
     * Returns an array of players waiting to update their UI with the current searching range.
     * @returns {Array<{socket: object, eloRange: number}>}
     */
    getWaitingPlayersRanges() {
        const now = Date.now();
        return this.waiting.map(p => ({
            socket: p.socket,
            eloRange: this.getAcceptedRange(p, now)
        }));
    }
}

module.exports = MatchmakingQueue;
