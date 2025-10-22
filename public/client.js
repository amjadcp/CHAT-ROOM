const socket = io();

// ==== Global State ====
let currentUserId = localStorage.getItem("userId");
let currentUserName = localStorage.getItem("userName");
let connectedUserId = null;
let localStream = null;
let pc = null;
let pendingCandidates = [];

// ==== UI Elements ====
const usersList = document.getElementById("usersList");
const userNameEl = document.getElementById("username");
const releaseMicBtn = document.getElementById("releaseMicBtn");
const remoteAudio = document.getElementById("remoteAudio");

// ==== ICE Config ====
const iceServersConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

// ==== Flags for negotiation ====
const polite = true;
let isMakingOffer = false;
let isIgnoringOffer = false;

// ========================
// 🔹 INITIALIZATION
// ========================
function init() {
  if (currentUserId) {
    socket.emit("rejoin", currentUserId);
  } else {
    socket.emit("join");
  }

  setupSocketHandlers();
  setupUIHandlers();
}

init();

// ========================
// 🔹 SOCKET HANDLERS
// ========================
function setupSocketHandlers() {
  socket.on("userCreated", handleUserCreated);
  socket.on("userListUpdate", renderUserList);
  socket.on("micToggled", handleMicToggled);
  socket.on("micReleased", handleMicReleased);

  socket.on("webrtcOffer", handleOffer);
  socket.on("webrtcAnswer", handleAnswer);
  socket.on("webrtcCandidate", handleCandidate);
}

// ========================
// 🔹 UI HANDLERS
// ========================
function setupUIHandlers() {
  releaseMicBtn.addEventListener("click", () => {
    if (connectedUserId) {
      socket.emit("releaseMic");
      cleanupConnection();
    }
  });
}

function renderUserList(users) {
  userNameEl.innerText = `Welcome, ${currentUserName}`;
  usersList.innerHTML = "";

  users.forEach((u) => {
    const li = document.createElement("li");
    li.setAttribute("data-userid", u._id);
    li.textContent = `${u.name} `;

    const micBtn = createMicButton(u);
    li.appendChild(micBtn);

    const statusSpan = document.createElement("span");
    statusSpan.className = "status";
    statusSpan.textContent = u.engagedWith ? "Engaged" : "Available";
    if (u.engagedWith) li.classList.add("engaged");
    li.appendChild(statusSpan);

    usersList.appendChild(li);
  });
}

function createMicButton(user) {
  const btn = document.createElement("button");
  btn.textContent = "🎤";
  btn.className = "micBtn";

  btn.disabled =
    !!connectedUserId ||
    user.engagedWith !== null ||
    user._id === currentUserId;
  btn.onclick = () => {
    if (connectedUserId) return alert("Already engaged in a conversation.");
    if (user.engagedWith) return alert("User is engaged.");
    if (user._id === currentUserId) return alert("Cannot talk to yourself.");

    socket.emit("toggleMic", user._id);
  };

  return btn;
}

// ========================
// 🔹 SOCKET EVENT LOGIC
// ========================
function handleUserCreated(userId, name) {
  localStorage.setItem("userId", userId);
  localStorage.setItem("userName", name);
  currentUserId = userId;
  currentUserName = name;
}

async function handleMicToggled({ engagedWith }) {
  connectedUserId = engagedWith;
  releaseMicBtn.disabled = false;
  await startCall(engagedWith);
}

function handleMicReleased() {
  cleanupConnection();
}

// ========================
// 🔹 WEBRTC CORE LOGIC
// ========================

async function startCall(targetUserId) {
  await ensureLocalStream();
  createPeerConnection();

  try {
    isMakingOffer = true;
    await pc.setLocalDescription(await pc.createOffer());
    socket.emit("webrtcOffer", { targetUserId, offer: pc.localDescription });
  } catch (err) {
    console.error("Error creating offer:", err);
  } finally {
    isMakingOffer = false;
  }
}

async function ensureLocalStream() {
  if (localStream) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert("Microphone access denied or error.");
  }
}

function createPeerConnection() {
  if (pc) return;

  pc = new RTCPeerConnection(iceServersConfig);

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit("webrtcCandidate", {
        targetUserId: connectedUserId,
        candidate,
      });
    }
  };

  pc.ontrack = handleRemoteTrack;
  pc.oniceconnectionstatechange = handleICEConnectionChange;
  pc.onnegotiationneeded = handleNegotiationNeeded;
}

function handleRemoteTrack(event) {
  remoteAudio.srcObject = event.streams[0];
}

async function handleNegotiationNeeded() {
  try {
    isMakingOffer = true;
    await pc.setLocalDescription(await pc.createOffer());
    if (pc.signalingState === "stable") {
      socket.emit("webrtcOffer", {
        targetUserId: connectedUserId,
        offer: pc.localDescription,
      });
    }
  } catch (err) {
    console.error("Negotiation error:", err);
  } finally {
    isMakingOffer = false;
  }
}

function handleICEConnectionChange() {
  if (["failed", "disconnected"].includes(pc.iceConnectionState)) {
    cleanupConnection();
  }
}

// ========================
// 🔹 OFFER / ANSWER / ICE HANDLERS
// ========================

async function handleOffer({ fromUserId, offer }) {
  const offerCollision = isMakingOffer || pc?.signalingState !== "stable";
  isIgnoringOffer = !polite && offerCollision;
  if (isIgnoringOffer) return;

  connectedUserId = fromUserId;

  await ensureLocalStream();
  createPeerConnection();

  try {
    await setRemoteDesc(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("webrtcAnswer", {
      targetUserId: fromUserId,
      answer: pc.localDescription,
    });
  } catch (err) {
    console.error("Error handling offer:", err);
  }
}

async function handleAnswer({ answer }) {
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (err) {
    console.error("Error setting answer:", err);
  }
}

async function handleCandidate({ candidate }) {
  const iceCandidate = new RTCIceCandidate(candidate);
  try {
    if (pc && pc.remoteDescription && candidateMatchesSDP(iceCandidate)) {
      await pc.addIceCandidate(iceCandidate);
    } else {
      pendingCandidates.push(iceCandidate);
    }
  } catch (err) {
    if (!err.message.includes("Unknown ufrag")) {
      console.error("Error adding ICE candidate:", err);
    }
  }
}

function candidateMatchesSDP(candidate) {
  const sdp = pc.remoteDescription?.sdp;
  if (!sdp) return false;
  const match = /a=ice-ufrag:(\S+)/.exec(sdp);
  if (!match) return false;
  const ufrag = match[1];
  return candidate.usernameFragment === ufrag;
}

async function setRemoteDesc(desc) {
  try {
    if (desc.type === "offer" && pc.signalingState !== "stable") {
      await pc.setRemoteDescription({ type: "rollback" });
    }
    await pc.setRemoteDescription(desc);
    for (const candidate of pendingCandidates) {
      await pc
        .addIceCandidate(candidate)
        .catch((e) => console.error("Candidate error:", e));
    }
    pendingCandidates = [];
  } catch (err) {
    console.error("Failed setting remote description:", err);
  }
}

// ========================
// 🔹 CLEANUP
// ========================

function cleanupConnection() {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  connectedUserId = null;
  releaseMicBtn.disabled = true;

  if (remoteAudio) {
    remoteAudio.srcObject = null;
    remoteAudio.remove();
  }
}
