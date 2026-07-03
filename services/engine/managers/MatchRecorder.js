/**
 * MatchRecorder — persistent audit trail for online matches.
 * Writes incrementally so a crash mid-game still leaves evidence.
 * This collection is the substrate future integrity work (collusion/bot
 * detection, escrow result attestation) will consume.
 */
class MatchRecorder {
    constructor() {
        this.collection = null;
    }

    setCollection(collection) {
        this.collection = collection;
        collection.createIndex({ gameId: 1 }, { unique: true }).catch(err => {
            console.error('[MatchRecorder] Failed to create index:', err.message);
        });
    }

    async createMatch(game) {
        if (!this.collection) return;
        try {
            await this.collection.insertOne({
                gameId: game.id,
                mode: game.mode,
                users: { 0: game.userIds[0], 1: game.userIds[1] },
                elosBefore: { 0: game.elos[0], 1: game.elos[1] },
                createdAt: new Date(),
                status: 'active',
                moves: []
            });
        } catch (e) {
            console.error(`[MatchRecorder] Failed to create match ${game.id}:`, e.message);
        }
    }

    async recordMove(gameId, playerId, action, turnCount) {
        if (!this.collection) return;
        try {
            await this.collection.updateOne(
                { gameId },
                { $push: { moves: { p: playerId, action, turnCount, t: new Date() } } }
            );
        } catch (e) {
            console.error(`[MatchRecorder] Failed to record move for ${gameId}:`, e.message);
        }
    }

    async finishMatch(game, reason) {
        if (!this.collection) return;
        try {
            await this.collection.updateOne(
                { gameId: game.id },
                {
                    $set: {
                        status: 'finished',
                        result: { 0: game.state.winner[0], 1: game.state.winner[1], reason },
                        elosAfter: { 0: game.elos[0], 1: game.elos[1] },
                        endedAt: new Date()
                    }
                }
            );
        } catch (e) {
            console.error(`[MatchRecorder] Failed to finish match ${game.id}:`, e.message);
        }
    }

    /** A restart reuses the gameId, so archive the old record under a new id. */
    async archiveForRestart(gameId) {
        if (!this.collection) return;
        try {
            await this.collection.updateOne(
                { gameId },
                [{ $set: { gameId: { $concat: ['$gameId', '_r', { $toString: { $toLong: '$$NOW' } }] }, status: 'restarted' } }]
            );
        } catch (e) {
            console.error(`[MatchRecorder] Failed to archive match ${gameId}:`, e.message);
        }
    }
}

module.exports = MatchRecorder;
