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
            if (pieceData) {
                const pieceIMG = document.createElement('img')
                const color = pieceData.player === 0 ? 'green' : 'red';
                const type = pieceData.type.toLowerCase();
                pieceIMG.src = `assets/${color}_${type}.png`;
                pieceIMG.alt = `${color} ${type}`;
                pieceIMG.classList.add('piece-image');
                
                let degree = 0

                if(type === "pharaoh"){
                    degree = color === "green" ? 0 : 180
                }
                else if(type === "sphinx"){
                    //TODO PROBAPLY NOT GOOD
                    switch(pieceData.orientation){
                        case 0: degree = -90
                        case 1: degree = 0
                        case 2: degree = 90
                        case 3: degree = color === "green" ? 180 : 0
                    }
                }
                else{
                    degree = 90*(pieceData.orientation) - 180
                }


                pieceIMG.style.transform = 'rotate(' + degree + 'deg)'
                pieceDiv.appendChild(pieceIMG);
                pieceDiv.appendChild(pieceIMG);

            
            }

            pieceDiv.style.gridRowStart = row + 1;
            pieceDiv.style.gridColumnStart = col + 1;

            boardElement.appendChild(pieceDiv);
        }
    }
}

renderBoard()