const boardElement = document.getElementById('board');

function renderBoard() {
    // Clear previous state
    boardElement.innerHTML = ''; 

    // Loop through Rows (y)
    for (let row = 0; row < 10; row++) {
        // Boucle sur les Colonnes (x)
        for (let col = 0; col < 10; col++) {
            
            const pieceDiv = document.createElement('div');
            pieceDiv.classList.add('case');
            
            pieceDiv.innerHTML = "<span>"+ row + col +"</span>";

            pieceDiv.style.gridRowStart = row + 1;
            pieceDiv.style.gridColumnStart = col + 1;

            boardElement.appendChild(pieceDiv);
        }
    }
}

renderBoard()