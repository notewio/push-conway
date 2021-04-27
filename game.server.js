import * as THREE from "./lib/three.module.js";
import * as Core from "./game.core.js";

const SERVER_BROADCAST_DT = 1000/60


class Server extends Core.Game {

    constructor() {
        super()

        this.socket

        this.lastState = new Core.State()

        setInterval(this.updatePhysics.bind(this), Core.DT)

        setInterval(this.broadcast.bind(this), SERVER_BROADCAST_DT)

    }


    // add a player to the game
    addPlayer(id) {
        this.state.players[id] = new Core.Player()
        this.state.players[id].id = id
        this.socket.emit("playerconnected", id)
    }

    // remove a player from the game
    removePlayer(id) {
        delete this.state.players[id]
        delete this.lastState.players[id]
        this.socket.emit("playerdisconnected", id)
    }


    // The physics loop
    updatePhysics() {

        let t = new Date().getTime()

        this.dt = this.currentTime ?
            (t - this.currentTime) / 1000 : Core.DT / 1000

        this.currentTime = t

        for (const [id, player] of Object.entries(this.state.players)) {
            super.updatePlayer1(this.dt, player)
        }
        for (const [id, player] of Object.entries(this.state.players)) {
            super.updatePlayer2(this.dt, player)
        }

    }


    // update the server's state to be sent out
    updateState() {
        for (const [id, player] of Object.entries(this.state.players)) {
            this.lastState.players[id] = {
                position: player.position,
                velocity: player.velocity,
                angle: player.angle.toArray(), // quaternion, doesn't send correctly across network so have to convert to array
                lastInput: player.lastInput
            }
        }
        this.lastState.time = new Date().getTime()
    }

    // broadcast our state to the clients
    broadcast() {
        this.updateState()
        this.socket.emit("serverupdate", this.lastState) // TODO: replace this with sending a state rather than just players
    }

}


export { Server }
