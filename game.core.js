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
const PLAYER_ACCEL = 60
const FRICTION_ACCEL = -PLAYER_ACCEL/4
const GRAVITY_ACCEL = -9.8
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

// Class that is extended by the server and client classes
class Game {

    constructor() {
        this.state = new State()
    }

    /* processInput( Player ) => void
        Use the player's inputs to set their acceleration,
            apply a friction force based on their velocity,
            and then clear the processed inputs.
     */
    processInput(player) {

        for (let i = 0; i < player.inputs.length; i++) {

            let input = player.inputs[i]

            player.acceleration.z = input.forwardmove * PLAYER_ACCEL
            player.acceleration.x = input.sidemove * PLAYER_ACCEL

            player.velocity.y = input.upmove > 0 && player.position.y == 0 ? input.upmove * 5 : player.velocity.y

            player.angle.fromArray(input.angle)

        }

        // friction forces
        player.moving = player.acceleration.x != 0 || player.acceleration.z != 0
        player.acceleration.z += FRICTION_ACCEL * Math.sign(player.velocity.z)
        player.acceleration.x += FRICTION_ACCEL * Math.sign(player.velocity.x)

        // gravity forces
        player.acceleration.y = GRAVITY_ACCEL

    }

    /* collision( vector, Player ) => void
        Check for collision with a player and a delta position vector.
     */
    collision(dir, player) {
        let oldPos = player.position
        let newPos = player.position.clone().add(dir)

        // world borders
        if (newPos.y < 0) { dir.y = -oldPos.y; player.velocity.y = 0 }

        if (newPos.x < -32) { dir.x = -32 - oldPos.x; player.velocity.x = 0 }
        if (newPos.x >  32) { dir.x =  32 - oldPos.x; player.velocity.x = 0 }
        if (newPos.z < -32) { dir.z = -32 - oldPos.z; player.velocity.z = 0 }
        if (newPos.z >  32) { dir.z =  32 - oldPos.z; player.velocity.z = 0 }
    }

    /* updatePlayer1( number, Player ) => void
        Use the delta time and player's acceleration to update their position with
            velocity verlet.
     */
    updatePlayer1(dt, player) {

        this.processInput(player)

        if (player.inputs.length > 0) {
            player.lastInput = player.inputs[player.inputs.length - 1].time
        }
        player.inputs = []

        let dir = verlet1(dt, player.acceleration, player.velocity)

        let rot = player.angle.clone()
        rot.x = 0
        rot.z = 0
        rot.normalize()
        dir.applyQuaternion(rot)

        dir.x = clamp(dir.x, -XZ_VELOCITY_CLAMP, XZ_VELOCITY_CLAMP)
        dir.z = clamp(dir.z, -XZ_VELOCITY_CLAMP, XZ_VELOCITY_CLAMP)

        this.collision(dir, player)

        player.position.add(dir)

    }

    /* updatePlayer2( number, Player ) => void
        Use the delta time and player's acceleration to update their velocity with
            velocity verlet.
     */
    updatePlayer2(dt, player) {

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
            difference.y = 0
            difference.multiplyScalar(dt)
            let xzSpeed = velocity.clone()
            xzSpeed.y = 0
            if (difference.length() >= xzSpeed.length()) {
                // stop it from reversing the movement
                verlet2(dt, acceleration, velocity)
                velocity.x = 0
                velocity.z = 0
            } else {
                verlet2(dt, acceleration, velocity)
            }
        }

        // clamp velocity
        velocity.x = clamp(velocity.x, -XZ_VELOCITY_CLAMP, XZ_VELOCITY_CLAMP)
        velocity.z = clamp(velocity.z, -XZ_VELOCITY_CLAMP, XZ_VELOCITY_CLAMP)

        // round off the position and velocity
        fixedVec(player.velocity)
        fixedVec(player.position)

    }

}


/* fixedVec( vector ) => void
    Rounds a vector to three decimal places. Directly modifies parameter.
 */
function fixedVec (vector) {
    vector.x = Math.round(vector.x*1000) / 1000
    vector.y = Math.round(vector.y*1000) / 1000
    vector.z = Math.round(vector.z*1000) / 1000
}
/* fixedQuat( array representation of quaternion ) => array
    Rounds a quaternion to three decimal places.
 */
function fixedQuat (q) {
    return q.map(x => Math.round(x*1000) / 1000)
}

/* clamp( number, number, number ) => number
    Clamps a number between a maximum and minimum.
 */
function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num;
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
        p1.lerp(p2, 0.4)
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


export {
    DT, CONTROLS, PLAYER_ACCEL, FRICTION_ACCEL, XZ_VELOCITY_CLAMP,
    Input, Player, State, Game,
    fixedVec, fixedQuat, verlet1, verlet2, interp, sphere_interp
}
