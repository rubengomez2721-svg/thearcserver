const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server, Room } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { Schema, MapSchema, defineTypes } = require("@colyseus/schema");

// ---------- Estado compartido (lo que ven todos los jugadores) ----------
class Player extends Schema {
  constructor() {
    super();
    this.x = 100;
    this.y = 100;
    this.name = "";
  }
}
defineTypes(Player, { x: "number", y: "number", name: "string" });

class GameState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
  }
}
defineTypes(GameState, { players: { map: Player } });

// ---------- Sala de juego (máximo 8 jugadores) ----------
const MAP_WIDTH = 2000;  // ajusta al tamaño de tu mapa
const MAP_HEIGHT = 2000;

class GameRoom extends Room {
  maxClients = 8;

  onCreate() {
    this.setState(new GameState());
    this.setPatchRate(50); // ~20 actualizaciones por segundo

    // El cliente envía su posición; el servidor la valida y la reparte
    this.onMessage("move", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (typeof data.x !== "number" || typeof data.y !== "number") return;
      player.x = Math.max(0, Math.min(MAP_WIDTH, data.x));
      player.y = Math.max(0, Math.min(MAP_HEIGHT, data.y));
    });
  }

  onJoin(client, options) {
    const player = new Player();
    player.name = String((options && options.name) || "Jugador").slice(0, 16);
    player.x = 100 + Math.random() * 200;
    player.y = 100 + Math.random() * 200;
    this.state.players.set(client.sessionId, player);
    console.log(client.sessionId, "entró. Jugadores:", this.clients.length);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    console.log(client.sessionId, "salió. Jugadores:", this.clients.length);
  }
}

// ---------- Servidor ----------
const app = express();
app.use(cors());
app.get("/", (req, res) => res.send("Servidor del juego funcionando"));

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define("sala", GameRoom);

// Render te da el puerto en la variable PORT
const port = Number(process.env.PORT) || 2567;
gameServer.listen(port).then(() => {
  console.log("Escuchando en el puerto", port);
});
