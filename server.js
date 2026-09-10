const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Set DATA_DIR to a persistent Render disk path for production persistence.
// Locally this creates chess-arena-data.json beside server.js.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "chess-arena-data.json");

app.use(express.static(path.join(__dirname, "public")));

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { users: [], games: [] };
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return { users: Array.isArray(data.users) ? data.users : [], games: Array.isArray(data.games) ? data.games : [] };
  } catch {
    return { users: [], games: [] };
  }
}
let data = loadData();

function saveData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = DATA_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, DATA_FILE);
}

const online = new Map();       // socketId -> userId
const socketsByUser = new Map();
const challenges = new Map();
const games = new Map();

function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 20);
}
function validName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9 _-]{2,19}$/.test(name);
}
function badgeCount(wins) {
  return Math.floor(wins / 20);
}
function levelForRating(rating) {
  return Math.max(1, Math.floor((rating - 800) / 100) + 1);
}
function getUser(id) {
  return data.users.find(u => u.id === id) || null;
}
function publicUser(id) {
  const u = getUser(id);
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    rating: u.rating,
    wins: u.wins,
    losses: u.losses,
    draws: u.draws,
    level: levelForRating(u.rating),
    badges: badgeCount(u.wins)
  };
}
function findByName(name) {
  const lower = name.toLowerCase();
  return data.users.find(u => u.username.toLowerCase() === lower) || null;
}
function onlinePlayers() {
  return [...online.values()].map(publicUser).filter(Boolean);
}
function emitOnline() {
  io.emit("players:update", onlinePlayers());
}
function findUserBySocket(socketId) {
  const id = online.get(socketId);
  return id ? getUser(id) : null;
}
function sendError(socket, message) {
  socket.emit("app:error", { message });
}
function playerColor(g, userId) {
  if (g.whiteId === userId) return "w";
  if (g.blackId === userId) return "b";
  return null;
}
function gamePayload(g) {
  return {
    id: g.id,
    white: publicUser(g.whiteId),
    black: publicUser(g.blackId),
    fen: g.chess.fen(),
    turn: g.chess.turn(),
    status: g.status,
    whiteTime: Math.max(0, g.whiteMs),
    blackTime: Math.max(0, g.blackMs)
  };
}

function finishGame(g, result, reason) {
  if (!g || g.status === "finished") return;
  g.status = "finished";
  if (g.interval) clearInterval(g.interval);

  const white = getUser(g.whiteId);
  const black = getUser(g.blackId);
  if (!white || !black) return;

  if (result === "1-0") {
    white.rating += 20; white.wins += 1;
    black.rating -= 15; black.losses += 1;
  } else if (result === "0-1") {
    black.rating += 20; black.wins += 1;
    white.rating -= 15; white.losses += 1;
  } else {
    white.rating += 3; black.rating += 3;
    white.draws += 1; black.draws += 1;
  }

  data.games.push({
    id: g.id,
    whiteId: g.whiteId,
    blackId: g.blackId,
    result,
    reason,
    createdAt: new Date().toISOString()
  });
  saveData();

  io.to(g.id).emit("game:over", {
    result,
    reason,
    game: gamePayload(g),
    white: publicUser(g.whiteId),
    black: publicUser(g.blackId)
  });
  emitOnline();
}

function startClock(g) {
  let last = Date.now();
  g.interval = setInterval(() => {
    if (g.status === "finished") return;
    const now = Date.now();
    const delta = now - last;
    last = now;
    if (g.chess.turn() === "w") g.whiteMs -= delta;
    else g.blackMs -= delta;

    if (g.whiteMs <= 0) finishGame(g, "0-1", "White ran out of time");
    else if (g.blackMs <= 0) finishGame(g, "1-0", "Black ran out of time");
    else io.to(g.id).emit("clock:update", {
      whiteTime: g.whiteMs,
      blackTime: g.blackMs
    });
  }, 250);
}

