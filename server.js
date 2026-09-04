
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "users.json");

app.use(express.json({ limit: "64kb" }));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "watchroom-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
});
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));
io.engine.use(sessionMiddleware);

function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}
function saveUsers() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), "utf8");
}

let users = loadUsers();
const adminName = "админ67";
if (!users.some(u => u.username === adminName)) {
  users.push({
    id: "admin-fixed",
    username: adminName,
    passwordHash: bcrypt.hashSync("220419", 10),
    role: "admin",
    banned: false,
    createdAt: new Date().toISOString()
  });
  saveUsers();
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    banned: !!u.banned,
    createdAt: u.createdAt
  };
}

function requireAuth(req, res, next) {
  const u = users.find(x => x.id === req.session.userId);
  if (!u) return res.status(401).json({ error: "UNAUTHORIZED" });
  if (u.banned) return res.status(403).json({ error: "BANNED" });
  req.user = u;
  next();
}
function requireAdmin(req, res, next) {
  const u = users.find(x => x.id === req.session.userId);
  if (!u || u.role !== "admin") return res.status(403).json({ error: "FORBIDDEN" });
  req.user = u;
  next();
}

app.post("/api/register", async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");

  if (!/^[a-zа-яё0-9_]{3,24}$/i.test(username)) {
    return res.status(400).json({ error: "BAD_USERNAME" });
  }
  if (password.length < 6 || password.length > 72) {
    return res.status(400).json({ error: "BAD_PASSWORD" });
  }
  if (users.some(u => u.username === username)) {
    return res.status(409).json({ error: "USERNAME_TAKEN" });
  }

  const user = {
    id: "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    username,
    passwordHash: await bcrypt.hash(password, 10),
    role: "user",
    banned: false,
    createdAt: new Date().toISOString()
  };
  users.push(user);
  saveUsers();
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/login", async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  const user = users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "INVALID_LOGIN" });
  }
  if (user.banned) return res.status(403).json({ error: "BANNED" });
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  const user = users.find(u => u.id === req.session.userId);
  if (!user || user.banned) return res.status(401).json({ user: null });
  res.json({ user: publicUser(user) });
});

const rooms = new Map();
const onlineUsers = new Map(); // userId -> set(socketId)

function roomList(includePrivate = false) {
  return [...rooms.values()]
    .filter(r => includePrivate || r.isPublic)
    .map(r => ({
      id: r.id,
      name: r.name,
      videoUrl: r.videoUrl,
      owner: r.owner,
      ownerId: r.ownerId,
      isPublic: r.isPublic,
      count: r.members.size,
      createdAt: r.createdAt
    }));
}
function emitRooms() {
  io.emit("rooms-list", roomList(false));
}

app.get("/api/admin/stats", requireAdmin, (req, res) => {
  res.json({
    users: users.length,
    onlineUsers: onlineUsers.size,
    activeRooms: rooms.size,
    publicRooms: roomList(false).length,
    totalRoomMembers: [...rooms.values()].reduce((n, r) => n + r.members.size, 0)
  });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const list = users.map(u => ({
    ...publicUser(u),
    online: onlineUsers.has(u.id)
  }));
  res.json({ users: list });
});

app.get("/api/admin/rooms", requireAdmin, (req, res) => {
  res.json({ rooms: roomList(true) });
});

app.post("/api/admin/users/:id/ban", requireAdmin, (req, res) => {
  const target = users.find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: "NOT_FOUND" });
  if (target.role === "admin") return res.status(400).json({ error: "CANT_BAN_ADMIN" });

  target.banned = !!req.body.banned;
  saveUsers();

  if (target.banned && onlineUsers.has(target.id)) {
    for (const sid of onlineUsers.get(target.id)) {
      const s = io.sockets.sockets.get(sid);
      if (s) {
        s.emit("force-logout", { reason: "BANNED" });
        s.disconnect(true);
      }
    }
  }
  res.json({ ok: true, user: publicUser(target) });
});

app.delete("/api/admin/rooms/:id", requireAdmin, (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: "NOT_FOUND" });

  io.to(room.id).emit("room-closed", { reason: "ADMIN" });
  for (const sid of room.members.keys()) {
    const s = io.sockets.sockets.get(sid);
    if (s) s.leave(room.id);
  }
  rooms.delete(room.id);
  emitRooms();
  res.json({ ok: true });
});

