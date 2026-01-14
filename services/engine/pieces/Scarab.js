const { Piece } = require('./Piece');
class Scarab extends Piece {
    constructor(player, orientation) {
        super(player, orientation);
        this.type = 'Scarab';
        this.canSwap = true; 
    }

    acceptLaser(laserDirection) {
        const localSide = this.getLocalSide(laserDirection);


        if (localSide === 0) return { action: 'REFLECT', newDirection: (this.orientation + 1) % 4 };
        if (localSide === 1) return { action: 'REFLECT', newDirection: this.orientation };
        if (localSide === 2) return { action: 'REFLECT', newDirection: (this.orientation + 3) % 4 };
        if (localSide === 3) return { action: 'REFLECT', newDirection: (this.orientation + 2) % 4 };
    }
}
module.exports = {Scarab}