const DIRECTIONS = { NORTH: 0, EAST: 1, SOUTH: 2, WEST: 3 };

class Piece {
    constructor(player, orientation = DIRECTIONS.NORTH) {
        this.player = player;           // 0 or 1
        this.orientation = orientation; // 0, 1, 2, 3
        this.canMove = true;          
        this.canSwap = false;         
    }

    rotate(direction) {
        // direction: 1 (Clockwise) or -1 (Counter-Clockwise)
        this.orientation = (this.orientation + direction + 4) % 4;
    }

    /**
     * Determines what happens when a laser hits this piece.
     * @param {number} laserDirection - The direction the laser is traveling (0=N, 1=E...).
     * @returns {object} { action: 'BLOCK'|'REFLECT'|'DESTROY'|'PASS', newDirection: number|null }
     */
    acceptLaser(laserDirection) {
        return { action: 'DESTROY', newDirection: null };
    }

    /**
     * Helper to calculate which side of the piece was hit locally.
     * 0: Front, 1: Right, 2: Back, 3: Left
     */
    getLocalSide(laserDirection) {
        const entrySide = (laserDirection + 2) % 4;
        return (entrySide - this.orientation + 4) % 4;
    }
}

module.exports = { Piece, DIRECTIONS };