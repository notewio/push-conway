import express from "express"
import { Server as ioServer } from "socket.io"
import { createServer } from "http"

import { fileURLToPath } from "url"
import { dirname } from "path"
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import { v4 as UUID } from "uuid"

import { Server } from "./game.server.js"
import * as Core from "./game.core.js"

const app = express()
const port = 4004
const http = createServer(app)
const io = new ioServer(http)

app.get("/", (req, res) => {
    console.log("express\t:: loading index")
    res.sendFile(__dirname + "/index.html")
})

app.get("/*", (req, res, next) => {
    var file = req.params[0]
    res.sendFile(__dirname + "/" + file)
})

http.listen(port, () => {
    console.log(`express\t:: App listening at localhost:${port}`)
})

const game = new Server()

game.socket = io

io.on("connection", (client) => {

    let id = UUID()

    client.on("usernamechange", data => {

        if (game.started) {
            client.emit("error", "Game has already started")
            return
        }
        if (game.state.players.length == Core.MAX_PLAYERS) {
            client.emit("error", "Game is full")
            return
        }

        if (!game.state.players.hasOwnProperty(id)) {
            client.emit("onconnected", { id: id })
            game.addPlayer(id)
            console.log(`io\t:: player ${id} ${data} connected`)
        }

        game.state.players[id].username = data

        game.checkGameStart()

    })

    client.on("readyup", data => {
        game.state.players[id].readied = data
        game.checkGameStart()
    })

    client.on("input", (data) => {
        game.state.players[id].inputs.push(data)
    })

    client.on("disconnect", () => {
        game.removePlayer(id)
        console.log("io\t:: client disconnected " + id)
    })

})

const admin = io.of("/admin")
admin.on("connection", (client) => {
    console.log("io\t:: admin connected")

    client.emit("update", game.lastState)

    client.on("generation", (data) => {
        game.conwayGeneration()
    })

    setInterval(() => {
        client.emit("update", game.lastState)
    }, 3000)
})
