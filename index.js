const http = require("http");

// Si algo falla, se apunta en el log pero el servidor sigue funcionando
process.on("uncaughtException", e => console.error("Error (el servidor sigue):", e));
process.on("unhandledRejection", e => console.error("Error (el servidor sigue):", e));
// Envuelve lo que hace la sala al recibir un mensaje: un mensaje raro no tumba nada
const safe = (name, fn) => function (...args) {
  try { return fn.apply(this, args); } catch (e) { console.error(`Error en "${name}":`, e); }
};
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
    this.skin = "noe";      // personaje: noe, sem, cam, jafet, msem, mcam, mjafet
    this.dir = "down";      // hacia dónde mira: down, up, left, right
    this.moving = false;    // si está andando (para la animación)
    this.scene = "prado";   // dónde está: prado (fuera) o casa (dentro de su choza)
  }
}
defineTypes(Player, {
  x: "number", y: "number", name: "string",
  skin: "string", dir: "string", moving: "boolean", scene: "string",
});

class GameState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
  }
}
defineTypes(GameState, { players: { map: Player } });

// Los números muy grandes (como la hora a la que se cogió una fruta) llegan como BigInt:
// se pasan a números normales para poder guardarlos y reenviarlos
function plain(v, depth = 0) {
  if (typeof v === "bigint") return Number(v);
  if (!v || typeof v !== "object" || depth > 12) return v;
  if (Array.isArray(v)) return v.map(x => plain(x, depth + 1));
  const o = {};
  for (const k of Object.keys(v)) o[k] = plain(v[k], depth + 1);
  return o;
}
const size = v => { try { return JSON.stringify(v === undefined ? null : v).length; } catch (e) { return Infinity; } };

// ---------- El mundo compartido ----------
// El servidor guarda el mundo de la partida en línea: lo que cambia (árboles talados, objetos recogidos,
// montones, obras, huerto, fruta, la hora) y las cosas de cada personaje (inventario, vida, dónde está).
// Cada juego le manda lo que cambia y él se lo pasa a los demás.
// Como Render gratis borra todo al dormirse, cada jugador guarda una copia y, si el servidor
// arranca vacío, se queda con la copia del primero que entra.
const WORLD_CATS = ["picked", "cleared", "stumpsGone", "fruitPicked", "farm", "drops", "builds", "meta", "players"];
const MAX_KEYS = 20000;          // como mucho, cosas por categoría
const MAX_VALUE = 20000;         // como mucho, letras de cada cosa
function emptyWorld() {
  const w = { rev: 0 };
  WORLD_CATS.forEach(c => { w[c] = {}; });
  return w;
}
function cleanWorld(data) {
  const w = emptyWorld();
  if (!data || typeof data !== "object") return w;
  for (const c of WORLD_CATS) {
    const src = data[c];
    if (!src || typeof src !== "object") continue;
    let n = 0;
    for (const k of Object.keys(src)) {
      if (++n > MAX_KEYS) break;
      const v = src[k];
      if (size(v) <= MAX_VALUE) w[c][String(k).slice(0, 64)] = v;
    }
  }
  w.rev = Number(data.rev) || 1;
  return w;
}
let world = emptyWorld();
let worldReady = false;          // false = aún nadie ha traído el mundo (servidor recién despertado)

// ---------- Sala de juego (máximo 7 jugadores, uno por personaje) ----------
// El mapa de El Arca mide 100 x 75 casillas de 32 px = 3200 x 2400 px
const MAP_WIDTH = 3200;
const MAP_HEIGHT = 2400;
const SKINS = ["noe", "sem", "cam", "jafet", "msem", "mcam", "mjafet"];
const DIRS = ["down", "up", "left", "right"];
const SCENES = ["prado", "casa"];

class GameRoom extends Room {
  maxClients = 7; // uno por personaje: Noé, Sem, Cam, Jafet y sus tres mujeres

