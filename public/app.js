const socket = io();
const $ = (id) => document.getElementById(id);
let currentRoom = "movie-night";
let username = "Movie Fan";
let roomUsers = [];
let hostId = null;
let lastSyncAt = 0;
let toastTimer;

const video = $("videoPlayer");
const stage = $("videoStage");

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2400);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function formatTime(time) {
  return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function joinRoom() {
  username = $("username").value.trim() || "Guest";
  currentRoom = $("roomId").value.trim() || "movie-night";
  $("roomId").value = currentRoom;
  $("roomLabel").textContent = currentRoom.toUpperCase();
  $("chatMessages").innerHTML = "";
  socket.emit("join-room", { roomId: currentRoom, username });
  history.replaceState(null, "", `?room=${encodeURIComponent(currentRoom)}`);
  toast(`Joining ${currentRoom}…`);
}
socket.on("connect", () => { $("connectionStatus").textContent = "Connected"; $("connectionStatus").style.color = "#65e4b1"; });
socket.on("disconnect", () => { $("connectionStatus").textContent = "Reconnecting…"; $("connectionStatus").style.color = "#ffd17c"; });
$("joinRoom").addEventListener("click", joinRoom);
$("roomId").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
$("copyInvite").addEventListener("click", async () => {
  const link = `${location.origin}/?room=${encodeURIComponent(currentRoom)}`;
  try { await navigator.clipboard.writeText(link); toast("Invite link copied!"); }
  catch { prompt("Copy this invite link:", link); }
});

function showVideo(url, time = 0, shouldPlay = false) {
  if (!url) {
    video.hidden = true; stage.hidden = false; video.removeAttribute("src"); video.load();
    $("syncStatus").textContent = "Waiting for a video";
    return;
  }
  if (!/^https?:\/\//i.test(url)) { toast("Please use a valid http(s) video URL."); return; }
  const changed = video.src !== url;
  stage.hidden = true; video.hidden = false;
  if (changed) {
    video.src = url;
    video.load();
    video.addEventListener("loadedmetadata", function onLoaded() {
      video.removeEventListener("loadedmetadata", onLoaded);
      if (Number.isFinite(time)) video.currentTime = time;
      if (shouldPlay) video.play().catch(() => toast("Press play to allow playback in this browser."));
    });
  } else {
    try { video.currentTime = time; } catch {}
    if (shouldPlay) video.play().catch(() => {});
    else video.pause();
  }
  $("syncStatus").textContent = "Video loaded";
}
$("videoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const videoUrl = $("videoUrl").value.trim();
  if (!videoUrl) return;
  socket.emit("set-video", { videoUrl });
});
socket.on("video-updated", ({ videoUrl, isPlaying, currentTime }) => {
  $("videoUrl").value = videoUrl || "";
  showVideo(videoUrl, currentTime || 0, !!isPlaying);
  toast(videoUrl ? "Shared video updated for everyone." : "Video cleared.");
});
video.addEventListener("play", () => {
  if (Date.now() - lastSyncAt < 800) return;
  socket.emit("playback", { action: "play", currentTime: video.currentTime });
});
video.addEventListener("pause", () => {
  if (video.ended || Date.now() - lastSyncAt < 800) return;
  socket.emit("playback", { action: "pause", currentTime: video.currentTime });
});
video.addEventListener("seeked", () => {
  if (Date.now() - lastSyncAt < 800) return;
  socket.emit("seek", { currentTime: video.currentTime });
});
function applySync(currentTime, shouldPlay, updatedAt = Date.now()) {
  if (video.hidden || !video.src) return;
  const target = Math.max(0, currentTime + (shouldPlay ? Math.max(0, (Date.now() - updatedAt) / 1000) : 0));
  const drift = target - video.currentTime;
  lastSyncAt = Date.now();
  if (Math.abs(drift) > 1.25) {
    try { video.currentTime = target; } catch {}
    video.playbackRate = 1;
  } else if (Math.abs(drift) > 0.12 && shouldPlay) {
    video.playbackRate = drift > 0 ? 1.05 : 0.95;
    setTimeout(() => { video.playbackRate = 1; }, 1200);
  } else video.playbackRate = 1;
  if (shouldPlay) video.play().catch(() => toast("Press play to allow playback in this browser."));
  else video.pause();
  $("syncStatus").textContent = Math.abs(drift) > 1.25 ? "Correcting playback drift…" : "Synced with room";
  setTimeout(() => { lastSyncAt = 0; }, 900);
}
socket.on("playback-updated", ({ action, currentTime, updatedAt }) => applySync(currentTime, action === "play", updatedAt));
socket.on("seek-updated", ({ currentTime }) => {
  lastSyncAt = Date.now();
  if (!video.hidden && video.src && Math.abs(video.currentTime - currentTime) > 0.12) {
    try { video.currentTime = currentTime; } catch {}
  }
  video.playbackRate = 1;
  $("syncStatus").textContent = "Synced with room";
  setTimeout(() => { lastSyncAt = 0; }, 900);
});

function addChatMessage({ username: name, text, at }) {
  const el = document.createElement("div");
  el.className = "message";
  el.innerHTML = `<div class="message-head"><b>${escapeHtml(name)}</b><time>${formatTime(at || Date.now())}</time></div><p>${escapeHtml(text)}</p>`;
  $("chatMessages").appendChild(el);
  $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
}
function addSystemMessage({ text, at }) {
  const el = document.createElement("div");
  el.className = "message system";
  el.textContent = `${text} · ${formatTime(at || Date.now())}`;
  $("chatMessages").appendChild(el);
  $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
}
$("chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("chatInput").value.trim();
  if (text) socket.emit("chat-message", { text });
  $("chatInput").value = "";
});
socket.on("chat-message", addChatMessage);
socket.on("system-message", addSystemMessage);
socket.on("app-error", ({message}) => toast(message || "Something went wrong."));
socket.on("room-state", (room) => {
  hostId = room.hostId;
  renderPeople(room.users || []);
  renderPlaylist(room.playlist || []);
  renderPoll(room.poll);
  showVideo(room.videoUrl, room.currentTime || 0, !!room.isPlaying);
});

