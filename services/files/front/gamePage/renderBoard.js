const boardElement = document.getElementById('board');

const socket = io("http://localhost:8000", {
    path: '/socket.io',
    transports: ['websocket', 'polling'] 
});

socket.on('gameInit', (gameState) => {
    console.log("Etat  reçu du serveur !", gameState);
    renderBoard(gameState.board); // On redessine le plateau immédiatement
});


function renderBoard(boardData) {
    // Clear previous state
    boardElement.innerHTML = ''; 

    // Loop through Rows (y)
    for (let row = 0; row < 10; row++) {
        // Boucle sur les Colonnes (x)
        for (let col = 0; col < 10; col++) {
            
        const pieceData = boardData[row][col];
        const pieceDiv = document.createElement('div');
        pieceDiv.classList.add('case');
        console.log(pieceData)
        if(pieceData) {
            pieceDiv.innerHTML = "<span>"+ pieceData.type +"</span>";
        }

           pieceDiv.style.gridRowStart = row + 1;
           pieceDiv.style.gridColumnStart = col + 1;

            boardElement.appendChild(pieceDiv);
        }
    }
}

renderBoard()