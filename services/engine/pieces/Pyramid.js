class Pyramid extends Piece {
    constructor(player, orientation) {
        super(player, orientation);
        this.type = 'Pyramid';
    }

    acceptLaser(laserDirection) {
        const localSide = this.getLocalSide(laserDirection);

        // Reflection Logic for Diagonal Mirror [/] (Front+Right reflective)
        // If hit on Front (0) -> Reflects to Right relative to piece (Global: Orientation + 1)
        // If hit on Right (1) -> Reflects to Front relative to piece (Global: Orientation + 0)
        
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