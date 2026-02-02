const { Piece } = require('./Piece');
class Pyramid extends Piece {
    constructor(player, orientation) {
        super(player, orientation);
        this.type = 'Pyramid';
    }

    acceptLaser(laserDirection) {
        const localSide = this.getLocalSide(laserDirection);

        
        if (localSide === 0) { // Hit Front
            return { action: 'REFLECT', newDirection: (this.orientation + 1) % 4 };
        } 
        else if (localSide === 1) { // Hit Right
            return { action: 'REFLECT', newDirection: this.orientation };
        } 
        else {
            return { action: 'PASS' };
        }
    }
}
module.exports = {Pyramid}