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

module.exports = TokenBucket;
