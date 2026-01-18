const boardElement = document.getElementById('board');
let currentGameState = null;
let selectedPiece = null; // {x, y}

boardElement.addEventListener('click', (event) => {
    const clickedCell = event.target.closest('.case');

    if (!clickedCell) {
        deselect();
        return;
    }

    const y = parseInt(clickedCell.dataset.row, 10);
    const x = parseInt(clickedCell.dataset.col, 10);

    console.log(`Selected Cell : Row ${y}, Col ${x}`);

    handleCellClick(x, y);
});

function handleCellClick(x, y) {
    if (!currentGameState) return;

    const clickedPiece = currentGameState.board[y][x];

    const currentPlayerId = currentGameState.turn;

    if (!selectedPiece) {
        if (clickedPiece && clickedPiece.player === currentPlayerId) {
            selectPiece(x, y);
        }
        return;
    }

    if (selectedPiece.x === x && selectedPiece.y === y) {
        deselect();
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

function updateVisualSelection() {
    const allCases = document.querySelectorAll('.case');
    allCases.forEach(c => c.classList.remove('selected'));

    if (selectedPiece) {
        const cell = document.querySelector(`.case[data-row='${selectedPiece.y}'][data-col='${selectedPiece.x}']`);
        if (cell) {
            cell.classList.add('selected');
        }
    }
}


function sendSwapAction(x, y, targetX, targetY, playerId) {
    console.log(`Envoi action SWAP: (${x},${y}) <-> (${targetX},${targetY}) pour Joueur ${playerId}`);
    socket.emit('player:action', {
        playerId: playerId,
        action: {
            type: 'SWAP',
            x: x,
            y: y,
            targetX: targetX,
            targetY: targetY
        }
    });
}



//PYRAMID PLACEMENT LOGIC
const reserveOrientations = {
    0: 1,
    1: 1
};

function initPlayerControls(playerId, imgId, btnLeftId, btnRightId) {
    const img = document.getElementById(imgId);
    const btnLeft = document.getElementById(btnLeftId);
    const btnRight = document.getElementById(btnRightId);

    if (!img || !btnLeft || !btnRight) return;

    const updateVisual = () => {
        const orientation = reserveOrientations[playerId];
        const degree = (90 * orientation) - 90;
        img.style.transform = `rotate(${degree}deg)`;
    };

    updateVisual();

    btnLeft.addEventListener('click', () => {
        reserveOrientations[playerId] = (reserveOrientations[playerId] - 1 + 4) % 4;
        updateVisual();
    });

    btnRight.addEventListener('click', () => {
        reserveOrientations[playerId] = (reserveOrientations[playerId] + 1) % 4;
        updateVisual();
    });
}

function initReserveListeners() {
    initPlayerControls(0, 'p1-reserve-piece', 'btn-p1-left', 'btn-p1-right');

    initPlayerControls(1, 'p2-reserve-piece', 'btn-p2-left', 'btn-p2-right');
}

function initDraggableReserve() {
    const p1Img = document.querySelector('.current-player .piece-image');
    if (p1Img) setupDraggableItem(p1Img, 0);

    const p2Img = document.querySelector('.opposing-player .piece-image');
    if (p2Img) setupDraggableItem(p2Img, 1);
}

function setupDraggableItem(img, playerId) {
    img.setAttribute('draggable', true);
    img.style.cursor = 'grab';

    img.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('actionType', 'PLACE');
        event.dataTransfer.setData('playerId', playerId.toString());

        const currentOrientation = reserveOrientations[playerId];
        event.dataTransfer.setData('orientation', currentOrientation.toString());

        event.dataTransfer.effectAllowed = 'copy';
        console.log(`Drag started: Pyramide Joueur ${playerId + 1} (ID: ${playerId})`);
    });
}

function updatePyramidReserve(reserves) {
    const countP0 = document.getElementById("p1-pyramid-count")
    const countP1 = document.getElementById("p2-pyramid-count")
    countP0.innerHTML = reserves[0].toString()
    countP1.innerHTML = reserves[1].toString()
}

