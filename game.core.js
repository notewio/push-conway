import * as THREE from "./lib/three.module.js";


// The fixed delta time for physics updates.
const DT = 1000 / 60

// Mapping of key codes to game actions.
const CONTROLS = {
    87: "f",    83: "b",
    65: "l",    68: "r",

    32: "j",

    "lmb": "a"
}

// Physics variables.
const PLAYER_ACCEL = 200
const FRICTION_ACCEL = -PLAYER_ACCEL/2
const XZ_VELOCITY_CLAMP = 4


// Class representing a user input.
class Input {
    constructor() {

        this.time = new Date().getTime()

        this.angle = [] // THREE.Quaternion() - gets sent incorrectly over network, so have to convert to array

        this.forwardmove = 0
        this.sidemove = 0
        this.upmove = 0

    }
}

// Class representing a player in the game.
class Player {

    constructor() {

        this.position = new THREE.Vector3()
        this.velocity = new THREE.Vector3()
        this.acceleration = new THREE.Vector3()

        this.angle = new THREE.Quaternion()

        this.inputs = []
        this.lastInput = 0
        this.moving = false

    }

    /* three() => void
        Client-side function that creates a cube to show the player on screen.
     */
    three() {

        this.geometry = new THREE.BoxGeometry()
        this.material = new THREE.MeshPhongMaterial({ color: 0x00ff00 })
        this.cube = new THREE.Mesh(this.geometry, this.material)

    }

}

// Class representing a game state, to be broadcast to the clients
class State {
    constructor() {
        this.time = new Date().getTime()
        this.players = {}
    }
}


/* verlet1( number, vector, vector ) => vector
    Function for the first part of the velocity verlet calculations. Returns
        the delta position.
 */
function verlet1 (dt, acceleration, velocity) {
    // position += dt * (velocity + dt * acceleration / 2);

    let add = new THREE.Vector3()

    add.copy(acceleration)
    add.multiplyScalar(dt / 2)

    add.add(velocity)

    add.multiplyScalar(dt)

    return add

}

/* verlet2( number, vector, vector ) => void
    Function for the second part of the velocity verlet calculations. Directly
        changes the velocity parameter.
 */
function verlet2 (dt, acceleration, velocity) {
    // velocity += dt * (acceleration + new acceleration) / 2
    // velocity += dt * acceleration

    velocity.addScaledVector(acceleration, dt)

}

/* interp( vector, vector ) => void
    Interpolates two vectors exponentially. Directly changes the p1 parameter.
 */
function interp (p1, p2) {

    let distance = p1.distanceTo(p2)

    if (distance > XZ_VELOCITY_CLAMP) { // if we're really far off, don't bother interpolating, just snap to the position
        p1.copy(p2)
    } else if (distance > 0.1) {
        p1.lerp(p2, 0.1)
    } // if we're really close, we're fine, don't need to do anything

}

/* sphere_interp( quaternion, quaternion ) => void
    Do a sphere interpolation between the two quaternions. Directly changes the
        q1 parameter.
 */
function sphere_interp (q1, q2) {

    // NOTE: do I have to do the same distance things as in interp? I don't know
    //          how expensive finding the angle between two quaternions is or
    //          if it's even worth it because it's only visual
    q1.slerp(q2, 0.75)

}

/* processInput( Player ) => void
    Use the player's inputs to set their acceleration,
        apply a friction force based on their velocity,
        and then clear the processed inputs.
 */
function processInput(player) {

    for (let i = 0; i < player.inputs.length; i++) {

        let input = player.inputs[i]

        player.acceleration.z = input.forwardmove * PLAYER_ACCEL
        player.acceleration.x = input.sidemove * PLAYER_ACCEL

        // TODO: jumping

        player.angle.fromArray(input.angle)

    }

    // friction forces
    player.moving = player.acceleration.x != 0 || player.acceleration.z != 0
    player.acceleration.z += FRICTION_ACCEL * Math.sign(player.velocity.z)
    player.acceleration.x += FRICTION_ACCEL * Math.sign(player.velocity.x)

}

/* updatePlayer1( number, Player ) => void
    Use the delta time and player's acceleration to update their position with
        velocity verlet.
 */
function updatePlayer1(dt, player) {

    processInput(player)

    if (player.inputs.length > 0) {
        player.lastInput = player.inputs[player.inputs.length - 1].time
    }
    player.inputs = []

    let dir = verlet1(dt, player.acceleration, player.velocity)
    dir.applyQuaternion(player.angle)
    dir.clampScalar(-XZ_VELOCITY_CLAMP, XZ_VELOCITY_CLAMP)

    player.position.add(dir)

}

/* updatePlayer2( number, Player ) => void
    Use the delta time and player's acceleration to update their velocity with
        velocity verlet.
 */
function updatePlayer2(dt, player) {

    //verlet2(dt, player.acceleration, player.velocity)

    let acceleration = player.acceleration
    let velocity = player.velocity

    // if the player's moving...
    if (player.moving) {
        verlet2(dt, acceleration, velocity)
    }
    // otherwise, friction
    else {

        let difference = acceleration.clone()
        difference.multiplyScalar(dt)
        if (difference.length()+0.001 >= velocity.length()) {
            // stop it from reversing the movement
            velocity.x = 0
            velocity.z = 0
        } else {
            verlet2(dt, acceleration, velocity)
        }
    }

    // clamp velocity
    velocity.clampScalar(-XZ_VELOCITY_CLAMP, XZ_VELOCITY_CLAMP)

}

export {
    DT, CONTROLS, PLAYER_ACCEL, FRICTION_ACCEL, XZ_VELOCITY_CLAMP,
    Input, Player, State,
    verlet1, verlet2, interp, sphere_interp, processInput, updatePlayer1, updatePlayer2
}
