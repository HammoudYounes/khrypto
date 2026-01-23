const { initializeBoard } = require('../rules/initBoard');
const { applyAction, computeLaserPath, applyDestructions } = require('../rules/actions');

class Game {
    constructor(id, mode, io) {
        this.id = id;
        this.mode = mode; // local ai online
        this.io = io;     // Reference to socket.io server
        
        // Initial State
        this.state = {
            board: initializeBoard(),
            turn: 0,
            turnCount: 0,
            reserves: { 0: 7, 1: 7 },
            pendingReserves: { 0: [], 1: [] },
            winner: { 0: false, 1: false },
            swapHistory: { 0: { Sphinx: -10, Pharaoh: -10 }, 1: { Sphinx: -10, Pharaoh: -10 } }
        };
    }

    handleMove(action, playerId) {
        try {
            // 1. Logic
            const laserShouldFire = applyAction(this.state, action, playerId);
            const boardSnapshot = JSON.parse(JSON.stringify(this.state.board));
            const laserResult = computeLaserPath(this.state, playerId, laserShouldFire);
            
            if (laserResult)
                applyDestructions(this.state, laserResult.hitCoords);


            if (this.state.winner[0] === false && this.state.winner[1] === false && this.state.canPassTurn) {
                this.state.turn = (this.state.turn + 1) % 2;
                this.state.turnCount = (this.state.turnCount || 0) + 1;

                console.log(`Turn ended. Now Player ${this.state.turn}'s turn. (Total: ${this.state.turnCount})`);

                const currentPlayer = this.state.turn;
                const pendingList = this.state.pendingReserves[currentPlayer];

                for (let i = pendingList.length - 1; i >= 0; i--) {
                    const unlockTime = pendingList[i];

                    if (this.state.turnCount >= unlockTime) {
                        this.state.reserves[currentPlayer] += 1;
                        pendingList.splice(i, 1);
                        console.log(`P${currentPlayer} received a Pyramid from reserve queue!`);
                    }
                }
                this.state.canPassTurn = false;
            }

            this.io.to(this.id).emit('game:action_response', {
                boardAfterMove: boardSnapshot,
                laserResult: laserResult,
                finalState: this.state
            });

            if (this.state.winner[0] === true || this.state.winner[1] === true) {
                this.io.to(this.id).emit('game:over', gameState.winner);
            }

            return true; // Success

        } catch (error) {
            throw error; 
        }
    }

    resetGameState() {
        this.state.board = initializeBoard(),
        this.state.turn = 0,
            this.state.reserves = { 0: 7, 1: 7 };
        this.state.winner = { 0: false, 1: false };
        this.state.turnCount = 0;
        this.state.swapHistory = {
            0: { Sphinx: -10, Pharaoh: -10 },
            1: { Sphinx: -10, Pharaoh: -10 }
        };
        this.state.pendingReserves = { 0: [], 1: [] };
        this.state.canPassTurn = false;
    }
}

module.exports = Game;