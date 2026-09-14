const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const HAS_DB = Boolean(process.env.DATABASE_URL);
if (process.env.RENDER && !HAS_DB) throw new Error('DATABASE_URL is required on Render for persistent Goofy Chess accounts.');

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const THEMES = [
  ['classic','Classic Court','1000'],['ocean','Ocean Drift','1000'],['forest','Forest Ruins','1000'],['dungeon','Dungeon Stone','1000'],['neon','Neon Arcade','1000'],
  ['crystal','Crystal Cave','150'],['lava','Lava Forge','150'],['moon','Moonlit Keep','150'],['sunset','Sunset Temple','150'],['desert','Desert Rally','150'],
  ['aurora','Aurora Vale','200'],['cloud','Cloud Kingdom','200'],['candy','Candy Chaos','200'],['moss','Mossy Ruins','200'],['ember','Ember Town','200'],
  ['storm','Stormwatch','250'],['rain','Rainy Rooftop','250'],['coral','Coral Reef','250'],['volcano','Volcano Core','250'],['glacier','Glacier Pass','250'],
  ['space','Deep Space','300'],['nebula','Nebula Drift','300'],['comet','Comet Field','300'],['planet','Planetarium','300'],['eclipse','Eclipse Gate','300'],
  ['rose','Rose Garden','350'],['violet','Violet Night','350'],['teal','Teal Circuit','350'],['copper','Copperworks','350'],['silver','Silver Hall','350'],
  ['gold','Golden Palace','400'],['ruby','Ruby Vault','400'],['sapphire','Sapphire Vault','400'],['emerald','Emerald Grove','400'],['amethyst','Amethyst Keep','400'],
  ['paper','Paper Town','450'],['ink','Ink Wash','450'],['chalk','Chalk Arena','450'],['wood','Woodland Board','450'],['brick','Brick Yard','450'],
  ['royal','Royal Carpet','500'],['marble','Marble Hall','500'],['obsidian','Obsidian Keep','500'],['pearl','Pearl Palace','500'],['bronze','Bronze Bastion','500'],
  ['mint','Mint Meadow','550'],['lime','Lime Lab','550'],['lemon','Lemon Grove','550'],['peach','Peach Plaza','550'],['berry','Berry Bash','550'],
  ['coffee','Coffee Shop','600'],['soda','Soda Pop','600'],['arcade','Arcade Glow','600'],['pixel','Pixel Plaza','600'],['console','Console Cave','600'],
  ['castle','Castle Courtyard','650'],['tower','Tower Top','650'],['bridge','Bridge Battle','650'],['harbor','Harbor Lights','650'],['island','Island Quest','650'],
  ['jungle','Jungle Temple','700'],['savanna','Savanna Sun','700'],['tundra','Tundra Camp','700'],['canyon','Canyon Clash','700'],['oasis','Oasis Outpost','700'],
  ['matrix','Matrix Grid','750'],['terminal','Terminal Green','750'],['cyber','Cyber City','750'],['holo','Holo Hall','750'],['circuit','Circuit Core','750'],
  ['royale1','Royale: Prism','0'],['royale2','Royale: Inferno','0'],['royale3','Royale: Abyss','0'],['royale4','Royale: Bloom','0'],['royale5','Royale: Galaxy','0'],
  ['royale6','Royale: Candy','0'],['royale7','Royale: Storm','0'],['royale8','Royale: Frost','0'],['royale9','Royale: Gold','0'],['royale10','Royale: Shadow','0'],
  ['bamboo','Bamboo Garden','800'],['pagoda','Pagoda Night','800'],['lantern','Lantern Lane','800'],['tea','Tea House','800'],['zen','Zen Garden','800'],
  ['comic','Comic Clash','900'],['sketch','Sketchbook','900'],['sticker','Sticker Storm','900'],['graffiti','Graffiti Alley','900'],['doodle','Doodle Dungeon','900'],
  ['royale11','Royale: Sunset','0'],['royale12','Royale: Ocean','0'],['royale13','Royale: Forest','0'],['royale14','Royale: Crystal','0'],['royale15','Royale: Moon','0'],['royale16','Royale: Aurora','0'],['royale17','Royale: Jungle','0'],['royale18','Royale: Cyber','0'],['royale19','Royale: Candyland','0'],['royale20','Royale: Castle','0']
];
const BOARD_MAP = Object.fromEntries(THEMES.map(([id,name,cost],i)=>[id,{id,name,cost:Number(cost),index:i,royale:id.startsWith('royale')}])) ;
const STORE_BOARDS = THEMES.filter(x=>!x[0].startsWith('royale')).map(([id,name,cost],i)=>({id,name,cost:Number(cost),index:i,badgeOnly:i>4&&i%10===0,badgeReq:i>4&&i%10===0?5+Math.floor(i/10)*5:0}));
const ROYALE_BOARDS = THEMES.filter(x=>x[0].startsWith('royale')).map((x,i)=>({id:x[0],name:x[1],cost:0,index:i,royale:true,rarity:(i%20<10?'NORMAL':i%20<16?'RARE':i%20<19?'EPIC':'LEGENDARY')}));
const ALL_BOARD_IDS = [...STORE_BOARDS, ...ROYALE_BOARDS].map(b=>b.id);
const BADGES_TOTAL = 500;
const DAILY_TASKS = [
  {id:'daily-login',title:'Daily Goof',desc:'Log in today',goal:1,reward:25},
  {id:'daily-win',title:'One More Win',desc:'Win 1 match today',goal:1,reward:40},
  {id:'daily-games',title:'Queue Goblin',desc:'Play 3 matches today',goal:3,reward:60},
  {id:'daily-boards',title:'Board Tourist',desc:'Play on 2 different boards today',goal:2,reward:50}
];

