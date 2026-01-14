const { Piece } = require('./Piece');
class Pharaoh extends Piece {
    constructor(player, orientation) {
        super(player, orientation);
        this.type = 'Pharaoh';
        this.canMove = false; 
    }

    acceptLaser(laserDirection) {
        return { action: 'DESTROY' }; 
    }
}

module.exports = {Pharaoh}