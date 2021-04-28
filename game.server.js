import * as THREE from "./three/build/three.module.js"
import * as Core from "./game.core.js"


const SERVER_BROADCAST_DT = 1000 / 60


class Server extends Core.Game {

    constructor() {

        super()

        this.socket
        this.lastState = new Core.State()

        setInterval(this.updatePhysics.bind(this), Core.DT)
        setInterval(this.broadcast.bind(this), SERVER_BROADCAST_DT)

        this.teams = { red: 0, blue: 0 }

    }

    // add a player to the game
    addPlayer(id) {

        this.state.players[id] = new Core.Player()
        this.state.players[id].id = id

        if (this.teams.red > this.teams.blue) {
            this.state.players[id].team = 1
            this.teams.blue++
        } else {
            this.state.players[id].team = 0
            this.teams.red++
        }

        this.socket.emit("playerconnected", { id: id, team: this.state.players[id].team })

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
        this.dt = this.currentTime
            ? (t - this.currentTime) / 1000
            : Core.DT / 1000
        this.currentTime = t

        for (const [id, player] of Object.entries(this.state.players)) {
            super.updatePlayer0(this.dt, player)
        }
        for (const [id, player] of Object.entries(this.state.players)) {
            super.updatePlayer1(this.dt, player)
        }
        for (const [id, player] of Object.entries(this.state.players)) {
            super.updatePlayer2(this.dt, player)
        }

    }

    // update the server's state to be sent out
    updateState() {

        this.lastState.time = new Date().getTime()
        for (const [id, player] of Object.entries(this.state.players)) {
            this.lastState.players[id] = {
                position: player.position,
                velocity: player.velocity,
                angle: player.angle.toArray(), // quaternion, doesn't send correctly across network so have to convert to array
                lastInput: player.lastInput,
                ready: this.lastState.time - player.lastPush > Core.PUSH_COOLDOWN,
                team: player.team
            }
        }

    }

    // broadcast our state to the clients
    broadcast() {

        this.updateState()
        this.socket.emit("serverupdate", this.lastState)

    }
}


export { Server }
