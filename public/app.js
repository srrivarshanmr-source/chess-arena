const socket = io();
let me = null, currentGame = null, selected = null;
const PIECES = {p:"♟",r:"♜",n:"♞",b:"♝",q:"♛",k:"♚",P:"♙",R:"♖",N:"♘",B:"♗",Q:"♕",K:"♔"};
const THEMES = {
  emerald:["#f1f7e9","#4e7c59"], ocean:["#e9f4fb","#3d78a8"],
  sunset:["#fff0e6","#b85c38"], royal:["#f1eafa","#6941a5"], slate:["#e9edf2","#4d5968"]
};

const $ = id => document.getElementById(id);
function toast(msg){ $("toast").textContent=msg; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),2200); }
function show(id){["lobby","dashboard","game"].forEach(x=>$(x).classList.toggle("hidden",x!==id));}

$("joinBtn").onclick=()=>{const name=$("name").value.trim(); if(!name)return toast("Enter a game name first."); socket.emit("player:join",{name});};
$("name").addEventListener("keydown",e=>{if(e.key==="Enter")$("joinBtn").click();});

socket.on("player:ready", p=>{me=p;$("meName").textContent=p.name;$("meRating").textContent=`⭐ ${p.rating}`;$("meLevel").textContent=`LVL ${p.level}`;show("dashboard");});
socket.on("players:update", list=>{
  $("onlineCount").textContent=list.length;
  $("players").innerHTML=list.map(p=>{
    const self=p.id===me?.id;
    return `<div class="player"><div class="who"><b>${escapeHtml(p.name)} ${self?"(you)":""}</b><small>⭐ ${p.rating} · Lv ${p.level} · ${p.status}</small></div>${!self&&p.status==="online"?`<button onclick="challenge('${p.id}')">Play</button>`:""}</div>`;
  }).join("");
});
function challenge(id){socket.emit("challenge:send",{targetId:id,minutes:+$("minutes").value,theme:$("theme").value});toast("Challenge sent.");}
socket.on("challenge:received", c=>{
  if(confirm(`${c.from.name} wants to play ${c.minutes} minute chess. Accept?`)){
    socket.emit("challenge:accept",{fromId:c.from.id,minutes:c.minutes,theme:c.theme});
  }
});
socket.on("game:start", game=>{
  currentGame=game; selected=null; show("game"); renderGame(game);
  const opponent=game.white.id===me.id?game.black:game.white;
  $("opponentName").textContent=opponent.name;$("opponentRating").textContent=`⭐ ${opponent.rating}`;
  $("matchInfo").textContent=`${game.initialSeconds/60} min · ${game.theme} board`;
});
socket.on("game:update",game=>{currentGame=game;renderGame(game);});
socket.on("clock:update", clocks=>{if(currentGame) currentGame.clocks=clocks;renderClocks(clocks);});
socket.on("game:over", r=>{
  const won=(r.winner==="w"&&currentGame.white.id===me.id)||(r.winner==="b"&&currentGame.black.id===me.id);
  $("resultBox").classList.remove("hidden");
  $("resultBox").innerHTML=r.winner==="draw"?"Draw":won?`🏆 You won!<br><small>${r.reason}</small>`:`You lost.<br><small>${r.reason}</small>`;
  $("gameStatus").textContent="FINISHED"; toast(won?"Rating +20":"Rating -15");
  if(me){me.rating=won?me.rating+20:Math.max(100,me.rating-15);me.level=Math.max(1,Math.floor((me.rating-700)/150)+1);}
});
$("resignBtn").onclick=()=>{ if(currentGame) toast("Resignation is handled as a disconnect in this starter build."); };
$("backBtn").onclick=()=>show("dashboard");

function renderGame(game){
  const theme=THEMES[game.theme]||THEMES.emerald;
  document.documentElement.style.setProperty("--light",theme[0]);
  document.documentElement.style.setProperty("--dark",theme[1]);
  const board=$("board");board.innerHTML="";
  const boardObj=parseFen(game.fen);
  const flipped=game.black?.id===me.id;
  for(let rr=0;rr<8;rr++)for(let cc=0;cc<8;cc++){
    const r=flipped?7-rr:rr, c=flipped?7-cc:cc;
    const sq=String.fromCharCode(97+c)+(8-r);
    const div=document.createElement("div");
    div.className="square "+(((r+c)%2===0)?"light":"dark");
    div.dataset.square=sq;
    const piece=boardObj[r][c]; if(piece)div.textContent=PIECES[piece];
    if(selected===sq)div.classList.add("selected");
    div.onclick=()=>clickSquare(sq);
    board.appendChild(div);
  }
  renderClocks(game.clocks);
}
function clickSquare(sq){
  if(!currentGame||currentGame.status!=="playing")return;
  const myColor=currentGame.white.id===me.id?"w":"b";
  if(currentGame.turn!==myColor)return;
  if(!selected){selected=sq;renderGame(currentGame);return;}
  socket.emit("game:move",{gameId:currentGame.id,from:selected,to:sq});
  selected=null;
}
function renderClocks(c){$("myClock").textContent=fmt(c[currentGame?.white.id===me?.id?"w":"b"]??0);$("opponentClock").textContent=fmt(c[currentGame?.white.id===me?.id?"b":"w"]??0);}
function fmt(s){s=Math.max(0,Math.floor(s));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
function parseFen(fen){
  const rows=fen.split(" ")[0].split("/"), out=[];
  for(const row of rows){const a=[];for(const ch of row){if(/[1-8]/.test(ch))for(let i=0;i<+ch;i++)a.push(null);else a.push(ch);}out.push(a);}
  return out;
}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
