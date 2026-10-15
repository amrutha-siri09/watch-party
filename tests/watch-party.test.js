const test = require("node:test");
const assert = require("node:assert/strict");
const { io: connect } = require("socket.io-client");
const { server, movieSearch, validRoomId, validHttpUrl, MAX_USERS_PER_ROOM, rooms, saveRooms, loadRooms } = require("../server");

let origin;
test.before(async () => {
  await new Promise(resolve => server.listen(0, resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});

function connectClient() {
  return new Promise((resolve, reject) => {
    const socket = connect(origin, {transports:["websocket"],reconnection:false,timeout:4000});
    socket.once("connect",()=>resolve(socket));
    socket.once("connect_error",reject);
  });
}
function waitEvent(socket, name, timeout=3000) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off(name,handler);reject(new Error(`Timed out waiting for ${name}`));},timeout);
    function handler(data){clearTimeout(timer);resolve(data);}
    socket.once(name,handler);
  });
}
function waitForRosterSize(socket, size) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off("users-updated",handler);reject(new Error(`Timed out waiting for ${size} users`));},4000);
    function handler(users) {
      if (users.length >= size) { clearTimeout(timer); socket.off("users-updated",handler); resolve(users); }
    }
    socket.on("users-updated",handler);
  });
}

test("movie search supports fuzzy matching, genre filter and sorting", async () => {
  assert.equal(movieSearch({q:"incepton"})[0].title,"Inception");
  assert.ok(movieSearch({genre:"Comedy"}).every(m=>m.genre==="Comedy"));
  const rated=movieSearch({sort:"rating"});
  assert.ok(rated[0].rating>=rated[1].rating);
  const response=await fetch(`${origin}/api/movies?q=intersteler`);
  assert.equal(response.status,200);
  assert.equal((await response.json()).movies[0].title,"Interstellar");
});
test("validation rejects unsafe room codes and non-http URLs", () => {
  assert.equal(validRoomId("room_1"),"room_1");
  assert.equal(validRoomId("room name"),null);
  assert.equal(validHttpUrl("https://example.com/video.mp4"),true);
  assert.equal(validHttpUrl("javascript:alert(1)"),false);
});

test("10 concurrent users join, receive chat, and room capacity is enforced", async t => {
  const clients=[];
  t.after(()=>clients.forEach(c=>c.close()));
  for(let i=0;i<10;i++) clients.push(await connectClient());
  const roomId=`test-room-${Date.now()}`;
  const joins=clients.map((c,i)=>waitEvent(c,"room-state"));
  const rosterUpdate=waitForRosterSize(clients[0],10);
  clients.forEach((c,i)=>c.emit("join-room",{roomId,username:`Tester${i}`}));
  const states=await Promise.all(joins);
  assert.equal(states.length,10);
  const roster=await rosterUpdate;
  assert.equal(roster.length,10);

  const messagePromises=clients.map(c=>waitEvent(c,"chat-message"));
  const started=performance.now();
  clients[0].emit("chat-message",{text:"hello concurrency"});
  const received=await Promise.all(messagePromises);
  const elapsed=performance.now()-started;
  assert.ok(received.every(m=>m.text==="hello concurrency"));
  console.log(`LATENCY_TEST chat broadcast to 10 clients: ${elapsed.toFixed(2)} ms total; local loopback, WebSocket transport, one message, 10 connected clients.`);
  assert.ok(elapsed<2000,`local chat broadcast unexpectedly took ${elapsed}ms`);

  // Fill the room to the documented cap and check the next join is rejected.
  const extras=[];
  try {
    for(let i=10;i<MAX_USERS_PER_ROOM;i++) extras.push(await connectClient());
    const allJoined=waitForRosterSize(clients[0],MAX_USERS_PER_ROOM);
    extras.forEach((c,i)=>c.emit("join-room",{roomId,username:`Extra${i}`}));
    const fullRoster=await allJoined;
    assert.equal(fullRoster.length,MAX_USERS_PER_ROOM);
    const overflow=await connectClient(); extras.push(overflow);
    const err=waitEvent(overflow,"app-error");
    overflow.emit("join-room",{roomId,username:"Overflow"});
    assert.match((await err).message,/room is full/i);
  } finally { extras.forEach(c=>c.close()); }
});

test("only host can change shared video and playlist data persists", async t => {
  const a=await connectClient(), b=await connectClient();
  t.after(()=>{a.close();b.close();});
  const roomId=`host-test-${Date.now()}`;
  const aState=waitEvent(a,"room-state");
  a.emit("join-room",{roomId,username:"Host"});
  await aState;
  const bState=waitEvent(b,"room-state");
  b.emit("join-room",{roomId,username:"Guest"});
  await bState;
  const error=waitEvent(b,"app-error");
  b.emit("set-video",{videoUrl:"https://example.com/video.mp4"});
  assert.match((await error).message,/only the host/i);
  const playlist=waitEvent(a,"playlist-updated");
  a.emit("playlist-add",{title:"Demo video",url:"https://example.com/video.mp4"});
  const items=await playlist;
  assert.equal(items.length,1);
  assert.equal(items[0].title,"Demo video");
});


test("room playlist data can be saved and reloaded", () => {
  const id=`persist-test-${Date.now()}`;
  rooms.set(id,{videoUrl:"https://example.com/movie.mp4",isPlaying:false,currentTime:12,updatedAt:Date.now(),hostId:null,users:new Map(),playlist:[{id:"p1",title:"Saved title",url:"https://example.com/movie.mp4",addedBy:"Tester"}],poll:{id:"poll1",question:"Next?",options:[{id:"0",label:"A",votes:2},{id:"1",label:"B",votes:1}],voters:{}}});
  saveRooms();
  rooms.delete(id);
  loadRooms();
  assert.equal(rooms.get(id).playlist[0].title,"Saved title");
  assert.equal(rooms.get(id).poll.options[0].votes,2);
  rooms.delete(id);
  saveRooms();
});
