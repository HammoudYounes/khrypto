class Scarab extends Piece {
    constructor(player, orientation) {
        super(player, orientation);
        this.type = 'Scarab';
        this.canSwap = true; // Rule Can swap with Sphinx/Pharaoh
    }

    acceptLaser(laserDirection) {
        const localSide = this.getLocalSide(laserDirection);

        // Dual Mirror Logic: [/] and [\] combined.
        // Front(0) -> Right(1) | Right(1) -> Front(0)
        // Back(2) -> Left(3)   | Left(3) -> Back(2)

        if (localSide === 0) return { action: 'REFLECT', newDirection: (this.orientation + 1) % 4 };
        if (localSide === 1) return { action: 'REFLECT', newDirection: this.orientation };
        if (localSide === 2) return { action: 'REFLECT', newDirection: (this.orientation + 3) % 4 };
        if (localSide === 3) return { action: 'REFLECT', newDirection: (this.orientation + 2) % 4 };
    }
}