function renderPeople(users) {
  roomUsers = users || [];
  $("peopleCount").textContent = `${roomUsers.length} ${roomUsers.length === 1 ? "person" : "people"} here`;
  $("peopleBadge").textContent = roomUsers.length;
  $("avatarStack").innerHTML = roomUsers.slice(0, 5).map(u => `<span class="avatar" title="${escapeHtml(u.username)}">${escapeHtml(u.username.slice(0, 1).toUpperCase())}</span>`).join("");
  $("peopleList").innerHTML = roomUsers.map(u => `<div class="person-row"><span class="avatar">${escapeHtml(u.username.slice(0, 1).toUpperCase())}</span><span class="person-name">${escapeHtml(u.username)}${u.id === socket.id ? " (you)" : ""}</span>${u.id === hostId ? '<span class="host-tag">HOST</span>' : ""}</div>`).join("");
  $("transferHost").disabled = hostId !== socket.id || roomUsers.filter(u => u.id !== socket.id).length === 0;
  video.controls = hostId === socket.id;
}
socket.on("users-updated", renderPeople);
socket.on("host-updated", (id) => { hostId = id; renderPeople(roomUsers); });
$("transferHost").addEventListener("click", () => {
  const other = roomUsers.find(u => u.id !== socket.id);
  if (other) socket.emit("transfer-host", { userId: other.id });
});

document.querySelectorAll("[data-emoji]").forEach(btn => btn.addEventListener("click", () => socket.emit("reaction", { emoji: btn.dataset.emoji })));
socket.on("reaction", ({ emoji, username: name }) => {
  const feed = $("reactionFeed");
  const empty = feed.querySelector(".empty-note");
  if (empty) empty.remove();
  const chip = document.createElement("span");
  chip.className = "reaction-chip";
  chip.textContent = `${emoji} ${name}`;
  feed.prepend(chip);
  while (feed.children.length > 8) feed.lastElementChild.remove();
});

