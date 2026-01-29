

const localButton = document.getElementById("localBtn")
const aiButton = document.getElementById("aiBtn")
const onlineButton = document.getElementById("onlineBtn")

const socket = io("http://localhost:8000", {
    path: '/socket.io',
    transports: ['websocket', 'polling']
});




function emitGame(gameMode) {
    socket.emit("game:create", gameMode)
}

localButton.addEventListener('click', () => {
    emitGame("local")
})

aiButton.addEventListener('click', () => {
    emitGame("ai")
})

onlineButton.addEventListener('click', () => {
    emitGame("online")
})


socket.on("game:created", (data) => {
    console.log("Game created with ID:", data.gameId);

    sessionStorage.setItem("gameId", data.gameId);

    window.location.href = './gamePage/index.html';
})