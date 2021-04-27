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

    client.emit("onconnected", { id: id })

    game.addPlayer(id)

    console.log("io\t:: player " + id + " connected")

    client.on("input", (data) => {
        game.state.players[id].inputs.push(data)
    })

    client.on("disconnect", () => {
        game.removePlayer(id)
        console.log("io\t:: client disconnected " + id)
    })

})
