const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'goofy-chess-data.json');

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { users: [], games: [] };
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { users: Array.isArray(d.users) ? d.users : [], games: Array.isArray(d.games) ? d.games : [] };
  } catch { return { users: [], games: [] }; }
}
let data = loadData();
function saveData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

const online = new Map();
const socketsByUser = new Map();
const challenges = new Map();
const games = new Map();

const THEMES = ['classic','forest','dungeon','neon','crystal','lava','moon'];
const PIECES = ['classic','gold','ice','shadow'];
const BADGES_TOTAL = 500;

function cleanName(n) { return String(n || '').trim().replace(/\s+/g,' ').slice(0,20); }
function validName(n) { return /^[A-Za-z0-9][A-Za-z0-9 _-]{2,19}$/.test(n); }
function cleanPassword(p) { return String(p || ''); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, user) {
  try {
    const hash = crypto.scryptSync(password, user.passwordSalt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash,'hex'), Buffer.from(user.passwordHash,'hex'));
  } catch { return false; }
}
function uid(prefix='u') { return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`; }
function token() { return crypto.randomBytes(32).toString('hex'); }
function badgeCount(wins) { return Math.min(BADGES_TOTAL, Math.floor(wins / 5) + 1); } // first badge on entry
function levelForXP(xp) { return Math.max(1, Math.floor(xp / 500) + 1); }
function xpForResult(result) { return result === 'win' ? 100 : result === 'draw' ? 30 : 10; }
function getUser(id) { return data.users.find(u => u.id === id) || null; }
function findByName(name) { const n = name.toLowerCase(); return data.users.find(u => u.username.toLowerCase() === n) || null; }
function findByToken(t) { return data.users.find(u => u.sessionToken === t) || null; }
function themesUnlocked(u) { return THEMES.slice(0, Math.min(THEMES.length, 1 + Math.floor((badgeCount(u.wins)-1)/3))); }
function piecesUnlocked(u) { return PIECES.slice(0, Math.min(PIECES.length, 1 + Math.floor((badgeCount(u.wins)-1)/5))); }
function publicUser(id) {
  const u = getUser(id); if (!u) return null;
  const badges = badgeCount(u.wins);
  return {
    id:u.id, username:u.username, rating:u.rating, xp:u.xp, level:levelForXP(u.xp), wins:u.wins, losses:u.losses,
    draws:u.draws, games:u.games, badges, badgesTotal:BADGES_TOTAL, avatar:u.avatar || null,
    themesUnlocked:themesUnlocked(u), piecesUnlocked:piecesUnlocked(u), themesPlayed:u.themesPlayed || []
  };
}
function profilePayload(u) {
  const p = publicUser(u.id);
  p.token = u.sessionToken;
  p.tasks = [
    { id:'first-win', title:'Wake the Pawn', desc:'Win your first match', progress:Math.min(u.wins,1), goal:1, reward:100 },
    { id:'three-themes', title:'Theme Goblin', desc:'Play using 3 different boards', progress:Math.min((u.themesPlayed||[]).length,3), goal:3, reward:150 },
    { id:'ten-games', title:'Goofy Grinder', desc:'Play 10 matches', progress:Math.min(u.games,10), goal:10, reward:250 },
    { id:'twenty-wins', title:'Knight Menace', desc:'Win 20 matches', progress:Math.min(u.wins,20), goal:20, reward:500 }
  ];
  return p;
}
function onlinePlayers() { return [...online.values()].map(publicUser).filter(Boolean); }
function emitOnline() { io.emit('players:update', onlinePlayers()); }
function meForSocket(sid) { const id=online.get(sid); return id ? getUser(id) : null; }
function err(socket,message) { socket.emit('app:error',{message}); }
function colorOf(g,id) { return g.whiteId===id?'w':g.blackId===id?'b':null; }
function clockNow(g) {
  const w = g.whiteMs, b = g.blackMs;
  const elapsed = Date.now() - g.lastTick;
  return g.chess.turn()==='w' ? {whiteTime:Math.max(0,w-elapsed),blackTime:Math.max(0,b)} : {whiteTime:Math.max(0,w),blackTime:Math.max(0,b-elapsed)};
}
function gamePayload(g) {
  const c=clockNow(g);
  return { id:g.id, white:publicUser(g.whiteId), black:publicUser(g.blackId), fen:g.chess.fen(), turn:g.chess.turn(), status:g.status,
    whiteTime:c.whiteTime, blackTime:c.blackTime, theme:g.theme, pieceStyle:g.pieceStyle, lastMove:g.lastMove||null };
}
function syncClock(g) {
  const now=Date.now(), delta=now-g.lastTick; g.lastTick=now;
  if (g.chess.turn()==='w') g.whiteMs-=delta; else g.blackMs-=delta;
}
function award(u,result,g) {
  const xp=xpForResult(result); u.xp += xp;
  if(result==='win') u.wins++; else if(result==='loss') u.losses++; else u.draws++;
  u.games++;
  if(!Array.isArray(u.themesPlayed)) u.themesPlayed=[];
  if(g.theme && !u.themesPlayed.includes(g.theme)) u.themesPlayed.push(g.theme);
}
function finishGame(g,result,reason) {
  if(!g || g.status==='finished') return;
  syncClock(g); g.status='finished'; if(g.interval) clearInterval(g.interval);
  const white=getUser(g.whiteId), black=getUser(g.blackId); if(!white||!black) return;
  if(result==='1-0'){ award(white,'win',g); award(black,'loss',g); white.rating+=20; black.rating=Math.max(100,black.rating-15); }
  else if(result==='0-1'){ award(black,'win',g); award(white,'loss',g); black.rating+=20; white.rating=Math.max(100,white.rating-15); }
  else { award(white,'draw',g); award(black,'draw',g); white.rating+=3; black.rating+=3; }
  data.games.push({id:g.id,whiteId:g.whiteId,blackId:g.blackId,result,reason,theme:g.theme,createdAt:new Date().toISOString()});
  saveData();
  io.to(g.id).emit('game:over',{result,reason,game:gamePayload(g),white:profilePayload(white),black:profilePayload(black)});
  emitOnline();
}
function startClock(g) {
  g.lastTick=Date.now();
  g.interval=setInterval(()=>{
    if(g.status!=='active') return;
    syncClock(g);
    if(g.whiteMs<=0) finishGame(g,'0-1','White ran out of time');
    else if(g.blackMs<=0) finishGame(g,'1-0','Black ran out of time');
    else io.to(g.id).emit('clock:update',{whiteTime:g.whiteMs,blackTime:g.blackMs});
  },200);
}
function minutesValid(m){ const n=Number(m); return [1,3,5,10,15,30].includes(n) ? n : 5; }
function themeValid(t){ return THEMES.includes(t) ? t : 'classic'; }
function pieceValid(p){ return PIECES.includes(p) ? p : 'classic'; }

io.on('connection',socket=>{
  socket.emit('players:update',onlinePlayers());

  socket.on('profile:create',({username,password})=>{
    const name=cleanName(username), pass=cleanPassword(password);
    if(!validName(name)) return err(socket,'Username must be 3–20 characters.');
    if(pass.length<6) return err(socket,'Password must be at least 6 characters.');
    if(findByName(name)) return err(socket,'That username is already taken.');
    const hp=hashPassword(pass);
    const u={id:uid(),username:name,rating:1000,xp:0,wins:0,losses:0,draws:0,games:0,avatar:null,themesPlayed:[],createdAt:new Date().toISOString(),passwordSalt:hp.salt,passwordHash:hp.hash,sessionToken:token()};
    data.users.push(u); saveData(); online.set(socket.id,u.id); socketsByUser.set(u.id,socket.id);
    socket.emit('profile:ready',profilePayload(u)); emitOnline();
  });

  socket.on('profile:login',({username,password})=>{
    const u=findByName(cleanName(username));
    if(!u || !verifyPassword(cleanPassword(password),u)) return err(socket,'Incorrect username or password.');
    if(socketsByUser.has(u.id)) return err(socket,'That profile is already online.');
    if(!u.sessionToken) u.sessionToken=token(); saveData(); online.set(socket.id,u.id); socketsByUser.set(u.id,socket.id);
    socket.emit('profile:ready',profilePayload(u)); emitOnline();
  });

  socket.on('profile:resume',({token:t})=>{
    const u=findByToken(String(t||''));
    if(!u) return err(socket,'Your saved session was not found. Please log in.');
    if(socketsByUser.has(u.id)) return err(socket,'That profile is already online.');
    online.set(socket.id,u.id); socketsByUser.set(u.id,socket.id); socket.emit('profile:ready',profilePayload(u)); emitOnline();
  });

  socket.on('profile:avatar',({avatar})=>{
    const u=meForSocket(socket.id); if(!u) return;
    if(typeof avatar!=='string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(avatar) || avatar.length>2_500_000) return err(socket,'Please choose a smaller PNG/JPG/WEBP image.');
    u.avatar=avatar; saveData(); socket.emit('profile:update',profilePayload(u)); emitOnline();
  });

  socket.on('challenge:send',({targetId,minutes,theme,pieceStyle})=>{
    const me=meForSocket(socket.id); if(!me) return err(socket,'Log in first.');
    const target=getUser(targetId), targetSocket=socketsByUser.get(targetId);
    if(!target || !targetSocket || targetId===me.id) return err(socket,'Player is not available.');
    const c={id:uid('challenge'),from:me.id,to:targetId,minutes:minutesValid(minutes),theme:themeValid(theme),pieceStyle:pieceValid(pieceStyle),createdAt:Date.now()};
    challenges.set(c.id,c);
    io.to(targetSocket).emit('challenge:received',{...c,from:publicUser(me.id)});
    socket.emit('challenge:sent',{to:publicUser(targetId),...c});
    setTimeout(()=>challenges.delete(c.id),90_000);
  });

  socket.on('challenge:respond',({challengeId,accept})=>{
    const c=challenges.get(challengeId), me=meForSocket(socket.id); if(!c||!me||c.to!==me.id) return err(socket,'Challenge expired.');
    challenges.delete(challengeId); const fromSocket=socketsByUser.get(c.from); if(!fromSocket) return err(socket,'Challenger went offline.');
    if(!accept){ io.to(fromSocket).emit('challenge:declined',{from:publicUser(me.id)}); return; }
    const gameId=uid('game');
    const g={id:gameId,whiteId:c.from,blackId:c.to,chess:new Chess(),whiteMs:c.minutes*60*1000,blackMs:c.minutes*60*1000,status:'active',interval:null,lastTick:Date.now(),theme:c.theme,pieceStyle:c.pieceStyle,lastMove:null};
    games.set(gameId,g);
    const cs=io.sockets.sockets.get(fromSocket); if(cs) cs.join(gameId); socket.join(gameId);
    io.to(gameId).emit('game:start',gamePayload(g)); startClock(g);
  });

  socket.on('game:move',({gameId,from,to,promotion})=>{
    const me=meForSocket(socket.id),g=games.get(gameId); if(!me||!g||g.status!=='active') return;
    const color=colorOf(g,me.id); if(!color) return err(socket,'You are not part of this game.');
    if(g.chess.turn()!==color) return err(socket,'It is not your turn.');
    syncClock(g);
    if(g.whiteMs<=0||g.blackMs<=0){ finishGame(g,g.whiteMs<=0?'0-1':'1-0','Time expired'); return; }
    try{
      const move=g.chess.move({from,to,promotion:promotion||'q'}); if(!move) return err(socket,'Illegal move.');
      g.lastMove={from:move.from,to:move.to,captured:move.captured||null,piece:move.piece,promotion:move.promotion||null};
      g.lastTick=Date.now(); io.to(gameId).emit('game:update',gamePayload(g));
      if(g.chess.isCheckmate()) finishGame(g,color==='w'?'1-0':'0-1','Checkmate');
      else if(g.chess.isDraw()) finishGame(g,'1/2-1/2','Draw');
    }catch{ err(socket,'Illegal move.'); }
  });

  socket.on('game:resign',({gameId})=>{ const me=meForSocket(socket.id),g=games.get(gameId); if(!me||!g||g.status!=='active')return; const c=colorOf(g,me.id); if(c) finishGame(g,c==='w'?'0-1':'1-0','Resignation'); });

  socket.on('leaderboard:request',()=>{
    const list=[...data.users].sort((a,b)=>b.rating-a.rating).slice(0,50).map((u,i)=>({rank:i+1,...publicUser(u.id)}));
    socket.emit('leaderboard:update',list);
  });

  socket.on('profile:history',()=>{
    const u=meForSocket(socket.id); if(!u)return;
    const history=data.games.filter(g=>g.whiteId===u.id||g.blackId===u.id).slice(-20).reverse().map(g=>({id:g.id,opponent:publicUser(g.whiteId===u.id?g.blackId:g.whiteId)?.username||'Unknown',result:g.result,reason:g.reason,theme:g.theme,createdAt:g.createdAt}));
    socket.emit('profile:history',history);
  });

  socket.on('disconnect',()=>{
    const id=online.get(socket.id); if(!id)return;
    online.delete(socket.id); socketsByUser.delete(id);
    for(const g of games.values()) if(g.status==='active'&&(g.whiteId===id||g.blackId===id)){ const c=colorOf(g,id); finishGame(g,c==='w'?'0-1':'1-0','Player disconnected'); }
    emitOnline();
  });
});

server.listen(PORT,'0.0.0.0',()=>console.log(`Goofy Chess running on ${PORT}`));
