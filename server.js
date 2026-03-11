const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on http://localhost:${PORT}`); });
const PUBLIC_DIR = path.join(__dirname, "public");


app.use(express.static(PUBLIC_DIR));
app.use(express.json());

const rooms = new Map();

const AVATARS = ["😎","🤖","🐸","👾","🦊","🐼","🐱","🐵","🦄","🐧","🐯","🦁","🐻","🐙","🦋","🐺","🦉","🐬","🫠","🥷","🤠","🐰"];
const THEMES = ["a1","a2","a3","a4","a5"];
const ROLE_DEFS = [
  { key: "detective", emoji: "🕵️", name: "Detective" },
  { key: "jester", emoji: "🤡", name: "Jester" },
  { key: "ghost", emoji: "👻", name: "Ghost" },
  { key: "shapeshifter", emoji: "🌀", name: "Shapeshifter" },
  { key: "sniper", emoji: "🎯", name: "Sniper" },
  { key: "chaos", emoji: "🔥", name: "Chaos Agent" }
];
const BASE_CATEGORIES = {
  Food: ["Pizza","Burger","Sushi","Taco","Shawarma","Pasta","Falafel","Croissant","Ramen","Donut"],
  Animals: ["Lion","Tiger","Elephant","Zebra","Panda","Dolphin","Fox","Camel","Penguin","Giraffe"],
  Countries: ["France","Brazil","Japan","Egypt","Italy","Morocco","Canada","Lebanon","Spain","Turkey"],
  Celebrities: ["Messi","Ronaldo","Beyonce","Drake","Taylor Swift","Shakira","Adele","Michael Jackson","Rihanna","Tom Cruise"],
  Movies: ["Titanic","Avatar","Frozen","Joker","Interstellar","Shrek","Moana","Coco","Toy Story","Gladiator"],
  Brands: ["Nike","Adidas","Apple","Samsung","Rolex","Gucci","Netflix","Amazon","Google","Starbucks"],
  Cities: ["Paris","Dubai","Beirut","Tokyo","London","Rome","Barcelona","New York","Doha","Istanbul"],
  Cars: ["Ferrari","BMW","Lamborghini","Porsche","Tesla","Mercedes","Bugatti","Jeep","Audi","Bentley"],
  Games: ["Minecraft","Fortnite","FIFA","Roblox","Among Us","Valorant","Mario Kart","Call of Duty","Clash Royale","GTA"],
  Superheroes: ["Batman","Spider-Man","Iron Man","Thor","Hulk","Superman","Flash","Deadpool","Loki","Wonder Woman"]
};
const SIMILAR_PAIRS = {
  Pizza:"Burger", Burger:"Pizza", Lion:"Tiger", Tiger:"Lion", France:"Italy", Italy:"France",
  Messi:"Ronaldo", Ronaldo:"Messi", Batman:"Spider-Man", "Spider-Man":"Batman",
  Ferrari:"Lamborghini", Lamborghini:"Ferrari", Paris:"Rome", Rome:"Paris",
  Apple:"Samsung", Samsung:"Apple", Avatar:"Titanic", Titanic:"Avatar",
  Nike:"Adidas", Adidas:"Nike", Minecraft:"Roblox", Roblox:"Minecraft",
  Shawarma:"Falafel", Falafel:"Shawarma"
};

