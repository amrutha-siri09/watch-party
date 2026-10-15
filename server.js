const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
const PORT = process.env.PORT || 3000;
const MAX_USERS_PER_ROOM = 20;
const MAX_PLAYLIST_ITEMS = 100;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "rooms.json");
const rooms = new Map();

const MOVIES = [
  {id:"m1",title:"The Shawshank Redemption",genre:"Drama",year:1994,rating:9.3,description:"Hope and friendship endure in prison."},
  {id:"m2",title:"The Dark Knight",genre:"Action",year:2008,rating:9.0,description:"A masked hero faces a chaotic criminal."},
  {id:"m3",title:"Inception",genre:"Sci-Fi",year:2010,rating:8.8,description:"A team enters dreams to plant an idea."},
  {id:"m4",title:"Interstellar",genre:"Sci-Fi",year:2014,rating:8.7,description:"Explorers search for humanity's next home."},
  {id:"m5",title:"The Grand Budapest Hotel",genre:"Comedy",year:2014,rating:8.1,description:"A concierge and lobby boy get caught in an adventure."},
  {id:"m6",title:"Spirited Away",genre:"Animation",year:2001,rating:8.6,description:"A girl enters a mysterious spirit world."},
  {id:"m7",title:"Parasite",genre:"Thriller",year:2019,rating:8.5,description:"Two families become entangled in a tense story."},
  {id:"m8",title:"Get Out",genre:"Horror",year:2017,rating:7.8,description:"A weekend visit becomes deeply unsettling."},
  {id:"m9",title:"The Princess Bride",genre:"Adventure",year:1987,rating:8.0,description:"A fairy-tale adventure with wit and romance."},
  {id:"m10",title:"Coco",genre:"Animation",year:2017,rating:8.4,description:"A young musician discovers his family's past."},
  {id:"m11",title:"Knives Out",genre:"Mystery",year:2019,rating:7.9,description:"A detective investigates a family's mysterious death."},
  {id:"m12",title:"Pride and Prejudice",genre:"Romance",year:2005,rating:7.8,description:"A classic story of first impressions and love."},
  {id:"m13",title:"Spider-Man: Into the Spider-Verse",genre:"Animation",year:2018,rating:8.4,description:"A teen discovers what it means to be a hero."},
  {id:"m14",title:"The Matrix",genre:"Sci-Fi",year:1999,rating:8.7,description:"A hacker questions the reality around him."},
  {id:"m15",title:"Paddington 2",genre:"Comedy",year:2017,rating:7.8,description:"A kind bear sets out to find a special gift."},
  {id:"m16",title:"A Quiet Place",genre:"Horror",year:2018,rating:7.5,description:"A family must stay quiet to survive."},
  {id:"m17",title:"Mad Max: Fury Road",genre:"Action",year:2015,rating:8.1,description:"A high-speed escape across a desert wasteland."},
  {id:"m18",title:"The Martian",genre:"Adventure",year:2015,rating:8.0,description:"An astronaut uses science to survive on Mars."},
  {id:"m19",title:"La La Land",genre:"Romance",year:2016,rating:8.0,description:"Two artists chase their dreams in Los Angeles."},
  {id:"m20",title:"The Truman Show",genre:"Drama",year:1998,rating:8.2,description:"A man begins to question his seemingly perfect life."}
];

