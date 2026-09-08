const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const players = new Map(); // socketId -> player
const games = new Map();   // gameId -> game

const THEMES = {
  emerald: ["#f1f7e9", "#4e7c59"],
  ocean: ["#e9f4fb", "#3d78a8"],
  sunset: ["#fff0e6", "#b85c38"],
  royal: ["#f1eafa", "#6941a5"],
  slate: ["#e9edf2", "#4d5968"]
};

function publicPlayers() {
  return [...players.values()].map(p => ({
    id: p.id, name: p.name, rating: p.rating, level: p.level,
    status: p.gameId ? "playing" : "online"
  }));
}

function broadcastPlayers() {
  io.emit("players:update", publicPlayers());
}

function levelForRating(rating) {
  return Math.max(1, Math.floor((rating - 700) / 150) + 1);
}

function applyResult(player, result) {
  if (!player) return;
  const delta = result === "win" ? 20 : result === "loss" ? -15 : 3;
  player.rating = Math.max(100, player.rating + delta);
  player.level = levelForRating(player.rating);
  if (result === "win") player.stats.wins++;
  if (result === "loss") player.stats.losses++;
  player.stats.games++;
}

function finishGame(game, winnerColor, reason) {
  if (!games.has(game.id)) return;
  game.status = "finished";
  game.result = winnerColor ? winnerColor : "draw";
  game.reason = reason;

  const white = players.get(game.white);
  const black = players.get(game.black);

  if (winnerColor === "w") {
    applyResult(white, "win"); applyResult(black, "loss");
  } else if (winnerColor === "b") {
    applyResult(black, "win"); applyResult(white, "loss");
  } else {
    applyResult(white, "draw"); applyResult(black, "draw");
  }

  if (white) white.gameId = null;
  if (black) black.gameId = null;

  io.to(game.id).emit("game:over", {
    winner: winnerColor, reason,
    ratings: {
      white: white ? white.rating : null,
      black: black ? black.rating : null
    }
  });
  broadcastPlayers();
}

function gamePayload(game) {
  const white = players.get(game.white);
  const black = players.get(game.black);
  return {
    id: game.id,
    fen: game.chess.fen(),
    pgn: game.chess.pgn(),
    turn: game.chess.turn(),
    white: white ? { id: white.id, name: white.name, rating: white.rating } : null,
    black: black ? { id: black.id, name: black.name, rating: black.rating } : null,
    theme: game.theme,
    initialSeconds: game.initialSeconds,
    clocks: game.clocks,
    status: game.status,
    result: game.result,
    reason: game.reason
  };
}

io.on("connection", socket => {
  socket.on("player:join", ({ name }) => {
    const clean = String(name || "Player").trim().slice(0, 20) || "Player";
    const player = {
      id: socket.id,
      name: clean,
      rating: 1000,
      level: 1,
      gameId: null,
      stats: { wins: 0, losses: 0, games: 0 }
    };
    players.set(socket.id, player);
    socket.emit("player:ready", player);
    broadcastPlayers();
  });

  socket.on("challenge:send", ({ targetId, minutes, theme }) => {
    const challenger = players.get(socket.id);
    const target = players.get(targetId);
    if (!challenger || !target || challenger.gameId || target.gameId) return;
    io.to(targetId).emit("challenge:received", {
      from: { id: challenger.id, name: challenger.name, rating: challenger.rating },
      minutes: Math.max(1, Math.min(60, Number(minutes) || 5)),
      theme: THEMES[theme] ? theme : "emerald"
    });
  });

  socket.on("challenge:accept", ({ fromId, minutes, theme }) => {
    const a = players.get(socket.id);
    const b = players.get(fromId);
    if (!a || !b || a.gameId || b.gameId) return;

    const chess = new Chess();
    const game = {
      id: `g_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      chess,
      white: fromId,
      black: socket.id,
      theme: THEMES[theme] ? theme : "emerald",
      initialSeconds: Math.max(1, Math.min(60, Number(minutes) || 5)) * 60,
      clocks: { w: Math.max(1, Math.min(60, Number(minutes) || 5)) * 60,
                b: Math.max(1, Math.min(60, Number(minutes) || 5)) * 60 },
      lastTick: Date.now(),
      status: "playing",
      result: null,
      reason: null
    };
    games.set(game.id, game);
    a.gameId = game.id; b.gameId = game.id;
    io.to(game.id).emit("game:start", gamePayload(game));
    socket.join(game.id);
    io.sockets.sockets.get(fromId)?.join(game.id);
    io.to(game.id).emit("game:start", gamePayload(game));
    broadcastPlayers();
  });

  socket.on("game:move", ({ gameId, from, to, promotion }) => {
    const game = games.get(gameId);
    const player = players.get(socket.id);
    if (!game || !player || game.status !== "playing") return;
    const color = socket.id === game.white ? "w" : socket.id === game.black ? "b" : null;
    if (!color || game.chess.turn() !== color) return;

    try {
      const move = game.chess.move({ from, to, promotion: promotion || "q" });
      if (!move) return;
      game.clocks[color] = Math.max(0, game.clocks[color] - Math.floor((Date.now() - game.lastTick) / 1000));
      game.lastTick = Date.now();

      if (game.chess.isCheckmate()) {
        finishGame(game, color, "checkmate");
      } else if (game.chess.isDraw() || game.chess.isStalemate()) {
        finishGame(game, null, "draw");
      } else {
        io.to(game.id).emit("game:update", gamePayload(game));
      }
    } catch {
      socket.emit("game:error", "Illegal move");
    }
  });

  socket.on("game:sync", ({ gameId }) => {
    const game = games.get(gameId);
    if (game) socket.emit("game:update", gamePayload(game));
  });

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (player?.gameId) {
      const game = games.get(player.gameId);
      if (game && game.status === "playing") {
        const winner = socket.id === game.white ? "b" : "w";
        finishGame(game, winner, "opponent disconnected");
      }
    }
    players.delete(socket.id);
    broadcastPlayers();
  });
});

setInterval(() => {
  for (const game of games.values()) {
    if (game.status !== "playing") continue;
    const now = Date.now();
    const color = game.chess.turn();
    const elapsed = Math.floor((now - game.lastTick) / 1000);
    if (elapsed <= 0) continue;
    game.clocks[color] -= elapsed;
    game.lastTick += elapsed * 1000;
    if (game.clocks[color] <= 0) {
      game.clocks[color] = 0;
      finishGame(game, color === "w" ? "b" : "w", "timeout");
    } else {
      io.to(game.id).emit("clock:update", game.clocks);
    }
  }
}, 250);

server.listen(PORT, () => console.log(`Chess Arena running at http://localhost:${PORT}`));