function rand(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function shuffle(arr){
  const copy=[...arr];
  for(let i=copy.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [copy[i],copy[j]]=[copy[j],copy[i]];
  }
  return copy;
}
function makeCode(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }
function expandCategories(){
  const categories={};
  for(const [name, values] of Object.entries(BASE_CATEGORIES)){
    const list=[...values];
    const base=[...values];
    for(let i=1;i<=10 && list.length<120;i++){
      for(const word of base) list.push(`${word} ${i}`);
    }
    categories[name]=list;
  }
  return categories;
}
const CATEGORIES = expandCategories();

function publicRoomState(room){
  return {
    code: room.code,
    hostSocketId: room.hostSocketId,
    phase: room.phase,
    settings: room.settings,
    players: room.players.map(p => ({
      socketId: p.socketId,
      name: p.name,
      avatar: p.avatar,
      avatarClass: p.avatarClass,
      score: p.score,
      isHost: p.socketId === room.hostSocketId,
      hasVoted: room.game ? !!room.game.votes[p.socketId] : false
    })),
    gameSummary: room.game ? {
      category: room.game.category,
      mode: room.game.mode,
      minutes: room.game.minutes,
      round: room.game.round
    } : null
  };
}
function emitRoom(room){ io.to(room.code).emit("room:update", publicRoomState(room)); }

function ensureRoom(code){
  if(!rooms.has(code)){
    rooms.set(code,{
      code,
      hostSocketId:null,
      phase:"lobby",
      players:[],
      settings:{category:"random",mode:"classic",minutes:3,imposters:1,rolesOn:true},
      game:null
    });
  }
  return rooms.get(code);
}
function assignRoles(players, rolesOn){
  const assigned={};
  players.forEach(p => assigned[p.socketId]=null);
  if(!rolesOn) return assigned;
  const pool=shuffle(ROLE_DEFS);
  const count=Math.min(Math.max(1,Math.floor(players.length/3)), Math.min(pool.length,4));
  const selected=shuffle(players).slice(0,count);
  selected.forEach((p,i)=>assigned[p.socketId]=pool[i]);
  return assigned;
}
function buildPrivateState(room, socketId){
  if(!room.game) return {phase:room.phase};
  const player=room.players.find(p=>p.socketId===socketId);
  if(!player) return {phase:room.phase};
  const imposter=room.game.imposters.includes(socketId);
  const role=room.game.roles[socketId];
  let title="YOUR WORD";
  let word=room.game.realWord;
  let note="Remember your info, then discuss carefully.";
  if(imposter){
    title="YOU ARE THE IMPOSTER";
    word=room.game.similarMode ? room.game.fakeWord : "Imposter";
    note=room.game.similarMode ? "You got a similar fake word. Blend in." : "Blend in without knowing the real word.";
  }
  if(role){
    if(role.key==="detective" && !imposter){
      const knownId = room.game.imposters.length ? rand(room.game.imposters) : null;
      const known = room.players.find(p=>p.socketId===knownId);
      if(known) note += ` You know one imposter: ${known.name}.`;
    }
    if(role.key==="ghost") note += " You cannot vote this round.";
    if(role.key==="shapeshifter"){
      const choices=CATEGORIES[room.game.category].filter(w=>w!==room.game.realWord);
      if(choices.length) word=rand(choices);
      note += " Your word is unstable.";
    }
    if(role.key==="sniper") note += " Vote for an imposter to earn a bonus point.";
    if(role.key==="chaos") note += " You win if the vote ends in total confusion.";
  }
  return {
    phase: room.phase,
    category: room.game.category,
    mode: room.game.mode,
    role,
    title,
    word,
    note,
    isImposter: imposter,
    round: room.game.round,
    canVote: !(role && role.key==="ghost"),
    players: room.players.map(p=>({socketId:p.socketId,name:p.name}))
  };
}
function emitPrivateStates(room){
  room.players.forEach(player => io.to(player.socketId).emit("private:update", buildPrivateState(room, player.socketId)));
}
function startRound(room, settings){
  const category = settings.category === "random" ? rand(Object.keys(CATEGORIES)) : settings.category;
  const words = CATEGORIES[category];
  const realWord = rand(words);
  const fakeWord = SIMILAR_PAIRS[realWord] || rand(words.filter(w=>w!==realWord));
  const mode = settings.mode || "classic";
  const minutes = mode === "speed" ? 1 : Number(settings.minutes || 3);
  let imposterCount = Number(settings.imposters || 1);
  if(mode==="chaos" || mode==="hardcore") imposterCount=Math.max(imposterCount,2);
  imposterCount=Math.min(imposterCount, Math.max(1, room.players.length-1));
  room.game = {
    round: (room.game?.round || 0) + 1,
    category,
    realWord,
    fakeWord,
    similarMode: mode==="similar" || mode==="hardcore",
    mode,
    minutes,
    imposters: shuffle(room.players).slice(0,imposterCount).map(p=>p.socketId),
    roles: assignRoles(room.players, !!settings.rolesOn),
    votes: {},
    startedAt: Date.now()
  };
  room.phase="reveal";
  room.settings={category:settings.category, mode, minutes, imposters:imposterCount, rolesOn:!!settings.rolesOn};
  emitRoom(room);
  emitPrivateStates(room);
}
function scoreAndFinish(room){
  const votes=room.game.votes;
  const counts={};
  Object.values(votes).forEach(target=>counts[target]=(counts[target]||0)+1);
  const maxVotes=Math.max(0,...Object.values(counts));
  const votedOut=Object.keys(counts).filter(id=>counts[id]===maxVotes);
  const imposterIds=room.game.imposters;
  const chaosWinner = Object.values(counts).length>1 && Object.values(counts).every(v=>v===maxVotes);
  let winners=[], resultText="";
  const jesterWinner = room.players.find(p=>{
    const role=room.game.roles[p.socketId];
    return role && role.key==="jester" && votedOut.includes(p.socketId);
  });
  const chaosWinners = room.players.filter(p=>{
    const role=room.game.roles[p.socketId];
    return role && role.key==="chaos";
  });
  if(jesterWinner){
    winners=[jesterWinner.socketId];
    resultText="Jester wins by being voted out.";
  } else if(chaosWinners.length && chaosWinner){
    winners=chaosWinners.map(p=>p.socketId);
    resultText="Chaos Agent wins because the vote ended in confusion.";
  } else if(imposterIds.every(id=>votedOut.includes(id))){
    winners=room.players.filter(p=>!imposterIds.includes(p.socketId)).map(p=>p.socketId);
    resultText="Players win. All imposters were caught.";
  } else {
    winners=[...imposterIds];
    resultText="Imposters win. At least one survived.";
  }
  winners.forEach(id=>{
    const player=room.players.find(p=>p.socketId===id);
    if(player) player.score += 1;
  });
  room.players.forEach(player=>{
    const role=room.game.roles[player.socketId];
    if(role && role.key==="sniper" && imposterIds.includes(votes[player.socketId])) player.score += 1;
  });
  room.phase="results";
  io.to(room.code).emit("round:results", {
    resultText,
    winners: winners.map(id=>room.players.find(p=>p.socketId===id)?.name).filter(Boolean),
    votedOut: votedOut.map(id=>room.players.find(p=>p.socketId===id)?.name).filter(Boolean),
    imposters: imposterIds.map(id=>room.players.find(p=>p.socketId===id)?.name).filter(Boolean),
    counts: Object.fromEntries(Object.entries(counts).map(([id,total])=>[room.players.find(p=>p.socketId===id)?.name||id,total])),
    category: room.game.category,
    realWord: room.game.realWord
  });
  emitRoom(room);
  emitPrivateStates(room);
}

app.get("/api/health", (_req,res)=>res.json({ok:true, rooms:rooms.size}));
app.get("/api/qr", async (req,res)=>{
  try{
    const url=String(req.query.url || "");
    if(!url) return res.status(400).json({error:"Missing url"});
    const dataUrl = await QRCode.toDataURL(url, {margin:1, width:260});
    res.json({dataUrl});
  }catch(err){
    res.status(500).json({error:"QR failed"});
  }
});

io.on("connection", (socket)=>{
  socket.on("room:create", ({name})=>{
    const code=makeCode();
    const room=ensureRoom(code);
    room.hostSocketId=socket.id;
    const player={socketId:socket.id,name:String(name||"Host").trim()||"Host",avatar:rand(AVATARS),avatarClass:rand(THEMES),score:0};
    room.players.push(player);
    socket.join(code);
    socket.emit("room:joined", {code, isHost:true, self:player});
    emitRoom(room); emitPrivateStates(room);
  });
  socket.on("room:join", ({code,name})=>{
    code=String(code||"").trim().toUpperCase();
    const room=rooms.get(code);
    if(!room) return socket.emit("app:error", "Room not found.");
    if(room.players.some(p=>p.name.toLowerCase()===String(name||"").trim().toLowerCase())) return socket.emit("app:error", "That player name already exists in the room.");
    const player={socketId:socket.id,name:String(name||"Player").trim()||"Player",avatar:rand(AVATARS),avatarClass:rand(THEMES),score:0};
    room.players.push(player);
    socket.join(code);
    socket.emit("room:joined", {code, isHost:false, self:player});
    emitRoom(room); emitPrivateStates(room);
  });
  socket.on("avatar:cycle", ({code})=>{
    const room=rooms.get(String(code||"").toUpperCase());
    if(!room) return;
    const player=room.players.find(p=>p.socketId===socket.id);
    if(!player) return;
    player.avatar=rand(AVATARS); player.avatarClass=rand(THEMES);
    emitRoom(room);
  });
  socket.on("room:start", ({code,settings})=>{
    const room=rooms.get(String(code||"").toUpperCase());
    if(!room || room.hostSocketId!==socket.id) return;
    if(room.players.length<3) return socket.emit("app:error", "You need at least 3 players.");
    startRound(room, settings || {});
  });
  socket.on("room:phase", ({code,phase})=>{
    const room=rooms.get(String(code||"").toUpperCase());
    if(!room || room.hostSocketId!==socket.id || !room.game) return;
    if(["discussion","voting"].includes(phase)){
      room.phase=phase;
      emitRoom(room); emitPrivateStates(room);
    }
  });
  socket.on("vote:submit", ({code,targetId})=>{
    const room=rooms.get(String(code||"").toUpperCase());
    if(!room || room.phase!=="voting" || !room.game) return;
    const player=room.players.find(p=>p.socketId===socket.id);
    if(!player) return;
    const role=room.game.roles[socket.id];
    if(role && role.key==="ghost") return socket.emit("app:error", "Ghost cannot vote.");
    if(!room.players.some(p=>p.socketId===targetId)) return;
    room.game.votes[socket.id]=targetId;
    emitRoom(room);
    const eligible = room.players.filter(p=>!(room.game.roles[p.socketId] && room.game.roles[p.socketId].key==="ghost")).length;
    if(Object.keys(room.game.votes).length >= eligible) scoreAndFinish(room);
  });
  socket.on("round:finishNow", ({code})=>{
    const room=rooms.get(String(code||"").toUpperCase());
    if(!room || room.hostSocketId!==socket.id || !room.game) return;
    scoreAndFinish(room);
  });
  socket.on("disconnect", ()=>{
    const empty=[];
    rooms.forEach((room,code)=>{
      const index=room.players.findIndex(p=>p.socketId===socket.id);
      if(index!==-1){
        room.players.splice(index,1);
        if(room.hostSocketId===socket.id && room.players.length) room.hostSocketId=room.players[0].socketId;
        if(!room.players.length) empty.push(code);
        else { emitRoom(room); emitPrivateStates(room); }
      }
    });
    empty.forEach(code=>rooms.delete(code));
  });
});

app.get("*", (_req,res)=>res.sendFile(path.join(PUBLIC_DIR, "index.html")));
server.listen(PORT, ()=>console.log(`Server running on http://localhost:${PORT}`));