io.on("connection", socket => {
  socket.emit("players:update", onlinePlayers());

  socket.on("profile:create", ({ username }) => {
    const name = cleanName(username);
    if (!validName(name)) {
      return sendError(socket, "Username must be 3–20 characters and use letters, numbers, spaces, _ or -.");
    }
    if (findByName(name)) return sendError(socket, "That username is already taken.");

    const id = "u-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    data.users.push({
      id,
      username: name,
      rating: 1000,
      wins: 0,
      losses: 0,
      draws: 0,
      createdAt: new Date().toISOString()
    });
    saveData();

    online.set(socket.id, id);
    socketsByUser.set(id, socket.id);
    socket.emit("profile:ready", publicUser(id));
    emitOnline();
  });

  socket.on("profile:resume", ({ username }) => {
    const name = cleanName(username);
    const user = findByName(name);
    if (!user) return sendError(socket, "Profile not found. Create a new username.");
    if (socketsByUser.has(user.id)) return sendError(socket, "That profile is already online.");

    online.set(socket.id, user.id);
    socketsByUser.set(user.id, socket.id);
    socket.emit("profile:ready", publicUser(user.id));
    emitOnline();
  });

  socket.on("challenge:send", ({ targetId }) => {
    const me = findUserBySocket(socket.id);
    if (!me) return sendError(socket, "Create or resume your profile first.");

    const targetSocket = socketsByUser.get(targetId);
    if (!targetSocket || targetId === me.id) return sendError(socket, "Player is not available.");

    const challengeId = `${me.id}:${targetId}:${Date.now()}`;
    challenges.set(challengeId, { from: me.id, to: targetId });
    io.to(targetSocket).emit("challenge:received", {
      challengeId,
      from: publicUser(me.id)
    });
    socket.emit("challenge:sent", {
      challengeId,
      to: publicUser(targetId)
    });
  });

  socket.on("challenge:respond", ({ challengeId, accept }) => {
    const c = challenges.get(challengeId);
    const me = findUserBySocket(socket.id);
    if (!c || !me || c.to !== me.id) return sendError(socket, "Challenge expired.");
    challenges.delete(challengeId);

    const fromSocket = socketsByUser.get(c.from);
    if (!accept) {
      if (fromSocket) io.to(fromSocket).emit("challenge:declined", { from: publicUser(me.id) });
      return;
    }
    if (!fromSocket) return sendError(socket, "Challenger went offline.");

    const gameId = "game-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    const g = {
      id: gameId,
      whiteId: c.from,
      blackId: c.to,
      chess: new Chess(),
      whiteMs: 5 * 60 * 1000,
      blackMs: 5 * 60 * 1000,
      status: "active",
      interval: null
    };
    games.set(gameId, g);

    const challengerSocket = io.sockets.sockets.get(fromSocket);
    if (challengerSocket) challengerSocket.join(gameId);
    socket.join(gameId);

    io.to(gameId).emit("game:start", gamePayload(g));
    startClock(g);
  });

  socket.on("game:move", ({ gameId, from, to, promotion }) => {
    const me = findUserBySocket(socket.id);
    const g = games.get(gameId);
    if (!me || !g || g.status !== "active") return;

    const color = playerColor(g, me.id);
    if (!color) return sendError(socket, "You are not a player in this game.");
    if (g.chess.turn() !== color) return sendError(socket, "It is not your turn.");

    try {
      const move = g.chess.move({
        from,
        to,
        promotion: promotion || "q"
      });
      if (!move) return sendError(socket, "Illegal move.");

      io.to(gameId).emit("game:update", {
        ...gamePayload(g),
        lastMove: move
      });

      if (g.chess.isCheckmate()) {
        finishGame(g, color === "w" ? "1-0" : "0-1", "Checkmate");
      } else if (g.chess.isDraw()) {
        finishGame(g, "1/2-1/2", "Draw");
      }
    } catch {
      sendError(socket, "Illegal move.");
    }
  });

  socket.on("game:resign", ({ gameId }) => {
    const me = findUserBySocket(socket.id);
    const g = games.get(gameId);
    if (!me || !g || g.status !== "active") return;
    const color = playerColor(g, me.id);
    if (!color) return;
    finishGame(g, color === "w" ? "0-1" : "1-0", "Resignation");
  });

  socket.on("disconnect", () => {
    const userId = online.get(socket.id);
    if (!userId) return;

    online.delete(socket.id);
    socketsByUser.delete(userId);

    for (const g of games.values()) {
      if (g.status === "active" && (g.whiteId === userId || g.blackId === userId)) {
        const color = playerColor(g, userId);
        finishGame(g, color === "w" ? "0-1" : "1-0", "Player disconnected");
      }
    }
    emitOnline();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chess Arena running on port ${PORT}`);
});
