const boardElement = document.getElementById('board');

boardElement.addEventListener('click', (event) => {
    const clickedCell = event.target.closest('.case');

    if (!clickedCell) return;

    const y = parseInt(clickedCell.dataset.row, 10);
    const x = parseInt(clickedCell.dataset.col, 10);

    console.log(`Case cliquée : Row ${y}, Col ${x}`);

});


function initBoard() {
    boardElement.innerHTML = ''; 
    
    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
            const pieceDiv = document.createElement('div');
            pieceDiv.classList.add('case');
            
            pieceDiv.dataset.row = row;
            pieceDiv.dataset.col = col;
            
            pieceDiv.style.gridRowStart = row + 1;
            pieceDiv.style.gridColumnStart = col + 1;
            
            boardElement.appendChild(pieceDiv);
        }
    }
}

function updatePieces(boardData) {
    const cells = boardElement.children;

    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {

            const index = row * 10 + col;
            const cell = cells[index];
            const pieceData = boardData[row][col];

            cell.innerHTML = '';

            if (pieceData) {
                const img = createPieceImage(pieceData);
                cell.appendChild(img);
            }
        }
    }
}

function createPieceImage(pieceData) {
    const pieceIMG = document.createElement('img');
    const color = pieceData.player === 0 ? 'green' : 'red';
    const type = pieceData.type.toLowerCase();

    pieceIMG.src = `assets/${color}_${type}.png`;
    pieceIMG.alt = `${color} ${type}`;
    pieceIMG.classList.add('piece-image');

    let degree = 0;
    let scaleY = 1;

    if (type === "pharaoh") {
        degree = 0; 
    } 
    else if (type === "sphinx") {
        switch (pieceData.orientation) {
            case 0: degree = -90; break;
            case 1: degree = 0; break;
            case 2: degree = 90; break;
            case 3: degree = 180; break;
        }

        if (pieceData.orientation === 3) {
            scaleY = scaleY * -1;
        }
    } 
    else if (type === "scarab") {
        degree = 90 * (pieceData.orientation) - 45;
    } 
    else if (type === "pyramid") {
        degree = 90 * (pieceData.orientation) - 90;
    } 
    else {
        degree = 90 * (pieceData.orientation) - 180;
    }

    pieceIMG.style.transform = `rotate(${degree}deg) scaleY(${scaleY})`;
    
    return pieceIMG;
}

initBoard();

const socket = io("http://localhost:8000", {
    path: '/socket.io',
    transports: ['websocket', 'polling'] 
});

socket.on('gameInit', (gameState) => {
    console.log("État reçu du serveur !", gameState);
    updatePieces(gameState.board); 
});