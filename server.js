const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

const players = new Map();
const SPAWNS = [
  [-18, 1.7, -18], [18, 1.7, 18], [-18, 1.7, 18], [18, 1.7, -18],
  [0, 1.7, -20], [0, 1.7, 20], [-20, 1.7, 0], [20, 1.7, 0]
];

function randomSpawn() {
  return SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
}
function safeName(name) {
  const s = String(name || "Player").replace(/[<>]/g, "").trim().slice(0, 16);
  return s || "Player";
}
function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    x: p.x, y: p.y, z: p.z,
    yaw: p.yaw,
    pitch: p.pitch,
    hp: p.hp,
    kills: p.kills,
    deaths: p.deaths,
    alive: p.alive
  };
}

io.on("connection", (socket) => {
  socket.on("join", (payload = {}) => {
    const spawn = randomSpawn();
    const p = {
      id: socket.id,
      name: safeName(payload.name),
      x: spawn[0], y: spawn[1], z: spawn[2],
      yaw: 0, pitch: 0,
      hp: 100,
      kills: 0,
      deaths: 0,
      alive: true,
      lastShot: 0
    };
    players.set(socket.id, p);
    socket.emit("joined", {
      self: publicPlayer(p),
      players: [...players.values()].map(publicPlayer)
    });
    socket.broadcast.emit("playerJoined", publicPlayer(p));
    io.emit("scoreboard", [...players.values()].map(publicPlayer));
  });

  socket.on("state", (s = {}) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    const x = Number(s.x), y = Number(s.y), z = Number(s.z);
    const yaw = Number(s.yaw), pitch = Number(s.pitch);
    if ([x,y,z,yaw,pitch].some(v => !Number.isFinite(v))) return;

    // Loose anti-teleport clamp for a prototype.
    const dx = x - p.x, dz = z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 3.5) {
      p.x = Math.max(-24, Math.min(24, x));
      p.z = Math.max(-24, Math.min(24, z));
      p.y = Math.max(1.65, Math.min(4, y));
    }
    p.yaw = yaw;
    p.pitch = Math.max(-1.45, Math.min(1.45, pitch));

    socket.broadcast.volatile.emit("playerState", publicPlayer(p));
  });

  socket.on("shoot", (data = {}) => {
    const shooter = players.get(socket.id);
    if (!shooter || !shooter.alive) return;

    const now = Date.now();
    if (now - shooter.lastShot < 105) return;
    shooter.lastShot = now;

    const targetId = String(data.targetId || "");
    const target = players.get(targetId);
    if (!target || !target.alive || target.id === shooter.id) {
      socket.broadcast.emit("shotFx", {
        shooterId: shooter.id,
        hit: false,
        ox: shooter.x, oy: shooter.y, oz: shooter.z,
        dx: Number(data.dx)||0, dy: Number(data.dy)||0, dz: Number(data.dz)||0
      });
      return;
    }

    const distance = Math.hypot(target.x - shooter.x, target.z - shooter.z);
    if (distance > 55) return;

    const damage = data.headshot ? 55 : 28;
    target.hp = Math.max(0, target.hp - damage);

    io.to(target.id).emit("damage", {
      hp: target.hp,
      from: shooter.name,
      amount: damage
    });

    io.emit("shotFx", {
      shooterId: shooter.id,
      targetId: target.id,
      hit: true,
      ox: shooter.x, oy: shooter.y, oz: shooter.z,
      tx: target.x, ty: target.y, tz: target.z
    });

    if (target.hp <= 0) {
      target.alive = false;
      target.deaths++;
      shooter.kills++;

      io.emit("killfeed", {
        killer: shooter.name,
        victim: target.name
      });
      io.to(target.id).emit("died", { killer: shooter.name });
      io.emit("scoreboard", [...players.values()].map(publicPlayer));

      setTimeout(() => {
        const current = players.get(target.id);
        if (!current) return;
        const spawn = randomSpawn();
        current.x = spawn[0]; current.y = spawn[1]; current.z = spawn[2];
        current.hp = 100;
        current.alive = true;
        io.to(current.id).emit("respawn", publicPlayer(current));
        io.emit("playerRespawned", publicPlayer(current));
      }, 3000);
    } else {
      io.emit("scoreboard", [...players.values()].map(publicPlayer));
    }
  });

  socket.on("disconnect", () => {
    const p = players.get(socket.id);
    players.delete(socket.id);
    if (p) {
      socket.broadcast.emit("playerLeft", socket.id);
      io.emit("scoreboard", [...players.values()].map(publicPlayer));
    }
  });
});

server.listen(PORT, () => {
  console.log(`STRIKEPOINT ONLINE running on http://localhost:${PORT}`);
});