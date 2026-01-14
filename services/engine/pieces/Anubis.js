class Anubis extends Piece {
    constructor(player, orientation) {
        super(player, orientation);
        this.type = 'Anubis';
    }

    acceptLaser(laserDirection) {
        const localSide = this.getLocalSide(laserDirection);

        if (localSide === 0) {
            return { action: 'BLOCK' };
        } else {
            return { action: 'PASS' }; 
        }
    }
}