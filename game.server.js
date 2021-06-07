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

        this.grid = []
        for (var x = -Core.WORLD_SIZE; x < Core.WORLD_SIZE; x += Core.GRID_SIZE) {
            let a = []
            for (var y = 0; y < Core.WORLD_SIZE; y += Core.GRID_SIZE) {
                let b = []
                for (var z = -Core.WORLD_SIZE; z < Core.WORLD_SIZE; z += Core.GRID_SIZE) {
                    b.push(-1)
                }
                a.push(b)
            }
            this.grid.push(a)
        }
        // -1: empty
        // 0/1: red/blue
        this.respawns = { red: [], blue: [] }

        // TODO: real timing
        //setInterval(this.conwayGeneration.bind(this), 30000)
        this.started = false

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
                team: player.team,
                dead: player.dead
            }
        }

    }

    // broadcast our state to the clients
    broadcast() {

        this.updateState()
        this.socket.emit("serverupdate", this.lastState)

    }


    // countSurroundings server side uses our grid variable instead of players,
    // this way we can easily check for empty cells
    countSurroundings(px, py, pz) {

        let red = 0, blue = 0
        for (var x = -1; x <= 1; x++) {
            let nx = px + x;
            if (nx < 0 || nx >= this.grid.length) { continue }

            for (var y = -1; y <= 1; y++) {
                let ny = py + y;
                if (ny < 0 || ny >= this.grid[0].length) { continue }

                for (var z = -1; z <= 1; z++) {
                    let nz = pz + z;
                    if (nz < 0 || nz >= this.grid.length) { continue }
                    if (x == 0 && y == 0 && z == 0) { continue }

                    let np = this.grid[nx][ny][nz]
                    if (np == 0) { red++  } else
                    if (np == 1) { blue++ }
                }
            }
        }

        return [red, blue]

    }


    /* conwayGeneration() => void
        Move forward one generation in the conway's game of life simulation,
            update valuable respawn points and whether or not a player is dead
    */
    conwayGeneration() {
        // reset the grid
        for (var i = 0; i < this.grid.length; i++) {
            for (var j = 0; j < this.grid[i].length; j++) {
                for (var k = 0; k < this.grid[i][j].length; k++) {
                    this.grid[i][j][k] = -1
                }
            }
        }
        // reset respawns
        this.respawns = { red: [], blue: [] }

        // fill in players
        for (const [id, player] of Object.entries(this.state.players)) {
            let x = (Core.snapToGrid(player.position.x) + Core.WORLD_SIZE) / Core.GRID_SIZE,
                y = Core.snapToGrid(player.position.y) / Core.GRID_SIZE,
                z = (Core.snapToGrid(player.position.z) + Core.WORLD_SIZE) / Core.GRID_SIZE
            if (!player.dead) {
                this.grid[x][y][z] = player.team
            }
            player.grid = [x, y, z]
        }

        // check cells
        let birthsDone = [] // keep this so we don't redo any cells
        for (const [id, player] of Object.entries(this.state.players)) {

            if (player.dead) { continue }

            let [self, other] = this.countSurroundings(...player.grid)

            if (player.team == 1) {
                let temp = self
                self = other
                other = temp
            }

            // implement rules
            // only teammates?
            if (other == 0) {
                player.dead = self < 2 || self > 3
            } else {
                player.dead = other - self <= 0
            }

            // births
            for (var x = -1; x <= 1; x++) {
                let nx = player.grid[0] + x;
                if (nx < 0 || nx >= this.grid.length) { continue }

                for (var y = -1; y <= 1; y++) {
                    let ny = player.grid[1] + y;
                    if (ny < 0 || ny >= this.grid[0].length) { continue }

                    for (var z = -1; z <= 1; z++) {
                        let nz = player.grid[2] + z;
                        let n = [nx, ny, nz].join()
                        if (birthsDone.includes(n)) { continue }
                        if (nz < 0 || nz >= this.grid.length) { continue }
                        if (x == 0 && y == 0 && z == 0) { continue }

                        let np = this.grid[nx][ny][nz]
                        if (np >= 0) { continue }

                        const [red, blue] = this.countSurroundings(nx, ny, nz)

                        // implement rules
                        if (red == 3 && blue == 0) {
                            let r = [nx, ny, nz]
                            if (!(arrayIncludes(this.respawns.red, r) || arrayIncludes(this.respawns.blue, r))) {
                                this.respawns.red.push(r)
                            }
                        } else if (blue == 3 && red == 0) {
                            let r = [nx, ny, nz]
                            if (!(arrayIncludes(this.respawns.red, r) || arrayIncludes(this.respawns.blue, r))) {
                                this.respawns.blue.push(r)
                            }
                        }
                        birthsDone.push(n)
                    }
                }
            }
        }

        // respawn players to the closest respawn point
        // Manhattan distance to keep things simple
        for (const [id, player] of Object.entries(this.state.players)) {
            if (player.dead) {
                let possible = player.team == 0 ? this.respawns.red : this.respawns.blue
                if (possible.length == 0) { continue }
                let closest = 0

                let min = Core.WORLD_SIZE
                for (var i = 0; i < possible.length-1; i++) {
                    let spawn = possible[i]
                    let d = Math.abs(player.grid[0] - spawn[0]) +
                            Math.abs(player.grid[1] - spawn[1]) +
                            Math.abs(player.grid[2] - spawn[2])
                    if (d < min) {
                        min = d
                        closest = i
                    }
                }

                player.dead = false

                player.position.fromArray(possible[closest])
                player.position.addScalar(-8)
                player.position.y += 8
                player.position.multiplyScalar(Core.GRID_SIZE)
                player.position.addScalar(Core.GRID_SIZE / 2)

                player.onFloor = false
                player.velocity.set(0, 0, 0)
                player.acceleration.set(0, 0, 0)
                possible.splice(closest, 1)
            }
        }

        // broadcast the generation update
        this.broadcastGeneration()
    }

    broadcastGeneration() {
        let data = {
            respawns: this.respawns
        }
        this.socket.emit("generation", data)
    }

    checkGameStart() {
        let start = true
        let readies = {}
        for (const [id, player] of Object.entries(this.state.players)) {
            start &= player.readied
            readies[player.username] = player.readied
        }
        if (start && !this.started) {
            setInterval(this.conwayGeneration.bind(this), Core.GENERATION_TIME * 1000)
            console.log("game starting")
            this.socket.emit("gamestart", new Date().getTime())
            this.started = true
        }
        this.socket.emit("readyupdate", readies)
    }
}

function arrayIncludes(array, item) {
    var item_as_string = JSON.stringify(item);

    var contains = array.some(function(ele){
        return JSON.stringify(ele) === item_as_string;
    });
    return contains;
}


export { Server }
