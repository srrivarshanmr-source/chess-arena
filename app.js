const socket = io();
let me = null;
let currentGame = null;
let selected = null;
let pendingChallenge = null;

const $ = id => document.getElementById(id);
const files = ["a","b","c","d","e","f","g","h"];
const pieces = {
  p:["♟","♙"], n:["♞","♘"], b:["♝","♗"], r:["♜","♖"], q:["♛","♕"], k:["♚","♔"]
};

function showError(msg){ $("profileError").textContent = msg; }
function format(ms){
  ms = Math.max(0, ms|0);
  const s = Math.floor(ms/1000), m = Math.floor(s/60), sec=s%60;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
function renderProfile(){
  if(!me) return;
  $("me").textContent = `${me.username} · ${me.rating}`;
  $("profile").innerHTML = `
    <div class="profile-stat"><span>Username</span><b>${escapeHtml(me.username)}</b></div>
    <div class="profile-stat"><span>Rating</span><b>${me.rating}</b></div>
    <div class="profile-stat"><span>Level</span><b>${me.level}</b></div>
    <div class="profile-stat"><span>Wins</span><b>${me.wins}</b></div>
    <div class="profile-stat"><span>Losses</span><b>${me.losses}</b></div>
    <div class="profile-stat"><span>Draws</span><b>${me.draws}</b></div>`;
  let html = "";
  for(let i=1;i<=me.badges;i++) html += `<span class="badge">🏅 ${i*20} Wins</span>`;
  $("badges").innerHTML = me.badges ? `<h3>Badges</h3><div class="badge-grid">${html}</div>` : "";
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

function renderPlayers(players){
  $("players").innerHTML = players.filter(p=>!me || p.id!==me.id).map(p=>`
    <div class="player">
      <div><b>${escapeHtml(p.username)}</b><br><small>⭐ ${p.rating} · L${p.level}</small></div>
      <button data-id="${p.id}">Challenge</button>
    </div>`).join("") || "<p>No other players online.</p>";
  $("players").querySelectorAll("button").forEach(b=>b.onclick=()=>socket.emit("challenge:send",{targetId:b.dataset.id}));
}

function pieceChar(ch){
  const lower=ch.toLowerCase(), black=ch===lower;
  return pieces[lower][black?0:1];
}
function renderBoard(){
  const board=$("board");
  board.innerHTML="";
  if(!currentGame){ for(let i=0;i<64;i++){const s=document.createElement("div");s.className=`square ${(Math.floor(i/8)+i)%2?"dark":"light"}`;board.appendChild(s)}; return; }
  const rows=currentGame.fen.split(" ")[0].split("/");
  const turn=currentGame.turn;
  const myColor = currentGame.white.id===me.id ? "w" : currentGame.black.id===me.id ? "b" : null;
  const orientation = myColor==="b" ? "b" : "w";
  let squares=[];
  for(let r=0;r<8;r++){
    let file=0;
    for(const c of rows[r]){
      if(/[1-8]/.test(c)) for(let k=0;k<Number(c);k++) squares.push({r,file: file++,p:null});
      else squares.push({r,file:file++,p:c});
    }
  }
  const ordered = [];
  for(let rr=0;rr<8;rr++){
    for(let ff=0;ff<8;ff++){
      const r=orientation==="w"?rr:7-rr, f=orientation==="w"?ff:7-ff;
      ordered.push(squares.find(x=>x.r===r&&x.file===f));
    }
  }
  ordered.forEach(sq=>{
    const el=document.createElement("div");
    el.className=`square ${((sq.r+sq.file)%2===0)?"light":"dark"}`;
    const coord=`${files[sq.file]}${8-sq.r}`;
    el.dataset.square=coord;
    if(selected===coord) el.classList.add("selected");
    if(sq.p){
      const span=document.createElement("span");
      span.className=`piece ${sq.p===sq.p.toLowerCase()?"black-piece":"white-piece"}`;
      span.textContent=pieceChar(sq.p);
      el.appendChild(span);
    }
    el.onclick=()=>clickSquare(coord);
    board.appendChild(el);
  });
}
function clickSquare(square){
  if(!currentGame || currentGame.status!=="active") return;
  const myColor=currentGame.white.id===me.id?"w":currentGame.black.id===me.id?"b":null;
  if(!myColor || currentGame.turn!==myColor) return;
  const pieceAt = getPiece(square);
  if(!selected){
    if(pieceAt && ((myColor==="w" && pieceAt===pieceAt.toUpperCase()) || (myColor==="b" && pieceAt===pieceAt.toLowerCase()))) {
      selected=square; renderBoard();
    }
    return;
  }
  if(pieceAt && ((myColor==="w" && pieceAt===pieceAt.toUpperCase()) || (myColor==="b" && pieceAt===pieceAt.toLowerCase()))) {
    selected=square; renderBoard(); return;
  }
  const promotion = pieceAt ? undefined : undefined;
  socket.emit("game:move",{gameId:currentGame.id,from:selected,to:square,promotion});
  selected=null;
}
function getPiece(square){
  if(!currentGame) return null;
  const rows=currentGame.fen.split(" ")[0].split("/");
  const f=files.indexOf(square[0]), r=8-Number(square[1]);
  let x=0;
  for(const c of rows[r]){
    if(/[1-8]/.test(c)) x+=Number(c);
    else { if(x===f) return c; x++; }
  }
  return null;
}
function updateGame(g){
  currentGame=g;
  selected=null;
  $("blackPlayer").textContent=`⚫ ${g.black.username}`;
  $("whitePlayer").textContent=`⚪ ${g.white.username}`;
  $("blackClock").textContent=format(g.blackTime);
  $("whiteClock").textContent=format(g.whiteTime);
  $("status").textContent = g.turn==="w" ? `${g.white.username}'s turn` : `${g.black.username}'s turn`;
  $("resign").disabled=false;
  renderBoard();
}
$("createProfile").onclick=()=>socket.emit("profile:create",{username:$("usernameInput").value});
$("usernameInput").onkeydown=e=>{if(e.key==="Enter")$("createProfile").click()};
$("resign").onclick=()=>{if(currentGame)socket.emit("game:resign",{gameId:currentGame.id})};

socket.on("profile:ready", profile=>{
  me=profile;
  $("profileModal").classList.add("hidden");
  renderProfile();
  $("status").textContent="Choose an online player to challenge.";
  renderBoard();
});
socket.on("players:update", renderPlayers);
socket.on("challenge:received", ({challengeId,from})=>{
  pendingChallenge={challengeId};
  $("challengeText").textContent=`${from.username} wants to play chess with you.`;
  $("challengeModal").classList.remove("hidden");
});
$("acceptChallenge").onclick=()=>{socket.emit("challenge:respond",{challengeId:pendingChallenge.challengeId,accept:true});$("challengeModal").classList.add("hidden")};
$("declineChallenge").onclick=()=>{socket.emit("challenge:respond",{challengeId:pendingChallenge.challengeId,accept:false});$("challengeModal").classList.add("hidden")};
socket.on("challenge:declined",({from})=>$("status").textContent=`${from.username} declined the challenge.`);
socket.on("game:start",updateGame);
socket.on("game:update",updateGame);
socket.on("clock:update",({whiteTime,blackTime})=>{if(currentGame){currentGame.whiteTime=whiteTime;currentGame.blackTime=blackTime;$("whiteClock").textContent=format(whiteTime);$("blackClock").textContent=format(blackTime)}});
socket.on("game:over",({result,reason,white,black,game})=>{
  updateGame(game);
  me = me.id===white.id ? white : black;
  renderProfile();
  $("resign").disabled=true;
  $("status").textContent=`Game over: ${reason}`;
});
socket.on("app:error",({message})=>showError(message));
renderBoard();