const online = new Map();
const socketsByUser = new Map();
const challenges = new Map();
const games = new Map();

function uid(prefix='u'){ return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`; }
function token(){ return crypto.randomBytes(32).toString('hex'); }
function cleanName(n){ return String(n||'').trim().replace(/\s+/g,' ').slice(0,20); }
function nameKey(n){ return cleanName(n).toLowerCase(); }
function validName(n){ return /^[A-Za-z0-9][A-Za-z0-9 _-]{2,19}$/.test(n); }
function cleanPassword(p){ return String(p||''); }
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){ return {salt,hash:crypto.scryptSync(password,salt,64).toString('hex')}; }
function verifyPassword(password,user){ try { const h=crypto.scryptSync(password,user.passwordSalt,64).toString('hex'); return crypto.timingSafeEqual(Buffer.from(h,'hex'),Buffer.from(user.passwordHash,'hex')); } catch { return false; } }
function badgeCount(wins){ return Math.min(BADGES_TOTAL,1+Math.floor(Math.max(0,wins)/5)); }
function levelForXP(xp){ return Math.max(1,Math.floor(xp/500)+1); }
function xpForResult(r){ return r==='win'?100:r==='draw'?30:10; }
function unlockedBoards(u){
  const owned=new Set(u.purchasedBoards||[]), badges=badgeCount(u.wins);
  const store=STORE_BOARDS.filter((b,i)=>i<5 || owned.has(b.id) || (b.badgeOnly && badges>=b.badgeReq)).map(b=>b.id);
  const royale=ROYALE_BOARDS.filter(b=>owned.has(b.id)).map(b=>b.id);
  return [...new Set([...store,...royale])];
}
function themesUnlocked(u){return unlockedBoards(u);}
function isBoardUnlocked(u,id){return ALL_BOARD_IDS.includes(id) && unlockedBoards(u).includes(id);}
function board(id){const b={...(BOARD_MAP[id]||BOARD_MAP.classic)};const sb=STORE_BOARDS.find(x=>x.id===b.id);const rb=ROYALE_BOARDS.find(x=>x.id===b.id);if(rb)return {...b,royale:true,rarity:rb.rarity};return sb?{...b,badgeOnly:sb.badgeOnly,badgeReq:sb.badgeReq}:b;}
function weightedRoyaleBoard(u){
  const owned=new Set(u.purchasedBoards||[]); let pool=ROYALE_BOARDS.filter(b=>!owned.has(b.id));
  if(!pool.length) pool=ROYALE_BOARDS;
  const weights={NORMAL:60,RARE:27,EPIC:10,LEGENDARY:3};
  const total=pool.reduce((n,b)=>n+(weights[b.rarity]||1),0); let roll=Math.random()*total;
  for(const b of pool){roll-=weights[b.rarity]||1;if(roll<=0)return b;} return pool[pool.length-1];
}
function badgeName(i){ if(i===1)return 'Pawn Awakening'; const names=['Fighter','Duelist','Veteran','Dominator','Tactician','Conqueror','Grand Goof','Board Boss','Chaos Captain','Crown Chaser']; return names[(i-2)%names.length] + (i>11?` ${Math.ceil((i-1)/10)}`:''); }
function badgeUnlockRequirement(i){ return i===1?0:(i-1)*5; }
function publicUser(u){
  if(!u)return null;
  const badges=badgeCount(u.wins);
  return {id:u.id,username:u.username,rating:u.rating,xp:u.xp,level:levelForXP(u.xp),wins:u.wins,losses:u.losses,draws:u.draws,games:u.games,coins:u.coins||0,avatar:u.avatar||null,badges,badgesTotal:BADGES_TOTAL,highestBadge:badgeName(badges),claimedBadges:u.claimedBadges||0,pendingBadges:Math.max(0,badges-(u.claimedBadges||0)),boardsUnlocked:unlockedBoards(u),purchasedBoards:u.purchasedBoards||[],themesPlayed:u.themesPlayed||[],dailyKey:u.dailyKey||'',dailyClaimed:u.dailyClaimed||{},dailyWins:u.dailyWins||0,dailyGames:u.dailyGames||0,dailyBoards:u.dailyBoards||[]};
}
function resetDailyIfNeeded(u){
  const key=new Date().toISOString().slice(0,10);
  if(u.dailyKey!==key){u.dailyKey=key;u.dailyClaimed={};u.dailyWins=0;u.dailyGames=0;u.dailyBoards=[];}
}
function taskPayload(u){
  resetDailyIfNeeded(u);
  return DAILY_TASKS.map(t=>({id:t.id,title:t.title,desc:t.desc,progress:t.id==='daily-login'?1:t.id==='daily-win'?Math.min(u.dailyWins,1):t.id==='daily-games'?Math.min(u.dailyGames,3):Math.min(u.dailyBoards.length,2),goal:t.goal,reward:t.reward,claimed:Boolean(u.dailyClaimed?.[t.id])}));
}
function profilePayload(u){ const p=publicUser(u); p.token=u.sessionToken; p.tasks=taskPayload(u); p.boardCatalog=STORE_BOARDS; p.boardsOwned=unlockedBoards(u); p.royaleBoards=ROYALE_BOARDS.map(board); p.ownedBoardDetails=p.boardsOwned.map(id=>board(id)); return p; }

async function createPool(){
  if(!HAS_DB)return null;
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')||process.env.DATABASE_URL.includes('127.0.0.1')?false:{rejectUnauthorized:false}});
  await pool.query(`CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, rating INTEGER NOT NULL DEFAULT 1000,
    xp INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0,
    games INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL DEFAULT 0, avatar TEXT, themes_played JSONB NOT NULL DEFAULT '[]'::jsonb,
    purchased_boards JSONB NOT NULL DEFAULT '[]'::jsonb, claimed_badges INTEGER NOT NULL DEFAULT 0, daily_key TEXT NOT NULL DEFAULT '',
    daily_claimed JSONB NOT NULL DEFAULT '{}'::jsonb, daily_wins INTEGER NOT NULL DEFAULT 0, daily_games INTEGER NOT NULL DEFAULT 0,
    daily_boards JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, session_token TEXT UNIQUE
  );
  CREATE TABLE IF NOT EXISTS games(
    id TEXT PRIMARY KEY, white_id TEXT NOT NULL REFERENCES users(id), black_id TEXT NOT NULL REFERENCES users(id), result TEXT NOT NULL,
    reason TEXT NOT NULL, theme TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
  return pool;
}
const poolPromise=createPool();
let pool=null;
async function dbReady(){ pool=await poolPromise; return pool; }

