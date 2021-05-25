import * as THREE from "./three/build/three.module.js"
import * as Core from "./game.core.js"
import { GLTFLoader } from "./three/examples/jsm/loaders/GLTFLoader.js"
import { PointerLockControls } from "./three/examples/jsm/controls/PointerLockControls.js"

import { EffectComposer } from './three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from './three/examples/jsm/postprocessing/RenderPass.js'
import { SMAAPass } from './three/examples/jsm/postprocessing/SMAAPass.js'


const LOADER = new GLTFLoader()

const INPUT_BUFFER_SIZE = 100
const SERVER_UPDATE_BUFFER_SIZE = 100

const GRID_SIZE = Core.GRID_SIZE
const WORLD_SIZE = Core.WORLD_SIZE


class Client extends Core.Game {

    constructor() {

        super()

        this.selfInputs = []
        this.serverUpdates = []

        this.prediction.bind(this)

        this.initSocket()

        this.initHUD()

        this.initThree()
        this.render()

        this.initKeyboard()
        this.initMouse()
        setInterval(this.sendInput.bind(this), Core.DT)

    }

    initSocket() {

        this.socket = io.connect("/", { reconnection: false }) // TODO: dev only
        this.id

        this.socket.on("onconnected", this.connected.bind(this))

        this.socket.on("serverupdate", this.updateReceived.bind(this))

        this.socket.on("playerconnected", this.playerConnected.bind(this))
        this.socket.on("playerdisconnected", this.playerDisconnected.bind(this))

        this.socket.on("generation", this.generation.bind(this))

    }

    initThree() {

        this.scene = new THREE.Scene()
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        )

        this.renderer = new THREE.WebGLRenderer()
        this.renderer.setSize(window.innerWidth, window.innerHeight)

        // Lights
        this.scene.background = new THREE.Color(0xa6ecea)
        this.scene.fog = new THREE.Fog(0xddddee, 0, 400)

        const light = new THREE.HemisphereLight(0xeeeeff, 0x777788, 0.75)
        light.position.set(0.5, 1, 0.75)
        this.scene.add(light)

        const sun = new THREE.DirectionalLight(0xeeeedd, 0.3)
        sun.position.set(0, 10, 0)
        sun.target.position.set(-5, 0, 0)
        this.scene.add(sun)

        const spotlight = new THREE.SpotLight(0xcedeff, 1)
        spotlight.position.set(-50, 50, 50)
        this.scene.add(spotlight)

        // World
        LOADER.load(
            "./world/world.glb",
            function (gltf) {
                this.scene.add(gltf.scene)
            }.bind(this),
            undefined,
            function (error) {
                console.error(error)
            }
        )

