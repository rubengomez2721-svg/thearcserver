// Ejemplo de cliente para Phaser 3 (colyseus.js 0.15).
// En tu index.html, antes de tu juego:
//   <script src="https://unpkg.com/colyseus.js@^0.15.0/dist/colyseus.js"></script>

// En local usa "ws://localhost:2567". Ya desplegado en Render, usa "wss://TU-SERVIDOR.onrender.com"
const SERVER_URL = "ws://localhost:2567";

class JuegoScene extends Phaser.Scene {
  constructor() {
    super("juego");
    this.sprites = {}; // un sprite por jugador
  }

  async create() {
    this.cursors = this.input.keyboard.createCursorKeys();

    const client = new Colyseus.Client(SERVER_URL);
    // Une a una sala existente con hueco o crea una nueva (máx. 8)
    this.room = await client.joinOrCreate("sala", { name: "Jugador" });

    // Cuando entra un jugador (incluido tú), crea su sprite
    this.room.state.players.onAdd((player, id) => {
      const rect = this.add.rectangle(player.x, player.y, 32, 32,
        id === this.room.sessionId ? 0x00ff00 : 0xff8800);
      this.sprites[id] = rect;
      player.onChange(() => {
        // Los demás se suavizan hacia su posición; el propio se mueve en local
        rect.targetX = player.x;
        rect.targetY = player.y;
      });
    });

    // Cuando sale un jugador, quita su sprite
    this.room.state.players.onRemove((player, id) => {
      if (this.sprites[id]) {
        this.sprites[id].destroy();
        delete this.sprites[id];
      }
    });
  }

  update() {
    if (!this.room) return;

    // Mueve tu propio personaje en local (se siente instantáneo) y avisa al servidor
    const mio = this.sprites[this.room.sessionId];
    if (mio) {
      const vel = 3;
      if (this.cursors.left.isDown) mio.x -= vel;
      if (this.cursors.right.isDown) mio.x += vel;
      if (this.cursors.up.isDown) mio.y -= vel;
      if (this.cursors.down.isDown) mio.y += vel;
      this.room.send("move", { x: mio.x, y: mio.y });
    }

    // Suaviza el movimiento de los demás jugadores (interpolación)
    for (const id in this.sprites) {
      if (id === this.room.sessionId) continue;
      const s = this.sprites[id];
      if (s.targetX !== undefined) {
        s.x = Phaser.Math.Linear(s.x, s.targetX, 0.2);
        s.y = Phaser.Math.Linear(s.y, s.targetY, 0.2);
      }
    }
  }
}

// Añade JuegoScene a la lista "scene" de tu configuración de Phaser.