function updateCooldownDisplay(gameState) {
    if (!gameState.swapHistory) return;

    const p0Sphinx = calculateCooldown(gameState, 0, 'Sphinx');
    const p0Pharaoh = calculateCooldown(gameState, 0, 'Pharaoh');
    const p1Sphinx = calculateCooldown(gameState, 1, 'Sphinx');
    const p1Pharaoh = calculateCooldown(gameState, 1, 'Pharaoh');

    document.getElementById('p1-sphinx-cooldown').textContent = p0Sphinx;
    document.getElementById('p1-pharaoh-cooldown').textContent = p0Pharaoh;
    document.getElementById('p2-sphinx-cooldown').textContent = p1Sphinx;
    document.getElementById('p2-pharaoh-cooldown').textContent = p1Pharaoh;
}

function calculateCooldown(gameState, playerId, type) {
    const lastSwapTurn = gameState.swapHistory[playerId][type];
    const turnsPassed = gameState.turnCount - lastSwapTurn;
    if (turnsPassed < 8) {
        return Math.ceil((8 - turnsPassed) / 2);
    }
    return 0;
}


//PYRAMID PLACEMENT LOGIC END

//This function create the board's cases (div) and add some event listener
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

            //allows overflying by another element
            pieceDiv.addEventListener('dragover', (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                pieceDiv.classList.add('drag-hover');
            });

            //Clean when there is no more element overflying the case
            pieceDiv.addEventListener('dragleave', () => {
                pieceDiv.classList.remove('drag-hover');
            });


            //manage the drop of a pyramid after a drag and drop action (PLACE)
            pieceDiv.addEventListener('drop', (event) => {
                event.preventDefault();
                pieceDiv.classList.remove('drag-hover');

                const actionType = event.dataTransfer.getData('actionType');
                const originPlayerId = event.dataTransfer.getData('playerId');
                const orientationStr = event.dataTransfer.getData('orientation');

                if (actionType === 'PLACE' && originPlayerId !== null) {
                    const x = parseInt(pieceDiv.dataset.col, 10);
                    const y = parseInt(pieceDiv.dataset.row, 10);

                    const playerId = parseInt(originPlayerId, 10);

                    const orientation = orientationStr ? parseInt(orientationStr, 10) : 0;

                    sendPlaceAction(x, y, orientation, playerId);
                }
            });

            boardElement.appendChild(pieceDiv);
        }
    }
}

function sendPlaceAction(x, y, orientation, playerId) {
    console.log(`Envoi action PLACE en (${x}, ${y}) pour le Joueur ${playerId}`);

    socket.emit('player:action', {
        playerId: playerId,
        action: {
            type: 'PLACE',
            x: x,
            y: y,
            orientation: orientation
        }
    });
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
    pieceIMG.classList.add(type);

    let degree = 0;
    let scaleY = 1;
    let scale = 1;
    let translateY = 0;

    if (["anubis", "scarab"].includes(type)) {
        scale = 1.5;
    } else if (type === "pharaoh") {
        scale = 1.25;
        translateY = 7;
    }

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

    pieceIMG.style.transform = `rotate(${degree}deg) scaleY(${scaleY}) scale(${scale}) translateY(${translateY}%)`;

    return pieceIMG;
}



initBoard();
initDraggableReserve();
initReserveListeners();

const socket = io("http://localhost:8000", {
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

socket.on('gameInit', (gameState) => {
    console.log("État reçu du serveur !", gameState);
    currentGameState = gameState;
    updatePieces(gameState.board);
    updatePyramidReserve(gameState.reserves);
    updateCooldownDisplay(gameState);
});

socket.on('game:state', (gameState) => {
    console.log("État reçu du serveur !", gameState);
    currentGameState = gameState;
    updatePieces(gameState.board);
    updatePyramidReserve(gameState.reserves);
    updateCooldownDisplay(gameState);
    updateVisualSelection();
});

socket.on('game:error', (data) => {
    alert(data.message);
});