io.use((socket, next) => {
  const userId = socket.request.session?.userId;
  const user = users.find(u => u.id === userId);
  if (!user || user.banned) return next(new Error("UNAUTHORIZED"));
  socket.user = user;
  next();
});

io.on("connection", socket => {
  const user = socket.user;
  if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set());
  onlineUsers.get(user.id).add(socket.id);

  socket.emit("rooms-list", roomList(false));

  socket.on("create-room", ({ roomId, name, videoUrl, isPublic }, ack) => {
    roomId = String(roomId || "").toUpperCase().slice(0, 8);
    name = String(name || "").trim().slice(0, 40);
    videoUrl = String(videoUrl || "").trim().slice(0, 2000);

    try {
      const parsed = new URL(videoUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      return ack?.({ ok: false, error: "BAD_URL" });
    }

    if (!roomId || rooms.has(roomId)) return ack?.({ ok: false, error: "ROOM_EXISTS" });

    rooms.set(roomId, {
      id: roomId,
      name: name || "Киновечер",
      videoUrl,
      owner: user.username,
      ownerId: user.id,
      ownerSocket: socket.id,
      isPublic: !!isPublic,
      members: new Map(),
      playerState: { time: 0, playing: false, updatedAt: Date.now() },
      createdAt: new Date().toISOString()
    });
    ack?.({ ok: true });
    emitRooms();
  });

  socket.on("join-room", ({ roomId }, ack) => {
    roomId = String(roomId || "").toUpperCase();
    const room = rooms.get(roomId);
    if (!room) return ack?.({ ok: false, error: "NOT_FOUND" });

    socket.join(roomId);
    socket.data.roomId = roomId;

    const existing = [...room.members.entries()].map(([id, m]) => ({
      id, username: m.username
    }));

    room.members.set(socket.id, {
      userId: user.id,
      username: user.username
    });

    ack?.({
      ok: true,
      room: {
        id: room.id,
        name: room.name,
        videoUrl: room.videoUrl,
        owner: room.owner,
        ownerId: room.ownerId,
        members: existing,
        playerState: room.playerState
      }
    });

    socket.to(roomId).emit("member-joined", {
      id: socket.id,
      username: user.username
    });
    io.to(roomId).emit("member-count", room.members.size);
    emitRooms();
  });

  socket.on("signal", ({ target, data }) => {
    if (!target) return;
    io.to(target).emit("signal", {
      from: socket.id,
      username: user.username,
      data
    });
  });

  socket.on("player-state", ({ roomId, time, playing }) => {
    const room = rooms.get(roomId);
    if (!room || socket.data.roomId !== roomId) return;
    room.playerState = {
      time: Number(time) || 0,
      playing: !!playing,
      updatedAt: Date.now()
    };
    socket.to(roomId).emit("player-state", room.playerState);
  });

  socket.on("chat", ({ roomId, text }) => {
    const room = rooms.get(roomId);
    if (!room || socket.data.roomId !== roomId) return;
    const clean = String(text || "").trim().slice(0, 300);
    if (!clean) return;

    io.to(roomId).emit("chat", {
      nick: user.username,
      text: clean,
      sender: socket.id
    });
  });

  socket.on("disconnect", () => {
    const set = onlineUsers.get(user.id);
    if (set) {
      set.delete(socket.id);
      if (!set.size) onlineUsers.delete(user.id);
    }

    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.members.delete(socket.id);
    socket.to(roomId).emit("member-left", { id: socket.id });
    io.to(roomId).emit("member-count", room.members.size);

    if (room.members.size === 0) {
      rooms.delete(roomId);
    } else if (room.ownerSocket === socket.id) {
      const [nextId, nextMember] = room.members.entries().next().value;
      room.ownerSocket = nextId;
      room.owner = nextMember.username;
      room.ownerId = nextMember.userId;
    }
    emitRooms();
  });
});

server.listen(PORT, () => {
  console.log(`WatchRoom v2: http://localhost:${PORT}`);
});
