import { sendSwapAction } from "./networkManager";

//Cell click

    //Cell click handling for rotation/shift/swap

export function cellClickListner(boardElement) {
    boardElement.addEventListener('click', (event) => {
        const clickedCell = event.target.closest('.case');

        if (!clickedCell) {
            deselect();
            return;
        }

        const y = parseInt(clickedCell.dataset.row, 9);
        const x = parseInt(clickedCell.dataset.col, 9);

        console.log(`Selected Cell : Row ${y}, Col ${x}`);

        handleCellClick(x, y);
    });

}

function handleCellClick(x, y) {
    if (!currentGameState) return;

    const clickedPiece = currentGameState.board[y][x];

    const currentPlayerId = currentGameState.turn;

    if (!selectedPiece) {
        if (clickedPiece && clickedPiece.player === currentPlayerId) {
            selectPiece(x, y);
            updateRotationButtons(clickedPiece);
        }
        return;
    }

    if (selectedPiece.x === x && selectedPiece.y === y) {
        deselect();
        return;
    }

    if (!clickedPiece) {
        const dx = Math.abs(x - selectedPiece.x);
        const dy = Math.abs(y - selectedPiece.y);
        const isAdjacent = (dx === 1 && dy === 0) || (dx === 0 && dy === 1);

        if (isAdjacent) {
            sendMoveAction(selectedPiece.x, selectedPiece.y, x, y);
        } else {
            deselect();
        }
        return;
    }

    const originPiece = currentGameState.board[selectedPiece.y][selectedPiece.x];

    if (originPiece && (originPiece.type === 'Scarab')) {
        if (clickedPiece && clickedPiece.player === currentPlayerId &&
            (clickedPiece.type === 'Sphinx' || clickedPiece.type === 'Pharaoh')) {
            sendSwapAction(selectedPiece.x, selectedPiece.y, x, y, currentPlayerId);
            deselect();
            return;
        }
    }

    if (clickedPiece && clickedPiece.player === currentPlayerId) {
        selectPiece(x, y);
        updateRotationButtons(clickedPiece);
        return;
    }

    if (clickedPiece && clickedPiece.player === currentPlayerId) {
        selectPiece(x, y);
    } else {
        deselect();
    }
}

function selectPiece(x, y) {

    selectedPiece = { x, y };
    updateVisualSelection();
}

function deselect() {
    selectedPiece = null;
    updateVisualSelection();

}

    //Cell click handling rotation/shift/swap end

    //Cell click display
    
export function updateVisualSelection() {
    const allCases = document.querySelectorAll('.case');
    allCases.forEach(c =>{
        c.classList.remove('selected');
        c.classList.remove('valid-move');
        c.classList.remove('swap-target');
    });

    if (!selectedPiece) {
        updateRotationButtons(null);
        return;
    }

    if (selectedPiece) {
        const cell = document.querySelector(`.case[data-row='${selectedPiece.y}'][data-col='${selectedPiece.x}']`);
        if (cell) {
            cell.classList.add('selected');
        }
    }

    if (currentGameState && currentGameState.board) {
        const piece = currentGameState.board[selectedPiece.y][selectedPiece.x];

        updateRotationButtons(piece);
        if (piece) {
            if (piece.type === 'Scarab') {
                showValidMoves(selectedPiece.x, selectedPiece.y);
                highlightSwapTargets(piece.player); // <--- NOUVEAU : Appel de la fonction
            } else if (piece.type === 'Anubis' || piece.type === 'Pyramid' || piece.type === 'Scarab') {
                showValidMoves(selectedPiece.x, selectedPiece.y);
            }
        }
    }
}


function showValidMoves(x, y) {
    const directions = [
        { dx: 0, dy: -1 }, // Haut
        { dx: 0, dy: 1 },  // Bas
        { dx: -1, dy: 0 }, // Gauche
        { dx: 1, dy: 0 }   // Droite
    ];

    directions.forEach(dir => {
        const targetX = x + dir.dx;
        const targetY = y + dir.dy;

        if (targetX >= 0 && targetX < 10 && targetY >= 0 && targetY < 10) {
            const targetPiece = currentGameState.board[targetY][targetX];
            if (!targetPiece) {
                const targetCell = document.querySelector(`.case[data-row='${targetY}'][data-col='${targetX}']`);
                if (targetCell) {
                    targetCell.classList.add('valid-move');
                }
            }
        }
    });
}

    //Cell click display end

//Cell Click end