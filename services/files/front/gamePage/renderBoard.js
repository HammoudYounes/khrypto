const boardElement = document.getElementById('board');
const btnRotateLeft = document.getElementById('btn-rotate-left');
const btnRotateRight = document.getElementById('btn-rotate-right');
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
            // Si on clique sur une case vide trop loin, on désélectionne juste
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

function updateVisualSelection() {
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


function sendSwapAction(x, y, targetX, targetY, playerId) {
    console.log(`Sending SWAP action: (${x},${y}) <-> (${targetX},${targetY}) for Player ${playerId}`);
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

function updateTurnIndicator(gameState) {
    const p1Container = document.querySelector('.current-player');
    const p2Container = document.querySelector('.opposing-player');

    // Clear previous
    p1Container.classList.remove('turn-active');
    p2Container.classList.remove('turn-active');

    if (gameState.turn === 0) {
        p1Container.classList.add('turn-active');
    } else {
        p2Container.classList.add('turn-active');
    }
}


// PYRAMID PLACEMENT LOGIC END

// This function creates the board's cells (div) and adds some event listeners
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

            // Allows hovering by another element
            pieceDiv.addEventListener('dragover', (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                pieceDiv.classList.add('drag-hover');
            });

            // Clean up when there is no more element hovering over the cell
            pieceDiv.addEventListener('dragleave', () => {
                pieceDiv.classList.remove('drag-hover');
            });


            // Manage the drop of a pyramid after a drag and drop action (PLACE)
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
    console.log(`Sending PLACE action at (${x}, ${y}) for Player ${playerId}`);

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


function updateRotationButtons(piece) {
    btnRotateLeft.disabled = true;
    btnRotateRight.disabled = true;

    if (!piece) return;

    if (piece.type === 'Pharaoh') {
        console.log("Pharaon sélectionné : Rotation impossible");
        return;
    }

    btnRotateLeft.disabled = false;
    btnRotateRight.disabled = false;
}

btnRotateLeft.addEventListener('click', () => {
    if (selectedPiece) {
        sendRotateAction(selectedPiece.x, selectedPiece.y, -1); // -1 = Gauche (Anti-horaire)
    }
});

btnRotateRight.addEventListener('click', () => {
    if (selectedPiece) {
        sendRotateAction(selectedPiece.x, selectedPiece.y, 1); // 1 = Droite (Horaire)
    }
});

function sendRotateAction(x, y, direction) {
    const playerId = currentGameState.turn;

    console.log(`Envoi Rotation -> X:${x}, Y:${y}, Sens:${direction}`);

    socket.emit('player:action', {
        playerId: playerId,
        action: {
            type: 'ROTATE',
            x: x,
            y: y,
            direction: direction
        }
    });

    deselect();
}

function sendMoveAction(originX, originY, destX, destY) {
    const playerId = currentGameState.turn;

    console.log(`Envoi Move : (${originX},${originY}) vers (${destX},${destY})`);

    socket.emit('player:action', {
        playerId: playerId,
        action: {
            type: 'MOVE',
            x: originX,      // Case de départ (pour identifier la pièce)
            y: originY,
            destX: destX,    // Case d'arrivée
            destY: destY
        }
    });

    deselect();
}


function highlightSwapTargets(playerId) {
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const targetPiece = currentGameState.board[y][x];

            if (targetPiece) {
                if (targetPiece.player === playerId &&
                    (targetPiece.type === 'Sphinx' || targetPiece.type === 'Pharaoh')) {

                    const cooldown = calculateCooldown(currentGameState, playerId, targetPiece.type);
                    if (cooldown === 0) {
                        const cell = document.querySelector(`.case[data-row='${y}'][data-col='${x}']`);
                        if (cell) cell.classList.add('swap-target');
                    }
                }
            }
        }
    }
}
//LASER RENDERING LOGIC

async function animateLaserSequence(laserResult, color) {
    const canvas = document.getElementById('laserCanvas');
    const ctx = canvas.getContext('2d');
    const board = document.getElementById('board');

    canvas.width = board.clientWidth;
    canvas.height = board.clientHeight;

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;

    const path = laserResult.path;

    // Transform the list of destroyed pieces into a Set of "x,y" strings for fast lookup
    const destroyedSet = new Set();
    if (laserResult.hitCoords) {
        laserResult.hitCoords.forEach(coord => destroyedSet.add(`${coord.x},${coord.y}`));
    }

    ctx.beginPath();

    // Iterate through the path segment by segment
    for (let i = 0; i < path.length - 1; i++) {
        const start = path[i];
        const end = path[i + 1];

        const startPos = getCenterCoordinates(start.x, start.y);
        const endPos = getCenterCoordinates(end.x, end.y);

        if (i === 0) {
            ctx.moveTo(startPos.px, startPos.py);
        }

        ctx.lineTo(endPos.px, endPos.py);
        ctx.stroke();

        await sleep(100);

        if (destroyedSet.has(`${end.x},${end.y}`)) {
            drawExplosion(ctx, endPos.px, endPos.py);

            removePieceFromBoard(end.x, end.y);

            await sleep(150);
        }
    }

    await sleep(500);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to get the center of a cell in pixels relative to the canvas
function getCenterCoordinates(x, y) {
    const cell = document.querySelector(`.case[data-row='${y}'][data-col='${x}']`);
    if (!cell) return { px: 0, py: 0 };

    const px = cell.offsetLeft + cell.offsetWidth / 2;
    const py = cell.offsetTop + cell.offsetHeight / 2;

    return { px, py };
}

function removePieceFromBoard(x, y) {
    const cell = document.querySelector(`.case[data-row='${y}'][data-col='${x}']`);
    if (cell) {
        cell.innerHTML = '';

        // Optional: add css animation for the disappearance
    }
}

function drawExplosion(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = 'yellow';
    ctx.shadowColor = 'orange';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
}

//LASER RENDERING LOGIC END

initBoard();
initDraggableReserve();
initReserveListeners();

const socket = io("http://localhost:8000", {
    path: '/socket.io',
    transports: ['websocket', 'polling']
});

socket.on('gameInit', (gameState) => {
    console.log("State received from server!", gameState);
    finalizeTurn(gameState)
});

socket.on('game:action_response', (gameState) => {
    console.log("State received from server!", gameState);
    if (gameState.boardAfterMove) {
        updatePieces(gameState.boardAfterMove);
    }

    if (gameState.laserResult && gameState.laserResult.path && gameState.laserResult.path.length > 0) {
        animateLaserSequence(gameState.laserResult, currentGameState.turn === 0 ? "green" : "red").then(() => {
            finalizeTurn(gameState.finalState);
        });
    } else {
        finalizeTurn(gameState.finalState);
    }
});

function finalizeTurn(state) {
    currentGameState = state;
    updatePieces(state.board);
    updatePyramidReserve(state.reserves);
    updateCooldownDisplay(state);
    updateTurnIndicator(state);
    updateVisualSelection();
}

socket.on('game:error', (data) => {
    alert(data.message);
});