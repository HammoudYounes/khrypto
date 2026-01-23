import { socket } from './gamePage/networkManager';


const localButton = document.getElementById("localBtn")
const aiButton = document.getElementById("aiBtn")
const onlineButton = document.getElementById("onlineBtn")


function emitGame(gameMode){
    socket.emit("game:create", gameMode)
}

localButton.addEventListener('click', () => {
    emitGame("local")
})

aiButton.addEventListener('click', () => {
    emitGame("ai")
})

Button.addEventListener('click', () => {
    emitGame("online")
})


socket.on("game:created", (gameId) => {
    console.log("Game created with ID:", gameId);

    sessionStorage.setItem("gameId", gameId);

    window.location.href = 'gamePage/index.html';
})