function validRoomId(value) {
  const s = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,40}$/.test(s) ? s : null;
}
function validHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return ["http:", "https:"].includes(u.protocol) && u.hostname.length > 0 && String(value).length <= 1000;
  } catch { return false; }
}
function levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const row = Array.from({length:b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j-1] + 1, prev + (a[i-1] === b[j-1] ? 0 : 1));
      prev = old;
    }
  }
  return row[b.length];
}
function movieSearch({q="", genre="", sort="recommended"} = {}) {
  const query = String(q).trim().toLowerCase().slice(0, 80);
  let result = MOVIES.filter(m => !genre || genre === "All" || m.genre.toLowerCase() === String(genre).toLowerCase());
  if (query) result = result.map(m => {
    const title = m.title.toLowerCase();
    const words = title.split(/[^a-z0-9]+/);
    const score = title.includes(query) ? 0 : words.some(w => w.startsWith(query)) ? 1 : Math.min(...words.map(w => levenshtein(w, query))) <= Math.max(1, Math.floor(query.length * .3)) ? 2 : 99;
    return {...m, _score: score};
  }).filter(m => m._score < 99).sort((a,b) => a._score-b._score || b.rating-a.rating);
  if (sort === "title") result.sort((a,b)=>a.title.localeCompare(b.title));
  else if (sort === "year-new") result.sort((a,b)=>b.year-a.year);
  else if (sort === "year-old") result.sort((a,b)=>a.year-b.year);
  else if (sort === "rating") result.sort((a,b)=>b.rating-a.rating);
  return result.map(({_score,...m})=>m);
}
function publicPoll(poll) {
  return poll ? {id:poll.id,question:poll.question,options:poll.options.map(({id,label,votes})=>({id,label,votes}))} : null;
}
function cleanRoomForDisk(room) {
  return {
    videoUrl: room.videoUrl, isPlaying: room.isPlaying, currentTime: room.currentTime,
    updatedAt: room.updatedAt, playlist: room.playlist, poll: room.poll ? {
      id: room.poll.id, question: room.poll.question,
      options: room.poll.options, voters: {}
    } : null
  };
}
function saveRooms() {
  try {
    fs.mkdirSync(DATA_DIR, {recursive:true});
    const data = {};
    for (const [id, room] of rooms) data[id] = cleanRoomForDisk(room);
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (error) { console.error("Could not persist room data:", error.message); }
}
function loadRooms() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    for (const [id, saved] of Object.entries(data)) {
      if (!validRoomId(id) || !saved || typeof saved !== "object") continue;
      rooms.set(id, {
        videoUrl: validHttpUrl(saved.videoUrl) ? saved.videoUrl : "",
        isPlaying: Boolean(saved.isPlaying), currentTime: Number.isFinite(saved.currentTime) ? Math.max(0,saved.currentTime) : 0,
        updatedAt: Number.isFinite(saved.updatedAt) ? saved.updatedAt : Date.now(),
        hostId: null, users: new Map(),
        playlist: Array.isArray(saved.playlist) ? saved.playlist.filter(x => x && typeof x.title === "string" && validHttpUrl(x.url)).slice(0,MAX_PLAYLIST_ITEMS) : [],
        poll: saved.poll && Array.isArray(saved.poll.options) ? {...saved.poll, voters:{}} : null
      });
    }
  } catch (error) { console.error("Could not load saved rooms:", error.message); }
}
function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, {videoUrl:"",isPlaying:false,currentTime:0,updatedAt:Date.now(),hostId:null,users:new Map(),playlist:[],poll:null});
  return rooms.get(roomId);
}
function roomSnapshot(roomId) {
  const r = getRoom(roomId);
  return {roomId,videoUrl:r.videoUrl,isPlaying:r.isPlaying,currentTime:r.currentTime,updatedAt:r.updatedAt,hostId:r.hostId,users:[...r.users.values()],playlist:r.playlist,poll:publicPoll(r.poll)};
}
function sendError(socket, message) { socket.emit("app-error", {message}); }

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req,res)=>res.json({ok:true,rooms:rooms.size,maxUsersPerRoom:MAX_USERS_PER_ROOM}));
app.get("/api/movies", (req,res)=>{
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const genre = typeof req.query.genre === "string" ? req.query.genre : "";
  const sort = ["recommended","title","year-new","year-old","rating"].includes(req.query.sort) ? req.query.sort : "recommended";
  const movies = movieSearch({q,genre,sort});
  res.json({movies,genres:["Action","Adventure","Animation","Comedy","Drama","Horror","Mystery","Romance","Sci-Fi","Thriller"]});
});
app.use((err,_req,res,_next)=>{ console.error(err); res.status(400).json({error:"Invalid request"}); });