let data={users:[],games:[]};
const DATA_DIR=process.env.DATA_DIR||__dirname;
const DATA_FILE=path.join(DATA_DIR,'goofy-chess-data.json');
function loadLocal(){try{if(!fs.existsSync(DATA_FILE))return;const d=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));data={users:Array.isArray(d.users)?d.users:[],games:Array.isArray(d.games)?d.games:[]};}catch{data={users:[],games:[]};}}
function saveLocal(){fs.mkdirSync(DATA_DIR,{recursive:true});const t=DATA_FILE+'.tmp';fs.writeFileSync(t,JSON.stringify(data,null,2));fs.renameSync(t,DATA_FILE);}
loadLocal();

function rowUser(r){return {id:r.id,username:r.username,rating:r.rating,xp:r.xp,wins:r.wins,losses:r.losses,draws:r.draws,games:r.games,coins:r.coins||0,avatar:r.avatar||null,themesPlayed:r.themes_played||[],purchasedBoards:r.purchased_boards||[],claimedBadges:r.claimed_badges||0,dailyKey:r.daily_key||'',dailyClaimed:r.daily_claimed||{},dailyWins:r.daily_wins||0,dailyGames:r.daily_games||0,dailyBoards:r.daily_boards||[],createdAt:r.created_at,passwordSalt:r.password_salt,passwordHash:r.password_hash,sessionToken:r.session_token};}
async function getUser(id){ if(pool){const r=await pool.query('SELECT * FROM users WHERE id=$1',[id]);return r.rows[0]?rowUser(r.rows[0]):null;}return data.users.find(u=>u.id===id)||null; }
async function findByName(name){const key=nameKey(name);if(pool){const r=await pool.query('SELECT * FROM users WHERE username_key=$1',[key]);return r.rows[0]?rowUser(r.rows[0]):null;}return data.users.find(u=>nameKey(u.username)===key)||null;}
async function findByToken(t){if(pool){const r=await pool.query('SELECT * FROM users WHERE session_token=$1',[t]);return r.rows[0]?rowUser(r.rows[0]):null;}return data.users.find(u=>u.sessionToken===t)||null;}
async function saveUser(u){if(pool){await pool.query(`UPDATE users SET username=$2,username_key=$3,rating=$4,xp=$5,wins=$6,losses=$7,draws=$8,games=$9,coins=$10,avatar=$11,themes_played=$12,purchased_boards=$13,claimed_badges=$14,daily_key=$15,daily_claimed=$16,daily_wins=$17,daily_games=$18,daily_boards=$19,session_token=$20 WHERE id=$1`,[u.id,u.username,nameKey(u.username),u.rating,u.xp,u.wins,u.losses,u.draws,u.games,u.coins||0,u.avatar,JSON.stringify(u.themesPlayed||[]),JSON.stringify(u.purchasedBoards||[]),u.claimedBadges||0,u.dailyKey||'',JSON.stringify(u.dailyClaimed||{}),u.dailyWins||0,u.dailyGames||0,JSON.stringify(u.dailyBoards||[]),u.sessionToken||null]);}else{const i=data.users.findIndex(x=>x.id===u.id);if(i>=0)data.users[i]=u;saveLocal();}}
async function createUser(u){if(pool){await pool.query(`INSERT INTO users(id,username,username_key,rating,xp,wins,losses,draws,games,coins,avatar,themes_played,purchased_boards,claimed_badges,daily_key,daily_claimed,daily_wins,daily_games,daily_boards,password_salt,password_hash,session_token) VALUES($1,$2,$3,1000,0,0,0,0,0,100,NULL,'[]','[]',0,$4,'{}',0,0,'[]',$5,$6,$7)`,[u.id,u.username,nameKey(u.username),u.dailyKey,u.passwordSalt,u.passwordHash,u.sessionToken]);}else{data.users.push(u);saveLocal();}}
async function listUsers(){if(pool){const r=await pool.query('SELECT * FROM users ORDER BY rating DESC');return r.rows.map(rowUser);}return data.users;}
async function listHistory(uid){if(pool){const r=await pool.query(`SELECT g.*,CASE WHEN g.white_id=$1 THEN b.username ELSE w.username END opponent FROM games g JOIN users w ON w.id=g.white_id JOIN users b ON b.id=g.black_id WHERE g.white_id=$1 OR g.black_id=$1 ORDER BY g.created_at DESC LIMIT 30`,[uid]);return r.rows;}return data.games.filter(g=>g.whiteId===uid||g.blackId===uid).slice(-30).reverse().map(g=>({...g,opponent:(data.users.find(u=>u.id===(g.whiteId===uid?g.blackId:g.whiteId))||{}).username||'Unknown'}));}
async function insertGame(g,result,reason){if(pool){await pool.query('INSERT INTO games(id,white_id,black_id,result,reason,theme) VALUES($1,$2,$3,$4,$5,$6)',[g.id,g.whiteId,g.blackId,result,reason,g.theme]);}else{data.games.push({id:g.id,whiteId:g.whiteId,blackId:g.blackId,result,reason,theme:g.theme,createdAt:new Date().toISOString()});saveLocal();}}
async function withTx(fn){if(!pool)return fn(null);const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function migrateLocalIfNeeded(){if(!pool||!data.users.length)return;const c=await pool.connect();try{const count=await c.query('SELECT COUNT(*)::int n FROM users');if(count.rows[0].n>0)return;for(const u of data.users){await c.query(`INSERT INTO users(id,username,username_key,rating,xp,wins,losses,draws,games,coins,avatar,themes_played,purchased_boards,claimed_badges,daily_key,daily_claimed,daily_wins,daily_games,daily_boards,password_salt,password_hash,session_token) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,[u.id,u.username,nameKey(u.username),u.rating||1000,u.xp||0,u.wins||0,u.losses||0,u.draws||0,u.games||0,u.coins||0,u.avatar||null,JSON.stringify(u.themesPlayed||[]),JSON.stringify(u.purchasedBoards||[]),u.claimedBadges||0,u.dailyKey||'',JSON.stringify(u.dailyClaimed||{}),u.dailyWins||0,u.dailyGames||0,JSON.stringify(u.dailyBoards||[]),u.passwordSalt,u.passwordHash,u.sessionToken||null]);}for(const g of data.games){await c.query('INSERT INTO games(id,white_id,black_id,result,reason,theme,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[g.id,g.whiteId,g.blackId,g.result,g.reason||'Unknown',g.theme||'classic',g.createdAt||new Date().toISOString()]);}}finally{c.release();}}

function onlinePlayers(){return [...online.values()].map(u=>u).filter(Boolean);}
function emitOnline(){io.emit('players:update',onlinePlayers().map(publicUser));}
function err(socket,message){socket.emit('app:error',{message});}
function meForSocket(sid){const u=online.get(sid);return u||null;}
function colorOf(g,id){return g.whiteId===id?'w':g.blackId===id?'b':null;}
function clockNow(g){const elapsed=Date.now()-g.lastTick;return g.chess.turn()==='w'?{whiteTime:Math.max(0,g.whiteMs-elapsed),blackTime:Math.max(0,g.blackMs)}:{whiteTime:Math.max(0,g.whiteMs),blackTime:Math.max(0,g.blackMs-elapsed)};}
function legalMoves(g){const moves=g.chess.moves({verbose:true});return moves.map(m=>({from:m.from,to:m.to,capture:Boolean(m.captured),piece:m.piece}));}
function gamePayload(g){const c=clockNow(g);return {id:g.id,white:publicUser(g.white),black:publicUser(g.black),fen:g.chess.fen(),turn:g.chess.turn(),status:g.status,whiteTime:c.whiteTime,blackTime:c.blackTime,theme:g.theme,lastMove:g.lastMove||null,legalMoves:legalMoves(g)};}
function syncClock(g){const now=Date.now(),d=now-g.lastTick;g.lastTick=now;if(g.chess.turn()==='w')g.whiteMs-=d;else g.blackMs-=d;}
function addDaily(u,g,result){resetDailyIfNeeded(u);u.dailyGames++;if(result==='win')u.dailyWins++;if(g.theme&&!u.dailyBoards.includes(g.theme))u.dailyBoards.push(g.theme);}
function award(u,result,g){u.xp+=xpForResult(result);if(result==='win')u.wins++;else if(result==='loss')u.losses++;else u.draws++;u.games++;u.coins=(u.coins||0)+(result==='win'?50:result==='draw'?20:10);if(g.theme&&!u.themesPlayed.includes(g.theme))u.themesPlayed.push(g.theme);addDaily(u,g,result);}
async function finishGame(g,result,reason){if(!g||g.status==='finished')return;syncClock(g);g.status='finished';if(g.interval)clearInterval(g.interval);const white=await getUser(g.whiteId),black=await getUser(g.blackId);if(!white||!black)return;
  if(result==='1-0'){award(white,'win',g);award(black,'loss',g);white.rating+=20;black.rating=Math.max(100,black.rating-15);}else if(result==='0-1'){award(black,'win',g);award(white,'loss',g);black.rating+=20;white.rating=Math.max(100,white.rating-15);}else{award(white,'draw',g);award(black,'draw',g);white.rating+=3;black.rating+=3;}
  await withTx(async c=>{if(c){await c.query(`UPDATE users SET rating=$2,xp=$3,wins=$4,losses=$5,draws=$6,games=$7,coins=$8,themes_played=$9,daily_key=$10,daily_wins=$11,daily_games=$12,daily_boards=$13 WHERE id=$1`,[white.id,white.rating,white.xp,white.wins,white.losses,white.draws,white.games,white.coins,JSON.stringify(white.themesPlayed),white.dailyKey,white.dailyWins,white.dailyGames,JSON.stringify(white.dailyBoards)]);await c.query(`UPDATE users SET rating=$2,xp=$3,wins=$4,losses=$5,draws=$6,games=$7,coins=$8,themes_played=$9,daily_key=$10,daily_wins=$11,daily_games=$12,daily_boards=$13 WHERE id=$1`,[black.id,black.rating,black.xp,black.wins,black.losses,black.draws,black.games,black.coins,JSON.stringify(black.themesPlayed),black.dailyKey,black.dailyWins,black.dailyGames,JSON.stringify(black.dailyBoards)]);await c.query('INSERT INTO games(id,white_id,black_id,result,reason,theme) VALUES($1,$2,$3,$4,$5,$6)',[g.id,g.whiteId,g.blackId,result,reason,g.theme]);}else{await saveUser(white);await saveUser(black);await insertGame(g,result,reason);}});
  g.white=white;g.black=black;io.to(g.id).emit('game:over',{result,reason,game:gamePayload(g),white:profilePayload(white),black:profilePayload(black)});emitOnline();
}
function startClock(g){g.lastTick=Date.now();g.interval=setInterval(()=>{if(g.status!=='active')return;syncClock(g);if(g.whiteMs<=0)finishGame(g,'0-1','White ran out of time');else if(g.blackMs<=0)finishGame(g,'1-0','Black ran out of time');else io.to(g.id).emit('clock:update',{whiteTime:g.whiteMs,blackTime:g.blackMs});},200);}
function minutesValid(m){const n=Number(m);return [1,3,5,10,15,30].includes(n)?n:5;}

io.on('connection',socket=>{
  socket.emit('players:update',onlinePlayers().map(publicUser));
  socket.on('profile:create',async({username,password})=>{try{const name=cleanName(username),pass=cleanPassword(password);if(!validName(name))return err(socket,'Username must be 3–20 characters.');if(pass.length<6)return err(socket,'Password must be at least 6 characters.');if(await findByName(name))return err(socket,'That username is already taken.');const hp=hashPassword(pass),u={id:uid(),username:name,rating:1000,xp:0,wins:0,losses:0,draws:0,games:0,coins:100,avatar:null,themesPlayed:[],purchasedBoards:[],claimedBadges:0,dailyKey:'',dailyClaimed:{},dailyWins:0,dailyGames:0,dailyBoards:[],createdAt:new Date().toISOString(),passwordSalt:hp.salt,passwordHash:hp.hash,sessionToken:token()};try{await createUser(u);}catch(e){if(e.code==='23505')return err(socket,'That username is already taken.');throw e;}resetDailyIfNeeded(u);u.coins+=25;await saveUser(u);online.set(socket.id,u);socketsByUser.set(u.id,socket.id);socket.emit('profile:ready',profilePayload(u));emitOnline();}catch(e){console.error(e);err(socket,'Could not create the profile right now.');}});
  socket.on('profile:login',async({username,password})=>{try{const u=await findByName(cleanName(username));if(!u||!verifyPassword(cleanPassword(password),u))return err(socket,'Incorrect username or password.');if(socketsByUser.has(u.id))return err(socket,'That profile is already online.');resetDailyIfNeeded(u);u.sessionToken=token();u.coins=(u.coins||0);if(!u.dailyClaimed['daily-login'])u.dailyLoginReady=true;await saveUser(u);online.set(socket.id,u);socketsByUser.set(u.id,socket.id);socket.emit('profile:ready',profilePayload(u));emitOnline();}catch(e){console.error(e);err(socket,'Could not log in right now.');}});
  socket.on('profile:resume',async({token:t})=>{try{const u=await findByToken(String(t||''));if(!u)return err(socket,'Your saved session was not found. Please log in.');if(socketsByUser.has(u.id))return err(socket,'That profile is already online.');resetDailyIfNeeded(u);await saveUser(u);online.set(socket.id,u);socketsByUser.set(u.id,socket.id);socket.emit('profile:ready',profilePayload(u));emitOnline();}catch(e){err(socket,'Could not resume the profile.');}});
  socket.on('profile:avatar',async({avatar})=>{const u=meForSocket(socket.id);if(!u)return;if(typeof avatar!=='string'||!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(avatar)||avatar.length>2_500_000)return err(socket,'Please choose a smaller PNG/JPG/WEBP image.');u.avatar=avatar;await saveUser(u);socket.emit('profile:update',profilePayload(u));emitOnline();});
  socket.on('daily:claim',async({taskId})=>{const u=meForSocket(socket.id);if(!u)return;const t=DAILY_TASKS.find(x=>x.id===taskId);if(!t)return;const tasks=taskPayload(u),row=tasks.find(x=>x.id===taskId);if(!row||row.progress<row.goal||row.claimed)return err(socket,'That quest is not ready to claim.');u.dailyClaimed[taskId]=true;u.coins=(u.coins||0)+t.reward;await saveUser(u);socket.emit('profile:update',profilePayload(u));socket.emit('reward:claimed',{kind:'quest',title:t.title,coins:t.reward});});
  socket.on('badge:claim',async()=>{const u=meForSocket(socket.id);if(!u)return;const count=badgeCount(u.wins);if((u.claimedBadges||0)>=count)return err(socket,'No badge is ready to claim.');const next=(u.claimedBadges||0)+1;u.claimedBadges=next;const reward=25+next*5;u.coins=(u.coins||0)+reward;await saveUser(u);socket.emit('profile:update',profilePayload(u));socket.emit('reward:claimed',{kind:'badge',title:badgeName(next),coins:reward,badgeIndex:next});});
  socket.on('board:buy',async({boardId})=>{const u=meForSocket(socket.id),b=board(boardId);if(!u||!b||b.royale)return err(socket,'That board is not in the Board Store.');if(b.badgeOnly)return err(socket,`That board unlocks when you earn ${b.badgeReq} badges.`);if(isBoardUnlocked(u,b.id))return err(socket,'You already have that board.');if((u.coins||0)<b.cost)return err(socket,'Not enough Goofy Coins.');u.coins-=b.cost;u.purchasedBoards=[...(u.purchasedBoards||[]),b.id];await saveUser(u);socket.emit('profile:update',profilePayload(u));socket.emit('reward:claimed',{kind:'purchase',title:b.name,coins:-b.cost,board:b});});
  socket.on('board:royale',async()=>{const u=meForSocket(socket.id);if(!u)return;const cost=75;if((u.coins||0)<cost)return err(socket,'INSUFFICIENT GOOFY COINS — YOU NEED 75 TO SPIN.');const b=weightedRoyaleBoard(u);u.coins-=cost;u.purchasedBoards=[...(u.purchasedBoards||[]),b.id];await saveUser(u);socket.emit('royale:result',{board:b,coins:u.coins,rarity:b.rarity,ownedBoards:unlockedBoards(u)});socket.emit('profile:update',profilePayload(u));});
  socket.on('challenge:send',async({targetId,minutes,theme})=>{const me=meForSocket(socket.id);if(!me)return err(socket,'Log in first.');if([...games.values()].some(g=>g.status==='active'&&(g.whiteId===me.id||g.blackId===me.id)))return err(socket,'Finish your current match first.');const target=socketsByUser.get(targetId);if(!target||targetId===me.id)return err(socket,'Player is not available.');if(!isBoardUnlocked(me,theme))return err(socket,'You have not unlocked that board.');const c={id:uid('challenge'),from:me.id,to:targetId,minutes:minutesValid(minutes),theme:board(theme).id,createdAt:Date.now()};challenges.set(c.id,c);io.to(target).emit('challenge:received',{...c,from:publicUser(me)});socket.emit('challenge:sent',{to:publicUser(await getUser(targetId)),...c});setTimeout(()=>challenges.delete(c.id),90_000);});
  socket.on('challenge:respond',async({challengeId,accept})=>{const c=challenges.get(challengeId),me=meForSocket(socket.id);if(!c||!me||c.to!==me.id)return err(socket,'Challenge expired.');challenges.delete(challengeId);const fromSocket=socketsByUser.get(c.from);if(!fromSocket)return err(socket,'Challenger went offline.');if(!accept){io.to(fromSocket).emit('challenge:declined',{from:publicUser(me)});return;}if([...games.values()].some(g=>g.status==='active'&&(g.whiteId===c.from||g.blackId===c.from||g.whiteId===c.to||g.blackId===c.to)))return err(socket,'One of the players is already in a match.');const white=await getUser(c.from),black=await getUser(c.to),gameId=uid('game');const g={id:gameId,whiteId:c.from,blackId:c.to,white,black,chess:new Chess(),whiteMs:c.minutes*60*1000,blackMs:c.minutes*60*1000,status:'active',interval:null,lastTick:Date.now(),theme:c.theme,lastMove:null};games.set(gameId,g);const cs=io.sockets.sockets.get(fromSocket);if(cs)cs.join(gameId);socket.join(gameId);io.to(gameId).emit('game:start',gamePayload(g));startClock(g);});
  socket.on('game:move',async({gameId,from,to,promotion})=>{const me=meForSocket(socket.id),g=games.get(gameId);if(!me||!g||g.status!=='active')return;const color=colorOf(g,me.id);if(!color)return err(socket,'You are not part of this game.');if(g.chess.turn()!==color)return err(socket,'It is not your turn.');syncClock(g);if(g.whiteMs<=0||g.blackMs<=0){return finishGame(g,g.whiteMs<=0?'0-1':'1-0','Time expired');}try{const move=g.chess.move({from,to,promotion:promotion||'q'});if(!move)return err(socket,'Illegal move.');g.lastMove={from:move.from,to:move.to,captured:move.captured||null,piece:move.piece,promotion:move.promotion||null};g.lastTick=Date.now();io.to(gameId).emit('game:update',gamePayload(g));if(g.chess.isCheckmate())await finishGame(g,color==='w'?'1-0':'0-1','Checkmate');else if(g.chess.isDraw())await finishGame(g,'1/2-1/2','Draw');}catch{err(socket,'Illegal move.');}});
  socket.on('game:resign',async({gameId})=>{const me=meForSocket(socket.id),g=games.get(gameId);if(!me||!g||g.status!=='active')return;const c=colorOf(g,me.id);if(c)await finishGame(g,c==='w'?'0-1':'1-0','Resignation');});
  socket.on('leaderboard:request',async()=>{const list=(await listUsers()).slice(0,50).map((u,i)=>({rank:i+1,...publicUser(u)}));socket.emit('leaderboard:update',list);});
  socket.on('profile:history',async()=>{const u=meForSocket(socket.id);if(!u)return;const history=await listHistory(u.id);socket.emit('profile:history',history.map(g=>({id:g.id,opponent:g.opponent||'Unknown',result:g.result,reason:g.reason,theme:g.theme,createdAt:g.created_at||g.createdAt,outcome:g.white_id===u.id?(g.result==='1-0'?'win':g.result==='0-1'?'loss':'draw'):(g.result==='0-1'?'win':g.result==='1-0'?'loss':'draw')})));});
  socket.on('disconnect',async()=>{const u=online.get(socket.id);if(!u)return;online.delete(socket.id);if(socketsByUser.get(u.id)===socket.id)socketsByUser.delete(u.id);for(const g of games.values())if(g.status==='active'&&(g.whiteId===u.id||g.blackId===u.id)){const c=colorOf(g,u.id);await finishGame(g,c==='w'?'0-1':'1-0','Player disconnected');}emitOnline();});
});

(async()=>{try{await dbReady();await migrateLocalIfNeeded();server.listen(PORT,'0.0.0.0',()=>console.log(`Goofy Chess running on ${PORT} using ${pool?'PostgreSQL':'local JSON (development only)'}`));}catch(e){console.error(e);process.exit(1);}})();
