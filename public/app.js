const socket = io();
const $ = (id) => document.getElementById(id);

const state = {
  roomCode: "",
  isHost: false,
  self: null,
  room: null,
  privateState: null,
  revealReady: false,
  startY: null,
  dragY: 0,
  timerHandle: null,
  deferredInstallPrompt: null,
  audio: null
};

function playSound(type){
  const C=window.AudioContext||window.webkitAudioContext;
  if(!C) return;
  if(!state.audio) state.audio=new C();
  const ctx=state.audio, now=ctx.currentTime;
  const sounds={click:[440],reveal:[523.25,659.25],tick:[880],drum:[180,120],win:[523.25,659.25,783.99],error:[220,180]};
  (sounds[type]||sounds.click).forEach((f,i)=>{
    const osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.type=(type==="drum"||type==="error")?"sawtooth":"sine";
    osc.frequency.value=f;
    gain.gain.setValueAtTime(.0001,now+i*.08);
    gain.gain.exponentialRampToValueAtTime(.06,now+i*.08+.01);
    gain.gain.exponentialRampToValueAtTime(.0001,now+i*.08+.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now+i*.08); osc.stop(now+i*.08+.2);
  });
}
function status(text){ $("statusBox").textContent=text; }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function confetti(){
  const box=$("confetti");
  box.innerHTML=""; box.classList.remove("hidden");
  const colors=["#ff4fd8","#7a5cff","#39c6ff","#38f0a4","#ffd15c","#ff7e92"];
  for(let i=0;i<90;i++){
    const d=document.createElement("div");
    d.className="piece";
    d.style.left=Math.random()*100+"vw";
    d.style.background=colors[Math.floor(Math.random()*colors.length)];
    d.style.animationDelay=(Math.random()*.6)+"s";
    d.style.transform=`translateY(-10vh) rotate(${Math.random()*360}deg)`;
    box.appendChild(d);
  }
  setTimeout(()=>box.classList.add("hidden"),3200);
}
function updateCategoryOptions(){
  const options=["random","Food","Animals","Countries","Celebrities","Movies","Brands","Cities","Cars","Games","Superheroes"];
  $("categorySelect").innerHTML=options.map(value=>{
    const label=value==="random"?"Random Category":value;
    return `<option value="${value}">${label}</option>`;
  }).join("");
}
function updateImposterOptions(){
  const count=state.room?.players?.length || 4;
  const max=Math.max(1,Math.min(6,count-1));
  $("imposterCountSelect").innerHTML=Array.from({length:max},(_,i)=>`<option value="${i+1}">${i+1} ${i===0?"imposter":"imposters"}</option>`).join("");
}
function renderRoomBox(){
  if(!state.roomCode){ $("roomBox").textContent="Not connected yet."; return; }
  $("roomBox").innerHTML=`<strong>Room:</strong> ${esc(state.roomCode)}<br><strong>You are:</strong> ${esc(state.self?.name || "Unknown")}<br><strong>${state.isHost?"Role":"Host"}</strong>: ${state.isHost?"Host":"Player"}`;
}
async function renderQR(){
  if(!state.isHost || !state.roomCode) return;
  const url=new URL(window.location.href);
  url.searchParams.set("room", state.roomCode);
  $("qrText").textContent=url.toString();
  try{
    const res=await fetch(`/api/qr?url=${encodeURIComponent(url.toString())}`);
    const data=await res.json();
    $("qrImage").src=data.dataUrl;
    $("qrPanel").classList.remove("hidden");
  }catch{
    $("qrText").textContent="QR generation failed, but room code still works.";
  }
}
function showScreen(name){
  ["joinScreen","lobbyScreen","revealScreen","discussionScreen","votingScreen","resultsScreen"].forEach(id=>$(id).classList.add("hidden"));
  $(name).classList.remove("hidden");
}
function renderPlayersList(){
  if(!state.room) return;
  $("playersList").innerHTML=state.room.players.map(p=>`<div class="player"><div class="playerInfo"><div class="avatar ${esc(p.avatarClass)}" data-cycle="${esc(p.socketId)}">${esc(p.avatar)}</div><b>${esc(p.name)}${p.isHost?" ⭐":""}</b></div><div>${p.score}</div></div>`).join("");
}
function renderPhase(){
  if(!state.room) return;
  renderRoomBox();
  renderPlayersList();
  updateImposterOptions();
  $("hostControls").classList.toggle("hidden", !state.isHost);
  $("goDiscussionBtn").classList.toggle("hidden", !state.isHost);
  $("voteNowBtn").classList.toggle("hidden", !state.isHost);
  $("newRoundBtn").classList.toggle("hidden", !state.isHost);
  if(state.room.phase==="lobby") showScreen("lobbyScreen");
  if(state.room.phase==="reveal") showScreen("revealScreen");
  if(state.room.phase==="discussion") showScreen("discussionScreen");
  if(state.room.phase==="voting") showScreen("votingScreen");
  if(state.room.phase==="results") showScreen("resultsScreen");
  if(state.room.phase==="discussion" && state.room.gameSummary) startClientTimer(state.room.gameSummary.minutes); else stopClientTimer();
  if(state.room.phase==="voting") renderVoting();
}
function renderPrivateState(){
  if(!state.privateState || state.room?.phase!=="reveal") return;
  $("revealTitle").textContent=`${state.self?.avatar || "🙂"} ${state.self?.name || ""}`;
  $("revealMeta").textContent=`${state.privateState.category || ""} • Round ${state.privateState.round || 1}`;
  $("revealBack").innerHTML=`<div class="bigEmoji">${state.privateState.role?esc(state.privateState.role.emoji):esc(state.self?.avatar || "🙂")}</div><div class="roleTag">${esc(state.privateState.title)}${state.privateState.role?` • ${esc(state.privateState.role.emoji)} ${esc(state.privateState.role.name)}`:""}</div><div class="word">${esc(state.privateState.word || "")}</div><div class="muted">Category: ${esc(state.privateState.category || "")}</div><p class="muted" style="margin-top:14px">${esc(state.privateState.note || "")}</p>`;
}
function renderVoting(){
  if(!state.privateState || !state.room) return;
  if(!state.privateState.canVote){
    $("votingBox").innerHTML="You are a Ghost this round, so you cannot vote.";
    return;
  }
  const options=state.privateState.players.map(p=>`<option value="${esc(p.socketId)}">${esc(p.name)}</option>`).join("");
  const alreadyVoted=state.room.players.find(p=>p.socketId===state.self?.socketId)?.hasVoted;
  $("votingBox").innerHTML=`<div style="margin-bottom:10px">${alreadyVoted?"You already voted.":"Pick who you think is an imposter."}</div><div class="row"><select id="voteSelect">${options}</select><button id="voteBtn" class="success" ${alreadyVoted?"disabled":""}>Submit Vote</button></div>`;
  const btn=$("voteBtn");
  if(btn){
    btn.onclick=()=>{
      socket.emit("vote:submit", {code:state.roomCode, targetId:$("voteSelect").value});
      playSound("click");
    };
  }
}
function startClientTimer(minutes){
  stopClientTimer();
  let sec=Number(minutes||3)*60;
  const tick=()=>{
    $("timer").textContent=`${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
    if(sec>0 && sec<=5) playSound("tick");
    sec -= 1;
  };
  tick();
  state.timerHandle=setInterval(()=>{
    tick();
    if(sec<0) stopClientTimer();
  },1000);
}
function stopClientTimer(){ if(state.timerHandle) clearInterval(state.timerHandle); state.timerHandle=null; }
function attachRevealGesture(){
  const card=$("revealCard");
  card.addEventListener("click", ()=>{
    if(card.classList.contains("revealed") || state.room?.phase!=="reveal") return;
    state.revealReady=true; card.classList.add("ready");
    $("revealHint").textContent="Now swipe up to reveal."; playSound("click");
  });
  const start=y=>{ if(!state.revealReady || card.classList.contains("revealed")) return; state.startY=y; };
  const move=y=>{ if(state.startY==null || !state.revealReady || card.classList.contains("revealed")) return; const dy=Math.min(0,y-state.startY); state.dragY=dy; card.style.transform=`translateY(${dy}px)`; };
  const end=()=>{ if(state.startY==null) return; if(Math.abs(state.dragY)>120){ card.style.transform="translateY(-140px)"; card.classList.add("revealed"); playSound("reveal"); } else { card.style.transform="translateY(0px)"; } state.startY=null; state.dragY=0; };
  card.addEventListener("touchstart", e=>start(e.touches[0].clientY), {passive:true});
  card.addEventListener("touchmove", e=>move(e.touches[0].clientY), {passive:true});
  card.addEventListener("touchend", end);
  card.addEventListener("mousedown", e=>start(e.clientY));
  window.addEventListener("mousemove", e=>move(e.clientY));
  window.addEventListener("mouseup", end);
}
function bind(){
  $("createBtn").onclick=()=>{
    const name=$("playerName").value.trim();
    if(!name) return status("Enter your player name first.");
    socket.emit("room:create", {name});
    playSound("click");
  };
  $("joinBtn").onclick=()=>{
    const code=$("roomCode").value.trim().toUpperCase();
    const name=$("playerName").value.trim();
    if(!code || !name) return status("Enter room code and your name.");
    socket.emit("room:join", {code, name});
    playSound("click");
  };
  $("rulesBtn").onclick=()=>{ $("rulesBox").classList.toggle("hidden"); playSound("click"); };
  $("startRoundBtn").onclick=()=>{
    socket.emit("room:start", {
      code: state.roomCode,
      settings: {
        category: $("categorySelect").value,
        imposters: Number($("imposterCountSelect").value),
        minutes: Number($("minutesSelect").value),
        rolesOn: $("rolesSelect").value === "on",
        mode: $("modeSelect").value
      }
    });
    playSound("click");
  };
  $("goDiscussionBtn").onclick=()=>{ socket.emit("room:phase", {code:state.roomCode, phase:"discussion"}); playSound("click"); };
  $("voteNowBtn").onclick=()=>{ socket.emit("room:phase", {code:state.roomCode, phase:"voting"}); playSound("drum"); };
  $("newRoundBtn").onclick=()=>{ showScreen("lobbyScreen"); playSound("click"); };
  $("installBtn").onclick=()=>{ if(state.deferredInstallPrompt) state.deferredInstallPrompt.prompt(); else status("Use your browser menu to install this app."); };
  $("playersList").addEventListener("click", (e)=>{
    const avatar=e.target.closest("[data-cycle]");
    if(avatar && avatar.dataset.cycle===state.self?.socketId){
      socket.emit("avatar:cycle", {code:state.roomCode});
      playSound("click");
    }
  });
  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    state.deferredInstallPrompt=e;
    $("installHint").textContent="Install is ready. Tap Install App.";
  });
  const params=new URLSearchParams(window.location.search);
  const room=params.get("room");
  if(room) $("roomCode").value=room.toUpperCase();
}
socket.on("room:joined", ({code,isHost,self})=>{
  state.roomCode=code; state.isHost=isHost; state.self=self;
  $("roomCode").value=code; $("playerName").value=self.name;
  const url=new URL(window.location.href); url.searchParams.set("room", code); history.replaceState({}, "", url.toString());
  renderRoomBox(); showScreen("lobbyScreen"); if(isHost) renderQR(); status(`Connected to room ${code}.`);
});
socket.on("room:update", (room)=>{ state.room=room; renderPhase(); });
socket.on("private:update", (payload)=>{
  state.privateState=payload; renderPrivateState();
  if(state.room?.phase==="reveal"){
    $("revealCard").classList.remove("ready","revealed");
    $("revealCard").style.transform="translateY(0px)";
    $("revealHint").textContent="Tap the card, then swipe up.";
    state.revealReady=false;
  }
});
socket.on("round:results", (results)=>{
  $("resultsBox").innerHTML=`<div class="resultBlock"><strong>${esc(results.resultText)}</strong><br>Category: ${esc(results.category)}<br>Real word: ${esc(results.realWord)}<br>Imposters: ${esc(results.imposters.join(", "))}<br>Most voted: ${esc(results.votedOut.join(", "))}<br>Winners: ${esc(results.winners.join(", "))}</div><div class="resultGrid">${Object.entries(results.counts).map(([name,total])=>`<div class="resultBlock"><strong>${esc(name)}</strong><br>${total} vote(s)</div>`).join("")}</div>`;
  showScreen("resultsScreen");
  if(results.resultText.toLowerCase().includes("win")){ playSound("win"); confetti(); }
});
socket.on("app:error", (message)=>{ status(message); playSound("error"); });

updateCategoryOptions();
attachRevealGesture();
bind();
showScreen("joinScreen");
status("Ready to connect.");