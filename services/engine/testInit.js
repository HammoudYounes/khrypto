const { initializeBoard } = require('./initBoard');

function testBoardInitialization() {
    console.log("Starting Board Initialization Tests (1000 iterations)...");
    
    const iterations = 1000;
    let errors = [];

    for (let i = 0; i < iterations; i++) {
        const board = initializeBoard();

        // ---------------------------------------------------------
        // 1. Verify Player 0 Sphinx (Row 0)
        // ---------------------------------------------------------
        let p0Sphinx = null;
        let p0SphinxCol = -1;
        
        for (let c = 0; c < 10; c++) {
            const cell = board[0][c];
            if (cell && cell.type === 'Sphinx' && cell.player === 0) {
                p0Sphinx = cell;
                p0SphinxCol = c;
                break;
            }
        }

        if (!p0Sphinx) {
            errors.push(`Iter ${i}: P0 Sphinx missing on Row 0`);
            continue; 
        }

        // Rule: Laser facing side with most cells (Left/East if col < 5, Right/West if col >= 5)
        // 1 = East, 3 = West
        const expectedSphinxOri = p0SphinxCol < 5 ? 1 : 3;
        if (p0Sphinx.orientation !== expectedSphinxOri) {
            errors.push(`Iter ${i}: P0 Sphinx at col ${p0SphinxCol} has invalid orientation ${p0Sphinx.orientation} (Expected ${expectedSphinxOri})`);
        }

        const p1SphinxCol = 9 - p0SphinxCol;


        // ---------------------------------------------------------
        // 2. Verify Player 0 Pharaoh (Row 2)
        // ---------------------------------------------------------
        let p0Pharaoh = null;
        let p0PharaohCol = -1;

        for (let c = 0; c < 10; c++) {
            const cell = board[2][c];
            if (cell && cell.type === 'Pharaoh' && cell.player === 0) {
                p0Pharaoh = cell;
                p0PharaohCol = c;
                break;
            }
        }

        if (!p0Pharaoh) {
            errors.push(`Iter ${i}: P0 Pharaoh missing on Row 2`);
            continue;
        }

        const forbiddenCols = [0, 9, p0SphinxCol, p1SphinxCol];
        if (forbiddenCols.includes(p0PharaohCol)) {
            errors.push(`Iter ${i}: P0 Pharaoh placed in forbidden column ${p0PharaohCol}. Forbidden: [${forbiddenCols}]`);
        }


        // ---------------------------------------------------------
        // 3. Verify Player 0 Anubis 1 (Protector)
        // ---------------------------------------------------------
        const p0Anubis1 = board[4][p0PharaohCol];
        if (!p0Anubis1 || p0Anubis1.type !== 'Anubis' || p0Anubis1.player !== 0) {
            errors.push(`Iter ${i}: P0 Anubis 1 missing at [4, ${p0PharaohCol}]`);
        } else if (p0Anubis1.orientation !== 2) {
            errors.push(`Iter ${i}: P0 Anubis 1 invalid orientation ${p0Anubis1.orientation} (Expected 2/South)`);
        }


        // ---------------------------------------------------------
        // 4. Verify Player 0 Anubis 2 
        // ---------------------------------------------------------
        const p0Anubis2 = board[2][p1SphinxCol];
        if (!p0Anubis2 || p0Anubis2.type !== 'Anubis' || p0Anubis2.player !== 0) {
            errors.push(`Iter ${i}: P0 Anubis 2 missing at [2, ${p1SphinxCol}]`);
        } else if (p0Anubis2.orientation !== 2) {
            errors.push(`Iter ${i}: P0 Anubis 2 invalid orientation ${p0Anubis2.orientation} (Expected 2/South)`);
        }


        // ---------------------------------------------------------
        // 5. Verify Player 0 Scarab (Row 3)
        // ---------------------------------------------------------
        let p0ScarabCount = 0;
        for (let c = 0; c < 10; c++) {
            if (board[3][c] && board[3][c].type === 'Scarab' && board[3][c].player === 0) {
                p0ScarabCount++;
            }
        }
        if (p0ScarabCount !== 1) {
            errors.push(`Iter ${i}: Found ${p0ScarabCount} P0 Scarabs on Row 3 (Expected 1)`);
        }


        // ---------------------------------------------------------
        // 6. Verify Central Symmetry for Player 1
        // ---------------------------------------------------------
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 10; c++) {
                const p0Piece = board[r][c];
                if (p0Piece && p0Piece.player === 0) {
                    const symR = 9 - r;
                    const symC = 9 - c;
                    const p1Piece = board[symR][symC];

                    if (!p1Piece) {
                        errors.push(`Iter ${i}: Symmetry Error. P0 ${p0Piece.type} at [${r},${c}] has no partner at [${symR},${symC}]`);
                        continue;
                    }

                    if (p1Piece.type !== p0Piece.type || p1Piece.player !== 1) {
                        errors.push(`Iter ${i}: Symmetry Error. Piece mismatch at [${symR},${symC}]`);
                    }

                    const expectedOri = (p0Piece.orientation + 2) % 4;
                    if (p1Piece.orientation !== expectedOri) {
                        errors.push(`Iter ${i}: Symmetry Error. P1 ${p1Piece.type} at [${symR},${symC}] orientation ${p1Piece.orientation} != expected ${expectedOri}`);
                    }
                }
            }
        }
    }

    if (errors.length === 0) {
        console.log(`SUCCESS: All ${iterations} iterations passed strict rule verification.`);
    } else {
        console.error(`FAILURE: ${errors.length} errors found.`);
        const uniqueErrors = [...new Set(errors)];
        uniqueErrors.slice(0, 5).forEach(err => console.error(err));
    }
}

testBoardInitialization();