$("playlistForm").addEventListener("submit", (e) => {
  e.preventDefault();
  socket.emit("playlist-add", { title: $("playlistTitle").value, url: $("playlistUrl").value });
  $("playlistTitle").value = ""; $("playlistUrl").value = "";
});
function renderPlaylist(items) {
  $("playlistCount").textContent = items.length;
  const target = $("playlistItems");
  target.classList.toggle("empty-note", items.length === 0);
  if (!items.length) { target.textContent = "Your group's watchlist will appear here."; return; }
  target.innerHTML = items.map(item => `<div class="playlist-item"><span class="item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span><button data-playlist-id="${escapeHtml(item.id)}">Play</button></div>`).join("");
  target.querySelectorAll("[data-playlist-id]").forEach(btn => btn.addEventListener("click", () => socket.emit("playlist-play", { id: btn.dataset.playlistId })));
}
socket.on("playlist-updated", renderPlaylist);

$("pollForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const options = $("pollOptions").value.split(",").map(s => s.trim()).filter(Boolean);
  if (options.length < 2) { toast("Add at least two comma-separated options."); return; }
  socket.emit("create-poll", { question: $("pollQuestion").value, options });
  $("pollQuestion").value = ""; $("pollOptions").value = "";
});
function renderPoll(poll) {
  const area = $("pollArea");
  if (!poll) { area.textContent = "Make a quick group decision with a poll."; return; }
  area.innerHTML = `<b>${escapeHtml(poll.question)}</b>` + poll.options.map(option => `<button class="poll-option" data-option-id="${escapeHtml(option.id)}"><span>${escapeHtml(option.label)}</span><span>${option.votes} vote${option.votes === 1 ? "" : "s"}</span></button>`).join("");
  area.querySelectorAll("[data-option-id]").forEach(btn => btn.addEventListener("click", () => socket.emit("vote-poll", { optionId: btn.dataset.optionId })));
}
socket.on("poll-updated", renderPoll);

const params = new URLSearchParams(location.search);
$("roomId").value = params.get("room") || "movie-night";
joinRoom();


// Movie discovery: fuzzy title matching, genre filters and sorting.
async function loadMovies() {
  const target = $("movieResults");
  if (!target) return;
  const params = new URLSearchParams({q:$("movieSearch").value, genre:$("movieGenre").value, sort:$("movieSort").value});
  try {
    const response = await fetch(`/api/movies?${params}`);
    if (!response.ok) throw new Error("Catalogue request failed");
    const data = await response.json();
    const genre = $("movieGenre");
    if (!genre.dataset.ready) {
      genre.innerHTML = '<option>All</option>' + data.genres.map(g=>`<option>${escapeHtml(g)}</option>`).join("");
      genre.dataset.ready = "1";
    }
    target.classList.remove("empty-note");
    if (!data.movies.length) { target.innerHTML = '<p class="empty-note">No matches yet. Try a shorter title or another genre.</p>'; return; }
    target.innerHTML = data.movies.map(m => `<article class="movie-card"><div class="movie-info"><b>${escapeHtml(m.title)}</b><span>${escapeHtml(m.genre)} · ${m.year} · ★ ${m.rating}</span><p>${escapeHtml(m.description)}</p></div><button data-add-movie="${escapeHtml(m.id)}">Use title</button></article>`).join("");
    target.querySelectorAll("[data-add-movie]").forEach(btn => btn.addEventListener("click", () => {
      const movie = data.movies.find(m=>m.id===btn.dataset.addMovie);
      if (!movie) return;
      $("playlistTitle").value = movie.title;
      $("playlistTitle").focus();
      toast("Title copied. Add a direct video URL to finish the playlist item.");
      $("playlistTitle").scrollIntoView({behavior:"smooth",block:"center"});
    }));
  } catch { target.innerHTML = '<p class="empty-note">Could not load movies. Check that the server is running.</p>'; }
}
let movieSearchTimer;
$("movieSearch").addEventListener("input",()=>{clearTimeout(movieSearchTimer);movieSearchTimer=setTimeout(loadMovies,180);});
$("movieGenre").addEventListener("change",loadMovies);
$("movieSort").addEventListener("change",loadMovies);
loadMovies();
