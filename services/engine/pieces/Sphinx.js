
const { Piece } = require('./Piece');
class Sphinx extends Piece {
    constructor(player, orientation) {
        super(player, orientation);
        this.type = 'Sphinx';
        this.canMove = false; 
    }

    acceptLaser(laserDirection) {
        return { action: 'BLOCK' };
    }
}
module.exports = {Sphinx}                                  