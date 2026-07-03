/**
 * Simple in-process token bucket rate limiter.
 * capacity = max burst, refillPerSec = sustained rate.
 */
class TokenBucket {
    constructor(capacity, refillPerSec) {
        this.capacity = capacity;
        this.refillPerSec = refillPerSec;
        this.tokens = capacity;
        this.lastRefill = Date.now();
    }

    tryRemove() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
        this.lastRefill = now;

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    }
}

/**
 * Per-socket limiter bundle. Tracks violations so grossly abusive
 * sockets can be disconnected instead of just throttled.
 */
class SocketLimiter {
    constructor() {
        this.buckets = {
            action: new TokenBucket(5, 2),   // player:action
            misc: new TokenBucket(10, 0.5),  // create / join / restart / leave
            emoji: new TokenBucket(3, 1)     // emote relay
        };
        this.violations = 0;
    }

    /**
     * @returns {'ok' | 'limited' | 'abusive'}
     */
    check(bucketName) {
        const bucket = this.buckets[bucketName];
        if (!bucket || bucket.tryRemove()) return 'ok';

        this.violations += 1;
        return this.violations > 30 ? 'abusive' : 'limited';
    }
}

module.exports = { TokenBucket, SocketLimiter };
