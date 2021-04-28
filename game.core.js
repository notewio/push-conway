import * as THREE from "./lib/three.module.js"


// The fixed delta time for physics updates.
const DT = 1000 / 60

// Mapping of key codes to game actions.
const CONTROLS = {
    87: "f", 83: "b",
    65: "l", 68: "r",
    32: "j",
    "lmb": "a",
}

// Physics variables.
const PLAYER_ACCEL = 60
const FRICTION_ACCEL = -PLAYER_ACCEL / 6
const GRAVITY_ACCEL = -9.8
const XZ_VELOCITY_CLAMP = 4
const JUMP_VELOCITY = 5
const PUSH_VELOCITY = 18

// Sizes.
const GRID_SIZE = 4
const WORLD_SIZE = 32
const PLAYER_SIZE = 1
const PUSH_DISTANCE = 6
const PUSH_RADIUS = Math.PI / 3

// Misc.
const PUSH_COOLDOWN = 5000


// Class representing a user input.
class Input {

    constructor() {

        this.time = new Date().getTime()

        this.angle = [] // THREE.Quaternion() - gets sent incorrectly over network, so have to convert to array

        this.forwardmove = 0
        this.sidemove = 0
        this.upmove = 0

        this.attack = 0

    }

}

// THREE materials
const playerGeometry = new THREE.BoxGeometry()
const playerMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 })
const cellGeometry = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, GRID_SIZE)
const cellMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 0.2,
})
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

        this.pushedAngle = new THREE.Vector3()
        this.pushing = false
        this.inPush = false // are we still in the air after being pushed
        this.lastPush = 0

        this.onFloor = false

        this.id

    }

    /* three() => void
        Client-side function that creates a cube to show the player on screen.
     */
    three() {
        this.cube = new THREE.Mesh(playerGeometry, playerMaterial)
        this.cellCube = new THREE.Mesh(cellGeometry, cellMaterial)
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

        // movement forces
        for (let i = 0; i < player.inputs.length; i++) {
            let input = player.inputs[i]

            if (!player.inPush) {
                player.acceleration.z = input.forwardmove * PLAYER_ACCEL
                player.acceleration.x = input.sidemove * PLAYER_ACCEL

                player.velocity.y =
                    input.upmove > 0 && player.onFloor
                        ? input.upmove * JUMP_VELOCITY
                        : player.velocity.y
            }

            player.angle.fromArray(input.angle)

            let nowPushing = input.attack == 1
            player.pushing = nowPushing && !player.pushing // there was a change from not pushing to pushing
        }

        // friction forces
        player.moving = player.acceleration.x != 0 || player.acceleration.z != 0
        if (player.onFloor) {
            player.acceleration.z += FRICTION_ACCEL * Math.sign(player.velocity.z)
            player.acceleration.x += FRICTION_ACCEL * Math.sign(player.velocity.x)
        }

        // gravity forces
        player.acceleration.y = GRAVITY_ACCEL

    }

    /* collision( vector, Player ) => void
        Check for collision with a player and a delta position vector.
     */
    collision(dir, player) {

        let oldPos = player.position
        let newPos = player.position.clone().add(dir)
        player.onFloor = false

        // world borders
        if (newPos.y <= 0) {
            dir.y = -oldPos.y
            player.velocity.y = 0
            player.onFloor = true
            player.inPush = false
        }

        let lb = -WORLD_SIZE + PLAYER_SIZE,
            rb = WORLD_SIZE - PLAYER_SIZE
        if (newPos.x <= lb) { dir.x = lb - oldPos.x }
        if (newPos.x >= rb) { dir.x = rb - oldPos.x }
        if (newPos.z <= lb) { dir.z = lb - oldPos.z }
        if (newPos.z >= rb) { dir.z = rb - oldPos.z }

        newPos = player.position.clone().add(dir)

        for (const [id, other] of Object.entries(this.state.players)) {
            if (id == player.id) { continue }

            let sx = snapToGrid(other.position.x) - PLAYER_SIZE,
                sy = snapToGrid(other.position.y) - PLAYER_SIZE,
                sz = snapToGrid(other.position.z) - PLAYER_SIZE
            let mx = sx + GRID_SIZE + 2 * PLAYER_SIZE, // NOTE: what??? it still goes right up against the player if I leave it as 1
                my = sy + GRID_SIZE + 2 * PLAYER_SIZE,
                mz = sz + GRID_SIZE + 2 * PLAYER_SIZE

            if (
                sx <= newPos.x && mx >= newPos.x &&
                sy <= newPos.y && my >= newPos.y &&
                sz <= newPos.z && mz >= newPos.z
            ) {
                if (oldPos.x <= sx) { dir.x = sx - oldPos.x }
                if (oldPos.x >= mx) { dir.x = mx - oldPos.x }
                if (oldPos.y <= sy) {
                    dir.y = sy - oldPos.y
                    player.velocity.y = 0
                    player.onFloor = true
                    player.inPush = false
                }
                if (oldPos.y >= my) {
                    dir.y = my - oldPos.y
                    player.velocity.y = 0
                    player.onFloor = true
                    player.inPush = false
                }
                if (oldPos.z <= sz) { dir.z = sz - oldPos.z }
                if (oldPos.z >= mz) { dir.z = mz - oldPos.z }
            }
        }

    }

    /* updatePlayer0( number, Player ) => void
        Process the player's inputs and see who they've pushed.
     */
    updatePlayer0(dt, player) {

        this.processInput(player)
        if (player.inputs.length > 0) {
            player.lastInput = player.inputs[player.inputs.length - 1].time
        }
        player.inputs = []

        if (player.pushing && new Date().getTime() - player.lastPush > PUSH_COOLDOWN) {// TODO: nasty calls to getTime, find some cleaner way to use the time...
            for (const [id, other] of Object.entries(this.state.players)) {
                if (other.id == player.id) { continue }
                let looking = this.lookingAt(player, other)
                if (looking != false) {
                    other.pushedAngle.copy(looking)
                } else {
                    other.pushedAngle.set(0, 0, 0)
                }
            }
            player.lastPush = new Date().getTime()
        }

    }

    /* updatePlayer1( number, Player ) => void
        Use the delta time and player's acceleration to update their position with
            velocity verlet.
     */
    updatePlayer1(dt, player) {

        if (player.pushedAngle.manhattanLength() != 0) {
            player.velocity.copy(player.pushedAngle)
            player.velocity.multiplyScalar(PUSH_VELOCITY)
            player.pushedAngle.set(0, 0, 0)
            player.acceleration.set(0, GRAVITY_ACCEL, 0)
            player.inPush = true
        }

        let dir = verlet1(dt, player.acceleration, player.velocity)

        if (!player.inPush) {
            let rot = player.angle.clone()
            rot.x = 0
            rot.z = 0
            rot.normalize()
            dir.applyQuaternion(rot)
        }

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

        let acceleration = player.acceleration
        let velocity = player.velocity

        // if the player's moving and/or in the air...
        if (player.moving || !player.onFloor) {
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

    /* lookingAt( player, player ) => bool
        Check if p1's view angle is pointing at p2.
     */
    lookingAt(p1, p2) {

        // first, check distance
        if (p1.position.distanceTo(p2.position) > PUSH_DISTANCE) {
            return false
        }

        // vector from p1 to p2
        let p = p2.position.clone().sub(p1.position)
        // vector of p1's view angle
        let v = new THREE.Vector3(0, 0, -1)
        v.applyQuaternion(p1.angle)

        let difference = v.angleTo(p)
        if (difference < PUSH_RADIUS) {
            return v.normalize()
        } else {
            return false
        }

    }

}

/* fixedVec( vector ) => void
    Rounds a vector to three decimal places. Directly modifies parameter.
 */
function fixedVec(vector) {
    vector.x = Math.round(vector.x * 1000) / 1000
    vector.y = Math.round(vector.y * 1000) / 1000
    vector.z = Math.round(vector.z * 1000) / 1000
}
/* fixedQuat( array representation of quaternion ) => array
    Rounds a quaternion to three decimal places.
 */
function fixedQuat(q) {
    return q.map((x) => Math.round(x * 1000) / 1000)
}

/* clamp( number, number, number ) => number
    Clamps a number between a maximum and minimum.
 */
function clamp(num, min, max) {
    return num <= min ? min : num >= max ? max : num
}

/* verlet1( number, vector, vector ) => vector
    Function for the first part of the velocity verlet calculations. Returns
        the delta position.
 */
function verlet1(dt, acceleration, velocity) {

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
function verlet2(dt, acceleration, velocity) {

    // velocity += dt * (acceleration + new acceleration) / 2
    // velocity += dt * acceleration
    velocity.addScaledVector(acceleration, dt)

}

/* interp( vector, vector, optional number ) => void
    Interpolates two vectors exponentially. Directly changes the p1 parameter.
 */
function interp(p1, p2, amount) {

    let distance = p1.distanceTo(p2)
    if (distance > XZ_VELOCITY_CLAMP) {
        // if we're really far off, don't bother interpolating, just snap to the position
        p1.copy(p2)
    } else if (distance > 0.1) {
        p1.lerp(p2, amount || 0.4)
    } // if we're really close, we're fine, don't need to do anything

}

/* sphere_interp( quaternion, quaternion ) => void
    Do a sphere interpolation between the two quaternions. Directly changes the
        q1 parameter.
 */
function sphere_interp(q1, q2) {
    // NOTE: do I have to do the same distance things as in interp? I don't know how expensive finding the angle between two quaternions is or if it's even worth it because it's only visual
    q1.slerp(q2, 0.75)
}

/* snapToGrid( number ) => number
    Round a position to the grid.
 */
function snapToGrid(n) {
    return Math.floor(n / GRID_SIZE) * GRID_SIZE
}

export {
    DT, CONTROLS, GRID_SIZE, WORLD_SIZE, PUSH_COOLDOWN,
    Input, Player, State, Game,
    fixedQuat, interp, sphere_interp, snapToGrid,
}
