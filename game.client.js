import * as THREE from "./lib/three.module.js";
import * as Core from "./game.core.js";
import { GLTFLoader } from "./lib/GLTFLoader.js"
import { PointerLockControls } from "./lib/PointerLockControls.js"


const LOADER = new GLTFLoader()

const INPUT_BUFFER_SIZE = 100
const SERVER_UPDATE_BUFFER_SIZE = 100


class Client extends Core.Game {

    constructor() {
        super()

        this.selfInputs = []
        this.serverUpdates = []

        this.prediction.bind(this)

        this.initSocket()

        this.initThree()
        this.render()

        this.initKeyboard()
        this.initMouse()
        setInterval(this.sendInput.bind(this), Core.DT)

    }
    initSocket() {

        this.socket = io.connect('/', { "reconnection": false }) // TODO: dev only
        this.id

        this.socket.on("onconnected", this.connected.bind(this))

        this.socket.on("serverupdate", this.updateReceived.bind(this))

        this.socket.on("playerconnected", this.playerConnected.bind(this))
        this.socket.on("playerdisconnected", this.playerDisconnected.bind(this))

    }
    initThree() {

        this.scene = new THREE.Scene()
        this.camera = new THREE.PerspectiveCamera(
            75, window.innerWidth / window.innerHeight,
            0.1, 1000
        )

        this.renderer = new THREE.WebGLRenderer()
        this.renderer.setSize(window.innerWidth, window.innerHeight)

                // Lights
            this.scene.background = new THREE.Color( 0xa6ecea );
            this.scene.fog = new THREE.Fog( 0xffffff, 0, 300 );

            const light = new THREE.HemisphereLight( 0xeeeeff, 0x777788, 0.75 );
            light.position.set( 0.5, 1, 0.75 );
            this.scene.add( light );

            const spotlight = new THREE.SpotLight( 0xffa95c, 2 );
            spotlight.position.set( -50, 50, 50 );
            this.scene.add( spotlight );

                // World
            LOADER.load( "./world/world.glb", function ( gltf ) {
                this.scene.add( gltf.scene )
            }.bind(this), undefined, function ( error ) {
                console.error(error)
            })

        document.body.appendChild( this.renderer.domElement )

        // resize screen
        window.addEventListener( 'resize', () => {
             this.camera.aspect = window.innerWidth / window.innerHeight
             this.camera.updateProjectionMatrix()
             this.renderer.setSize( window.innerWidth, window.innerHeight )
        })

    }
    initKeyboard () {

        document.addEventListener( 'keydown', this.onKeyPressed.bind(this), false )
        document.addEventListener( 'keyup', this.onKeyReleased.bind(this), false )
        this.keysPressed = {}

    }
    initMouse() {

        this.pointerControls = new PointerLockControls(this.camera, document.body)

        this.pointerControls.addEventListener( "lock", () => {
             document.getElementById("blocker").style.display = "none"
        })
        this.pointerControls.addEventListener( "unlock", () => {
             document.getElementById("blocker").style.display = "block"
        })

        document.getElementById("blocker").addEventListener( "click", () => {
             this.pointerControls.lock()
        })

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
                this.playerConnected(id)
            }

            let statePlayer = this.state.players[id]

            Core.interp(statePlayer.position, player.position)
            if (id != this.id) {
                statePlayer.cube.position.copy(statePlayer.position)
            }

            if (id != this.id) {
                let newAngle = new THREE.Quaternion()
                newAngle.fromArray(player.angle)
                Core.sphere_interp(statePlayer.angle, newAngle)
                statePlayer.cube.rotation.setFromQuaternion(statePlayer.angle)
            }

        }

        this.prediction()

    }

    // Client prediction
    // see https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization#Client_Side_Prediction
    prediction() {

        if (this.serverUpdates.length < 1 || this.selfInputs.length < 1) {
            return
        }

        // latest state from the server
        let fromState = this.serverUpdates[this.serverUpdates.length - 1].players[this.id]
        let lastInput = fromState.lastInput

        // the index in this.selfInputs of the first input after lastInput
        let firstIndex = 0
        for (let i = this.selfInputs.length-1; i > 0; i--) {
            if (this.selfInputs[i].time < lastInput) {
                firstIndex = i + 1
                break
            }
        }
        if (firstIndex == 0) { return }

        let self = this.state.players[this.id]
        self.velocity.copy(fromState.velocity)
        self.position.copy(fromState.position)

        let toState = new Core.Player()
        fromState.acceleration = new THREE.Vector3()
        while (true) {
            let dt = (this.selfInputs[firstIndex].time - this.selfInputs[firstIndex-1].time) / 1000

            self.inputs.push(this.selfInputs[firstIndex])
            super.updatePlayer1(dt, self)
            super.updatePlayer2(dt, self)

            firstIndex++
            // if (this was the most up to date "command")
            if (firstIndex >= this.selfInputs.length) {
                break
            }
        }

        this.camera.position.copy(self.position)

        // clear out the buffers
        if (this.serverUpdates.length > SERVER_UPDATE_BUFFER_SIZE) {
            this.serverUpdates.splice(0, this.serverUpdates.length-SERVER_UPDATE_BUFFER_SIZE)
        }
        if (this.selfInputs.length > INPUT_BUFFER_SIZE) {
            this.selfInputs.splice(0, this.selfInputs.length-INPUT_BUFFER_SIZE)
        }

    }

    // Process another player connecting
    playerConnected(id) {
        this.state.players[id] = new Core.Player()
        if (id != this.id) {
            this.state.players[id].three()
            this.scene.add(this.state.players[id].cube)
        }
    }

    // Process another player disconnecting
    playerDisconnected(id) {
        let cube = this.state.players[id].cube
        cube.geometry.dispose()
        cube.material.dispose()
        this.scene.remove( cube )
        delete this.state.players[id]
    }


    // Render the scene
    render() {
        requestAnimationFrame((t) => this.render())
        this.renderer.render(this.scene, this.camera)
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

        this.camera.quaternion.toArray(input.angle)
        input.angle = Core.fixedQuat(input.angle)

        this.socket.emit("input", input)
        this.selfInputs.push(input)

    }

}


let client = new Client()