        // Grid
        let cube = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, GRID_SIZE)
        let geometry = new THREE.EdgesGeometry(cube)
        let mat = new THREE.LineBasicMaterial({
            color: 0xf5e942,
            linewidth: 1,
            transparent: true,
            opacity: 0.05,
        })
        let min = -WORLD_SIZE + GRID_SIZE / 2
        for (let y = 1; y < WORLD_SIZE; y += GRID_SIZE) {
            for (let x = min; x < WORLD_SIZE; x += GRID_SIZE) {
                for (let z = min; z < WORLD_SIZE; z += GRID_SIZE) {
                    let wireframe = new THREE.LineSegments(geometry, mat)
                    wireframe.position.set(x, y, z)
                    this.scene.add(wireframe)
                }
            }
        }

        // respawns
        const respawnGeometry = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, GRID_SIZE)
        const redRespawn = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.2,
        })
        const blueRespawn = new THREE.MeshBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 0.2,
        })
        this.respawns = { red: [], blue: [] }
        for (var x = min; x < WORLD_SIZE; x += GRID_SIZE) {
            let a = []
            let c = []
            for (var y = 1; y < WORLD_SIZE; y += GRID_SIZE) {
                let b = []
                let d = []
                for (var z = min; z < WORLD_SIZE; z += GRID_SIZE) {
                    let r = new THREE.Mesh(respawnGeometry, redRespawn)
                    let bl = new THREE.Mesh(respawnGeometry, blueRespawn)
                    r.position.set(x, y, z)
                    bl.position.set(x, y, z)
                    r.visible = false
                    bl.visible = false
                    this.scene.add(r)
                    this.scene.add(bl)
                    b.push(r)
                    d.push(bl)
                }
                a.push(b)
                c.push(d)
            }
            this.respawns.red.push(a)
            this.respawns.blue.push(c)
        }

        this.initComposer()

        document.body.appendChild(this.renderer.domElement)

        // resize screen
        window.addEventListener("resize", () => {
            this.camera.aspect = window.innerWidth / window.innerHeight
            this.camera.updateProjectionMatrix()
            this.renderer.setSize(window.innerWidth, window.innerHeight)
            this.initComposer()
        })

    }

    initComposer() {

        this.composer = new EffectComposer(this.renderer)
        const renderPass = new RenderPass(this.scene, this.camera)
        this.composer.addPass(renderPass)
        const antialiasPass = new SMAAPass()
        this.composer.addPass(antialiasPass)

    }

    initKeyboard() {

        document.addEventListener(
            "keydown",
            this.onKeyPressed.bind(this),
            false
        )
        document.addEventListener("keyup", this.onKeyReleased.bind(this), false)
        document.addEventListener("mousedown", this.onMouseDown.bind(this), false)
        document.addEventListener("mouseup", this.onMouseUp.bind(this), false)

        this.keysPressed = {}

    }

    initMouse() {

        this.pointerControls = new PointerLockControls(
            this.camera,
            document.body
        )

        this.pointerControls.addEventListener("lock", () => {
            document.getElementById("blocker").style.display = "none"
        })
        this.pointerControls.addEventListener("unlock", () => {
            document.getElementById("blocker").style.display = "block"
        })

        document.getElementById("blocker").addEventListener("click", () => {
            this.pointerControls.lock()
        })

    }

    initHUD() {

        this.hud = {
            ready: document.getElementById("ready"),
            redsurround: document.getElementById("redsurround"),
            bluesurround: document.getElementById("blusurround")
        }

    }

    // When connected to server
    connected(data) {

        this.id = data.id
        console.log("connected to the server, id " + this.id)

    }

    // Process server update
    updateReceived(data) {

        this.serverUpdates.push(data)

        for (const [id, player] of Object.entries(data.players)) {
            if (!(id in this.state.players)) {
                this.playerConnected({id: id, team: player.team})
            }

            let statePlayer = this.state.players[id]

            Core.interp(statePlayer.position, player.position)
            if (id != this.id) {
                statePlayer.cube.position.copy(statePlayer.position)
                statePlayer.cellCube.position.set(
                    Core.snapToGrid(statePlayer.cube.position.x) + 2,
                    Core.snapToGrid(statePlayer.cube.position.y) + 1,
                    Core.snapToGrid(statePlayer.cube.position.z) + 2
                )

                let newAngle = new THREE.Quaternion()
                newAngle.fromArray(player.angle)
                Core.sphere_interp(statePlayer.angle, newAngle)
                statePlayer.cube.rotation.setFromQuaternion(statePlayer.angle)
            }
        }

        this.prediction()

        this.hud.ready.innerText =
            data.players[this.id].ready
            ? "ready" : "waiting"
        this.hud.ready.style = "color: " + (
            data.players[this.id].ready
            ? "#8f8" : "#ff8")

        const [red, blue] = this.countSurroundings(this.state.players[this.id])
        this.hud.redsurround.innerText = red
        this.hud.bluesurround.innerText = blue

    }

    // Client prediction
    // see https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization#Client_Side_Prediction
    prediction() {

        if (this.serverUpdates.length < 1 || this.selfInputs.length < 1) {
            return
        }

        // latest state from the server
        let fromState = this.serverUpdates[this.serverUpdates.length - 1]
            .players[this.id]
        let lastInput = fromState.lastInput

        // the index in this.selfInputs of the first input after lastInput
        let firstIndex = 0
        for (let i = this.selfInputs.length - 1; i > 0; i--) {
            if (this.selfInputs[i].time < lastInput) {
                firstIndex = i + 1
                break
            }
        }
        if (firstIndex == 0) { return }

        let self = this.state.players[this.id]
        self.velocity.copy(fromState.velocity)
        self.position.copy(fromState.position)

        fromState.acceleration = new THREE.Vector3()
        while (true) {
            let dt =
                (this.selfInputs[firstIndex].time -
                    this.selfInputs[firstIndex - 1].time) /
                1000

            self.inputs.push(this.selfInputs[firstIndex])
            super.updatePlayer0(dt, self)
            super.updatePlayer1(dt, self)
            super.updatePlayer2(dt, self)

            firstIndex++
            // if (this was the most up to date "command")
            if (firstIndex >= this.selfInputs.length) { break }
        }

        // clear out the buffers
        if (this.serverUpdates.length > SERVER_UPDATE_BUFFER_SIZE) {
            this.serverUpdates.splice(
                0, this.serverUpdates.length - SERVER_UPDATE_BUFFER_SIZE
            )
        }
        if (this.selfInputs.length > INPUT_BUFFER_SIZE) {
            this.selfInputs.splice(
                0, this.selfInputs.length - INPUT_BUFFER_SIZE
            )
        }

    }

    // Process another player connecting/disconnecting
    playerConnected(data) {

        let id = data.id
        let team = data.team

        this.state.players[id] = new Core.Player()
        this.state.players[id].id = id
        this.state.players[id].team = team
        if (id != this.id) {
            this.state.players[id].three(team)
            this.scene.add(this.state.players[id].cube)
            this.scene.add(this.state.players[id].cellCube)
        }

    }

    playerDisconnected(id) {

        this.scene.remove(this.state.players[id].cube)
        this.scene.remove(this.state.players[id].cellCube)
        delete this.state.players[id]

    }

    // Render the scene
    render() {

        requestAnimationFrame((t) => this.render())
        if (this.id in this.state.players) {
            Core.interp(
                this.camera.position,
                this.state.players[this.id].position,
                0.25
            ) // NOTE: this is probably not the best way to get the smoothness, but I don't have any other ideas
        }

        let selectedObjects = []
        for (const [id, player] of Object.entries(this.state.players)) {
            if (id == this.id) { continue }
            let looking = super.lookingAt(this.state.players[this.id], player)
            if (looking != false) {
                player.cube.material.color.setHex(player.team == 0 ? 0xfe8888 : 0x8888fe)
            } else {
                player.cube.material.color.setHex(player.team == 0 ? 0xfe5757 : 0x5757fe)
            }
        }

        this.composer.render()

    }

    onKeyPressed(event) {

        let keyCode = event.which
        if (keyCode in Core.CONTROLS) {
            this.keysPressed[Core.CONTROLS[keyCode]] = true
        }

    }

    onKeyReleased(event) {

        let keyCode = event.which
        if (keyCode in Core.CONTROLS) {
            this.keysPressed[Core.CONTROLS[keyCode]] = false
        }

    }

    onMouseDown(event) {

        if (event.button == 0 && this.pointerControls.isLocked) {
            this.keysPressed[Core.CONTROLS["lmb"]] = true
        }

    }

    onMouseUp(event) {

        if (event.button == 0 && this.pointerControls.isLocked) {
            this.keysPressed[Core.CONTROLS["lmb"]] = false
        }

    }

    // Send input packet to server
    sendInput() {

        let input = new Core.Input()

        if (this.keysPressed.f ^ this.keysPressed.b) {
            input.forwardmove = this.keysPressed.b ? 1 : -1
        }
        if (this.keysPressed.l ^ this.keysPressed.r) {
            input.sidemove = this.keysPressed.r ? 1 : -1
        }

        if (this.keysPressed.j) {
            input.upmove = 1
        }

        if (this.keysPressed.a) {
            input.attack = 1
        }

        this.camera.quaternion.toArray(input.angle)
        input.angle = Core.fixedQuat(input.angle)

        this.socket.emit("input", input)
        this.selfInputs.push(input)

    }

    /* countSurroundings( player ) => [number, number]
        Count the number of players on each team in the immediate surroundings
            of p1.
     */
    countSurroundings(p1) {

        let x = Core.snapToGrid(p1.position.x),
            y = Core.snapToGrid(p1.position.y),
            z = Core.snapToGrid(p1.position.z)
        let red = 0,
            blue = 0
        for (const [id, player] of Object.entries(this.state.players)) {
            if (id == p1.id) { continue }
            let px = Core.snapToGrid(player.position.x),
                py = Core.snapToGrid(player.position.y),
                pz = Core.snapToGrid(player.position.z)
            if (Math.abs(px - x) <= 4 &&
                Math.abs(py - y) <= 4 &&
                Math.abs(pz - z) <= 4
            ) {
                if (player.team == 0) { red++ }
                else { blue++ }
            }
        }
        return [red, blue]

    }

    generation(data) {
        // reset visibility
        for (var i = 0; i < this.respawns.red.length; i++) {
            for (var j = 0; j < this.respawns.red[i].length; j++) {
                for (var k = 0; k < this.respawns.red[i][j].length; k++) {
                    this.respawns.red[i][j][k].visible = false
                    this.respawns.blue[i][j][k].visible = false
                }
            }
        }
        // set visibility
        for (var i = 0; i < data.respawns.red.length; i++) {
            this.respawns.red
                [data.respawns.red[i][0]]
                [data.respawns.red[i][1]]
                [data.respawns.red[i][2]].visible = true
        }
        for (var i = 0; i < data.respawns.blue.length; i++) {
            this.respawns.blue
                [data.respawns.blue[i][0]]
                [data.respawns.blue[i][1]]
                [data.respawns.blue[i][2]].visible = true
        }
    }

}


let client = new Client()
