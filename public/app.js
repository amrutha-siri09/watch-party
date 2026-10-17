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

let currentProvider = "file";
let youtubePlayer = null;
let youtubeApiReady = false;
let pendingYoutube = null;
const youtubeContainer = $("youtubePlayerWrap");
const removeVideoButton = $("removeVideo");
const youtubeControls = $("youtubeControls");

function getYoutubeId(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = u.pathname.split("/").filter(Boolean)[0] || "";
    else if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
      else if (/^\/(embed|shorts|live)\//.test(u.pathname)) id = u.pathname.split("/")[2] || "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
function isYoutubeUrl(value) { return Boolean(getYoutubeId(value)); }
function createYoutubePlayer(videoId, time = 0, shouldPlay = false) {
  pendingYoutube = { videoId, time, shouldPlay };
  if (!youtubeApiReady) return;
  if (!youtubePlayer) {
    youtubePlayer = new YT.Player("youtubePlayer", {
      width: "100%", height: "100%", videoId,
      playerVars: { playsinline: 1, controls: 0, rel: 0, enablejsapi: 1 },
      events: {
        onReady: (event) => {
          const pending = pendingYoutube;
          if (!pending) return;
          lastSyncAt = Date.now();
          if (pending.shouldPlay) event.target.loadVideoById({ videoId: pending.videoId, startSeconds: pending.time });
          else event.target.cueVideoById({ videoId: pending.videoId, startSeconds: pending.time });
          setTimeout(() => { lastSyncAt = 0; }, 1000);
        },
        onStateChange: (event) => {
          if (Date.now() - lastSyncAt < 900 || hostId !== socket.id) return;
          const state = event.data;
          if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED) {
            socket.emit("playback", { action: state === YT.PlayerState.PLAYING ? "play" : "pause", currentTime: event.target.getCurrentTime() || 0 });
          }
        },
        onError: () => toast("This YouTube video may not allow embedding. Try another video.")
      }
    });
  } else {
    lastSyncAt = Date.now();
    if (shouldPlay) youtubePlayer.loadVideoById({ videoId, startSeconds: time });
    else youtubePlayer.cueVideoById({ videoId, startSeconds: time });
    setTimeout(() => { lastSyncAt = 0; }, 1000);
  }
}
window.onYouTubeIframeAPIReady = function () {
  youtubeApiReady = true;
  if (pendingYoutube) createYoutubePlayer(pendingYoutube.videoId, pendingYoutube.time, pendingYoutube.shouldPlay);
};
const youtubeApiScript = document.createElement("script");
youtubeApiScript.src = "https://www.youtube.com/iframe_api";
youtubeApiScript.async = true;
document.head.appendChild(youtubeApiScript);
function getCurrentTime() {
  if (currentProvider === "youtube" && youtubePlayer && typeof youtubePlayer.getCurrentTime === "function") return youtubePlayer.getCurrentTime() || 0;
  return video.currentTime || 0;
}
function showVideo(url, time = 0, shouldPlay = false) {
  if (!url) {
    currentProvider = "file";
    video.hidden = true; stage.hidden = false; youtubeContainer.hidden = true; youtubeControls.hidden = true; removeVideoButton.hidden = true;
    video.removeAttribute("src"); video.load();
    if (youtubePlayer && typeof youtubePlayer.stopVideo === "function") youtubePlayer.stopVideo();
    $("syncStatus").textContent = "Waiting for a video";
    return;
  }
  if (!/^https?:\/\//i.test(url)) { toast("Please use a valid http(s) video URL."); return; }
  const youtubeId = getYoutubeId(url);
  if (youtubeId) {
    currentProvider = "youtube";
    video.pause(); video.hidden = true; video.removeAttribute("src"); video.load();
    stage.hidden = true; youtubeContainer.hidden = false; removeVideoButton.hidden = hostId !== socket.id;
    youtubeControls.hidden = hostId !== socket.id;
    createYoutubePlayer(youtubeId, time, shouldPlay);
    $("syncStatus").textContent = "YouTube video loaded";
    return;
  }
  currentProvider = "file";
  youtubeContainer.hidden = true; youtubeControls.hidden = true; removeVideoButton.hidden = hostId !== socket.id;
  if (youtubePlayer && typeof youtubePlayer.stopVideo === "function") youtubePlayer.stopVideo();
  const changed = video.src !== url;
  stage.hidden = true; video.hidden = false;
  if (changed) {
    video.src = url; video.load();
    video.addEventListener("loadedmetadata", function onLoaded() {
      video.removeEventListener("loadedmetadata", onLoaded);
      if (Number.isFinite(time)) video.currentTime = time;
      if (shouldPlay) video.play().catch(() => toast("Press play to allow playback in this browser."));
    });
  } else {
    try { video.currentTime = time; } catch {}
    if (shouldPlay) video.play().catch(() => {}); else video.pause();
  }
  $("syncStatus").textContent = "Video loaded";
}
$("videoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const videoUrl = $("videoUrl").value.trim();
  if (!videoUrl) return;
  if (!/^https?:\/\//i.test(videoUrl) || (!isYoutubeUrl(videoUrl) && !/\.(mp4|webm)(?:$|[?#])/i.test(videoUrl))) {
    toast("Use a YouTube link or a direct MP4/WebM link."); return;
  }
  socket.emit("set-video", { videoUrl });
});
removeVideoButton.addEventListener("click", () => {
  if (hostId !== socket.id) { toast("Only the host can remove the shared video."); return; }
  socket.emit("set-video", { videoUrl: "" });
});
socket.on("video-updated", ({ videoUrl, isPlaying, currentTime }) => {
  $("videoUrl").value = videoUrl || "";
  showVideo(videoUrl, currentTime || 0, !!isPlaying);
  removeVideoButton.hidden = !videoUrl || hostId !== socket.id;
  toast(videoUrl ? "Shared video updated for everyone." : "Video cleared.");
});
video.addEventListener("play", () => {
  if (currentProvider !== "file" || Date.now() - lastSyncAt < 800) return;
  socket.emit("playback", { action: "play", currentTime: video.currentTime });
});
video.addEventListener("pause", () => {
  if (currentProvider !== "file" || video.ended || Date.now() - lastSyncAt < 800) return;
  socket.emit("playback", { action: "pause", currentTime: video.currentTime });
});
video.addEventListener("seeked", () => {
  if (currentProvider !== "file" || Date.now() - lastSyncAt < 800) return;
  socket.emit("seek", { currentTime: video.currentTime });
});
function applySync(currentTime, shouldPlay, updatedAt = Date.now()) {
  const target = Math.max(0, currentTime + (shouldPlay ? Math.max(0, (Date.now() - updatedAt) / 1000) : 0));
  lastSyncAt = Date.now();
  if (currentProvider === "youtube" && youtubePlayer && typeof youtubePlayer.seekTo === "function") {
    youtubePlayer.seekTo(target, true);
    if (shouldPlay) youtubePlayer.playVideo(); else youtubePlayer.pauseVideo();
  } else if (!video.hidden && video.src) {
    const drift = target - video.currentTime;
    if (Math.abs(drift) > 1.25) { try { video.currentTime = target; } catch {} video.playbackRate = 1; }
    else if (Math.abs(drift) > 0.12 && shouldPlay) {
      video.playbackRate = drift > 0 ? 1.05 : 0.95;
      setTimeout(() => { video.playbackRate = 1; }, 1200);
    } else video.playbackRate = 1;
    if (shouldPlay) video.play().catch(() => toast("Press play to allow playback in this browser.")); else video.pause();
  }
  $("syncStatus").textContent = "Synced with room";
  setTimeout(() => { lastSyncAt = 0; }, 900);
}
socket.on("playback-updated", ({ action, currentTime, updatedAt }) => applySync(currentTime, action === "play", updatedAt));
socket.on("seek-updated", ({ currentTime }) => {
  lastSyncAt = Date.now();
  if (currentProvider === "youtube" && youtubePlayer && typeof youtubePlayer.seekTo === "function") youtubePlayer.seekTo(currentTime, true);
  else if (!video.hidden && video.src && Math.abs(video.currentTime - currentTime) > 0.12) { try { video.currentTime = currentTime; } catch {} }
  video.playbackRate = 1;
  $("syncStatus").textContent = "Synced with room";
  setTimeout(() => { lastSyncAt = 0; }, 900);
});
$("ytPlayPause").addEventListener("click", () => {
  if (hostId !== socket.id || !youtubePlayer) return;
  const state = youtubePlayer.getPlayerState();
  if (state === YT.PlayerState.PLAYING) youtubePlayer.pauseVideo(); else youtubePlayer.playVideo();
});
$("ytBack").addEventListener("click", () => {
  if (hostId !== socket.id || !youtubePlayer) return;
  const time = Math.max(0, getCurrentTime() - 10); youtubePlayer.seekTo(time, true); socket.emit("seek", { currentTime: time });
});
$("ytForward").addEventListener("click", () => {
  if (hostId !== socket.id || !youtubePlayer) return;
  const time = getCurrentTime() + 10; youtubePlayer.seekTo(time, true); socket.emit("seek", { currentTime: time });
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
  youtubeControls.hidden = currentProvider !== "youtube" || hostId !== socket.id;
  removeVideoButton.hidden = !room.videoUrl || hostId !== socket.id;
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
      toast("Title copied. Add a YouTube or direct video URL to finish the playlist item.");
      $("playlistTitle").scrollIntoView({behavior:"smooth",block:"center"});
    }));
  } catch { target.innerHTML = '<p class="empty-note">Could not load movies. Check that the server is running.</p>'; }
}
let movieSearchTimer;
$("movieSearch").addEventListener("input",()=>{clearTimeout(movieSearchTimer);movieSearchTimer=setTimeout(loadMovies,180);});
$("movieGenre").addEventListener("change",loadMovies);
$("movieSort").addEventListener("change",loadMovies);
loadMovies();