io.on("connection", socket => {
  socket.on("join-room", (payload={}) => {
    const roomId = validRoomId(payload.roomId || "movie-night");
    const username = String(payload.username || "Guest").trim().slice(0,24);
    if (!roomId) return sendError(socket,"Room code must be 1–40 letters, numbers, hyphens or underscores.");
    if (!username) return sendError(socket,"Please enter a display name.");
    const previous = socket.data.roomId;
    if (previous && previous !== roomId) {
      const old = rooms.get(previous);
      socket.leave(previous);
      if (old) {
        old.users.delete(socket.id);
        if (old.hostId === socket.id) old.hostId = old.users.keys().next().value || null;
        io.to(previous).emit("users-updated",[...old.users.values()]);
        io.to(previous).emit("host-updated",old.hostId);
        if (!old.users.size) rooms.delete(previous);
      }
    }
    const room = getRoom(roomId);
    if (!room.users.has(socket.id) && room.users.size >= MAX_USERS_PER_ROOM) return sendError(socket,`This room is full (maximum ${MAX_USERS_PER_ROOM} people).`);
    socket.data.roomId = roomId; socket.data.username = username;
    socket.join(roomId);
    room.users.set(socket.id,{id:socket.id,username});
    if (!room.hostId) room.hostId = socket.id;
    socket.emit("room-state",roomSnapshot(roomId));
    io.to(roomId).emit("users-updated",[...room.users.values()]);
    io.to(roomId).emit("host-updated",room.hostId);
    io.to(roomId).emit("system-message",{text:`${username} joined the room`,at:Date.now()});
  });

  socket.on("set-video", (payload={}) => {
    const roomId=socket.data.roomId; if(!roomId) return;
    const room=getRoom(roomId);
    if(room.hostId!==socket.id) return sendError(socket,"Only the host can change the shared video.");
    const videoUrl=String(payload.videoUrl||"").trim();
    if(videoUrl && !validHttpUrl(videoUrl)) return sendError(socket,"Enter a valid HTTP or HTTPS video URL.");
    room.videoUrl=videoUrl; room.isPlaying=false; room.currentTime=0; room.updatedAt=Date.now(); saveRooms();
    io.to(roomId).emit("video-updated",{videoUrl,isPlaying:false,currentTime:0,updatedAt:room.updatedAt});
  });
  socket.on("playback",(payload={})=>{
    const roomId=socket.data.roomId; if(!roomId)return;
    const room=getRoom(roomId); const action=payload.action;
    if(room.hostId!==socket.id)return sendError(socket,"Only the host can control playback.");
    if(!["play","pause"].includes(action)||!Number.isFinite(payload.currentTime)||payload.currentTime<0||payload.currentTime>86400)return;
    room.currentTime=payload.currentTime; room.isPlaying=action==="play"; room.updatedAt=Date.now(); saveRooms();
    socket.to(roomId).emit("playback-updated",{action,currentTime:room.currentTime,updatedAt:room.updatedAt,by:socket.data.username});
  });
  socket.on("seek",(payload={})=>{
    const roomId=socket.data.roomId; if(!roomId)return;
    const room=getRoom(roomId);
    if(room.hostId!==socket.id)return sendError(socket,"Only the host can seek the shared video.");
    if(!Number.isFinite(payload.currentTime)||payload.currentTime<0||payload.currentTime>86400)return;
    room.currentTime=payload.currentTime; room.updatedAt=Date.now(); saveRooms();
    socket.to(roomId).emit("seek-updated",{currentTime:room.currentTime,updatedAt:room.updatedAt});
  });
  socket.on("chat-message",(payload={})=>{
    const roomId=socket.data.roomId;if(!roomId)return;
    const text=String(payload.text||"").trim();
    if(!text||text.length>500)return sendError(socket,"Chat messages must contain 1–500 characters.");
    io.to(roomId).emit("chat-message",{username:socket.data.username||"Guest",text,at:Date.now()});
  });
  socket.on("reaction",(payload={})=>{
    const roomId=socket.data.roomId;if(!roomId)return;
    const allowed=["❤️","😂","🔥","😮","👏","🍿"];if(!allowed.includes(payload.emoji))return;
    io.to(roomId).emit("reaction",{emoji:payload.emoji,username:socket.data.username||"Guest",at:Date.now()});
  });
  socket.on("playlist-add",(payload={})=>{
    const roomId=socket.data.roomId;if(!roomId)return;
    const title=String(payload.title||"").trim(), url=String(payload.url||"").trim();
    if(!title||title.length>100||!validHttpUrl(url))return sendError(socket,"Enter a title (1–100 characters) and a valid HTTP(S) video URL.");
    const room=getRoom(roomId);if(room.playlist.length>=MAX_PLAYLIST_ITEMS)return sendError(socket,"Playlist is full (100 items maximum).");
    room.playlist.push({id:`${Date.now()}-${Math.random().toString(16).slice(2,8)}`,title,url,addedBy:socket.data.username||"Guest"});
    saveRooms();io.to(roomId).emit("playlist-updated",room.playlist);
  });
  socket.on("playlist-play",(payload={})=>{
    const roomId=socket.data.roomId;if(!roomId)return;
    const room=getRoom(roomId);if(room.hostId!==socket.id)return sendError(socket,"Only the host can start a playlist item.");
    const item=room.playlist.find(entry=>entry.id===String(payload.id));if(!item)return;
    room.videoUrl=item.url;room.isPlaying=false;room.currentTime=0;room.updatedAt=Date.now();saveRooms();
    io.to(roomId).emit("video-updated",{videoUrl:item.url,isPlaying:false,currentTime:0,updatedAt:room.updatedAt});
  });
  socket.on("create-poll",(payload={})=>{
    const roomId=socket.data.roomId;if(!roomId)return;
    const question=String(payload.question||"").trim();
    const options=Array.isArray(payload.options)?payload.options.map(x=>String(x).trim()).filter(Boolean):[];
    if(!question||question.length>180||options.length<2||options.length>5||options.some(x=>x.length>80)||new Set(options.map(x=>x.toLowerCase())).size!==options.length)return sendError(socket,"Polls need a question and 2–5 unique options (max 80 characters each).");
    const room=getRoom(roomId);room.poll={id:String(Date.now()),question,options:options.map((label,i)=>({id:String(i),label,votes:0})),voters:{}};
    saveRooms();io.to(roomId).emit("poll-updated",publicPoll(room.poll));
  });
  socket.on("vote-poll",(payload={})=>{
    const roomId=socket.data.roomId;if(!roomId)return;
    const room=getRoom(roomId);if(!room.poll||room.poll.voters[socket.id])return;
    const option=room.poll.options.find(x=>x.id===String(payload.optionId));if(!option)return;
    option.votes++;room.poll.voters[socket.id]=true;saveRooms();io.to(roomId).emit("poll-updated",publicPoll(room.poll));
  });
  socket.on("transfer-host",(payload={})=>{
    const roomId=socket.data.roomId;if(!roomId)return;
    const room=getRoom(roomId);if(room.hostId!==socket.id||!room.users.has(payload.userId))return sendError(socket,"Only the host can transfer hosting to a current room member.");
    room.hostId=payload.userId;io.to(roomId).emit("host-updated",room.hostId);
    io.to(roomId).emit("system-message",{text:`${room.users.get(payload.userId).username} is now the host`,at:Date.now()});
  });
  socket.on("disconnect",()=>{
    const roomId=socket.data.roomId;if(!roomId)return;
    const room=rooms.get(roomId);if(!room)return;
    const user=room.users.get(socket.id);room.users.delete(socket.id);
    if(room.hostId===socket.id)room.hostId=room.users.keys().next().value||null;
    io.to(roomId).emit("users-updated",[...room.users.values()]);
    if(user)io.to(roomId).emit("system-message",{text:`${user.username} left the room`,at:Date.now()});
    if(!room.users.size){saveRooms();room.hostId=null;} else io.to(roomId).emit("host-updated",room.hostId);
  });
});

loadRooms();
if(require.main===module) server.listen(PORT,()=>console.log(`Watch Party running at http://localhost:${PORT}`));
module.exports={app,server,io,rooms,MOVIES,movieSearch,validRoomId,validHttpUrl,MAX_USERS_PER_ROOM,loadRooms,saveRooms};