  onCreate() {
    this.setState(new GameState());
    this.setMetadata({ taken: {} });

    // Cambios en el mundo: { ops: [{ c: categoría, s: { clave: valor }, d: [claves borradas] }] }
    this.onMessage("w", safe("w", (client, data) => {
      data = plain(data);
      if (!worldReady || !data || !Array.isArray(data.ops)) return;
      const ops = [];
      for (const op of data.ops.slice(0, 200)) {
        if (!op || !WORLD_CATS.includes(op.c)) continue;
        const cat = world[op.c], out = { c: op.c };
        if (op.s && typeof op.s === "object") {
          out.s = {};
          for (const k of Object.keys(op.s).slice(0, 2000)) {
            const v = op.s[k];
            if (size(v) > MAX_VALUE) continue;
            if (!(k in cat) && Object.keys(cat).length >= MAX_KEYS) continue;
            cat[k] = v; out.s[k] = v;
          }
        }
        if (Array.isArray(op.d)) {
          out.d = op.d.slice(0, 2000).map(String).filter(k => k in cat);
          out.d.forEach(k => { delete cat[k]; });
        }
        ops.push(out);
      }
      if (!ops.length) return;
      world.rev++;
      this.broadcast("w", { ops }, { except: client });
    }));

    // El juego, ya preparado, pide el mundo
    this.onMessage("hello", safe("hello", client => {
      client.send("world", { world, empty: !worldReady, lead: client.sessionId === this.leadId });
    }));

    // Copia del mundo que trae un jugador: solo se usa si el servidor aún no tiene mundo
    this.onMessage("backup", safe("backup", (client, data) => {
      data = plain(data);
      if (!worldReady) {
        world = cleanWorld(data);
        worldReady = true;
        console.log("Mundo recuperado de la copia de", client.sessionId);
        this.clients.forEach(c => c.send("world", { world, empty: false, lead: c.sessionId === this.leadId }));
      } else client.send("world", { world, empty: false, lead: client.sessionId === this.leadId });
    }));
    this.setPatchRate(50); // ~20 actualizaciones por segundo

    // Mensajes que este servidor no conoce (de otra versión del juego): se ignoran sin echar al jugador
    this.onMessage("*", () => {});

    // El cliente envía su posición (y hacia dónde mira, si anda, su personaje…); el servidor la valida y la reparte
    this.onMessage("move", safe("move", (client, data) => {
      data = plain(data);
      const player = this.state.players.get(client.sessionId);
      if (!player || !data) return;
      if (typeof data.x === "number" && typeof data.y === "number" && isFinite(data.x) && isFinite(data.y)) {
        player.x = Math.max(0, Math.min(MAP_WIDTH, data.x));
        player.y = Math.max(0, Math.min(MAP_HEIGHT, data.y));
      }
      if (DIRS.includes(data.dir)) player.dir = data.dir;
      if (typeof data.moving === "boolean") player.moving = data.moving;
      // cambiar de personaje solo si nadie más lo lleva
      if (SKINS.includes(data.skin) && data.skin !== player.skin && !this.takenBy(data.skin, client.sessionId)) {
        player.skin = data.skin;
        this.syncMeta();
      }
      if (SCENES.includes(data.scene)) player.scene = data.scene;
    }));
  }

  // El primer jugador de la sala lleva la hora del día (los demás la siguen)
  syncLead() {
    const lead = this.clients.find(c => this.state.players.has(c.sessionId));
    if (lead && lead.sessionId !== this.leadId) { this.leadId = lead.sessionId; lead.send("lead", { lead: true }); }
    if (!lead) this.leadId = null;
  }
  // ¿Lo lleva ya otro jugador? (cada personaje solo puede llevarlo uno)
  takenBy(skin, exceptId) {
    let who = null;
    this.state.players.forEach((p, id) => { if (id !== exceptId && p.skin === skin) who = p; });
    return who;
  }
  // Los personajes ocupados se publican en los datos de la sala, para que el juego los muestre antes de entrar
  syncMeta() {
    const taken = {};
    this.state.players.forEach(p => { taken[p.skin] = p.name; });
    this.setMetadata({ taken });
  }

  onJoin(client, options) {
    const player = new Player();
    player.name = String((options && options.name) || "Jugador").slice(0, 16);
    const want = options && options.skin;
    if (SKINS.includes(want)) {
      const who = this.takenBy(want);
      if (who) throw new Error(`ocupado:${want}:${who.name}`); // el juego avisa y deja elegir otro
      player.skin = want;
    } else {
      player.skin = SKINS.find(s => !this.takenBy(s)) || "noe";
    }
    if (options && typeof options.x === "number" && typeof options.y === "number") {
      player.x = Math.max(0, Math.min(MAP_WIDTH, options.x));
      player.y = Math.max(0, Math.min(MAP_HEIGHT, options.y));
    } else {
      player.x = 100 + Math.random() * 200;
      player.y = 100 + Math.random() * 200;
    }
    this.state.players.set(client.sessionId, player);
    this.syncMeta();
    this.syncLead();
    console.log(client.sessionId, "entró como", player.skin, ". Jugadores:", this.clients.length);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    this.syncMeta();
    this.syncLead();
    console.log(client.sessionId, "salió. Jugadores:", this.clients.length);
  }
}

// ---------- Servidor ----------
const app = express();
app.use(cors());
app.get("/", (req, res) => res.send("Servidor del juego funcionando"));

const server = http.createServer(app);
const gameServer = new Server({
  // mensajes de hasta 2 MB (la copia del mundo es grande; por defecto solo se admiten 4 KB)
  transport: new WebSocketTransport({ server, maxPayload: 2 * 1024 * 1024 }),
});

gameServer.define("sala", GameRoom);

// Render te da el puerto en la variable PORT
const port = Number(process.env.PORT) || 2567;
gameServer.listen(port).then(() => {
  console.log("Escuchando en el puerto", port);
});
