const socket = io();

// ==== Global State ====
let currentUserId = null;
let currentUserName = null;
let connectedUserId = null;
let localStream = null;
let pc = null;
let pendingCandidates = [];
let isLocalMicEnabled = false;

// ==== UI Elements ====
const usersList = document.getElementById("usersList");
const userNameEl = document.getElementById("username");
const disconnect = document.getElementById("disconnect");
const toggleLocalMicBtn = document.getElementById("toggleLocalMicBtn");
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
let polite = false;
let isMakingOffer = false;
let isIgnoringOffer = false;
let isSettingRemoteAnswerPending = false;

// ========================
// 🔹 INITIALIZATION
// ========================
function init() {
  socket.emit("join");
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
  socket.on("micToggled", handleConnectionRequested);
  socket.on("micReleased", handleConnectionReleased);

  socket.on("webrtcOffer", handleOffer);
  socket.on("webrtcAnswer", handleAnswer);
  socket.on("webrtcCandidate", handleCandidate);
}

// ========================
// 🔹 UI HANDLERS
// ========================
function setupUIHandlers() {
  // Toggle local microphone
  toggleLocalMicBtn.addEventListener("click", async () => {
    if (!isLocalMicEnabled) {
      await enableLocalMicrophone();
    } else {
      disableLocalMicrophone();
    }
  });

  // Release/disconnect from current conversation
  disconnect.addEventListener("click", () => {
    if (connectedUserId) {
      socket.emit("releaseMic");
      cleanupConnection();
    }
  });
}

async function enableLocalMicrophone() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    isLocalMicEnabled = true;
    updateLocalMicButton();
    
    // If already in a call, add the track to existing peer connection
    if (pc && connectedUserId) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }
  } catch (err) {
    alert("Microphone access denied or error: " + err.message);
    console.error("Mic error:", err);
  }
}

function disableLocalMicrophone() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    
    // Remove tracks from peer connection if active
    if (pc) {
      const senders = pc.getSenders();
      senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
          pc.removeTrack(sender);
        }
      });
    }
    
    localStream = null;
  }
  isLocalMicEnabled = false;
  updateLocalMicButton();
}

function updateLocalMicButton() {
  if (isLocalMicEnabled) {
    toggleLocalMicBtn.textContent = "🎤 Mute";
    toggleLocalMicBtn.classList.add("active");
  } else {
    toggleLocalMicBtn.textContent = "🎤 Unmute";
    toggleLocalMicBtn.classList.remove("active");
  }
}

function renderUserList(users) {
  userNameEl.innerText = `Welcome, ${currentUserName}`;
  usersList.innerHTML = "";

  users.forEach((u) => {
    // Skip rendering current user
    if (u._id === currentUserId) return;

    const li = document.createElement("li");
    li.setAttribute("data-userid", u._id);
    li.textContent = `${u.name} `;

    const connectBtn = createConnectButton(u);
    li.appendChild(connectBtn);

    const statusSpan = document.createElement("span");
    statusSpan.className = "status";
    statusSpan.textContent = u.engagedWith ? "Engaged" : "Available";
    if (u.engagedWith) li.classList.add("engaged");
    li.appendChild(statusSpan);

    usersList.appendChild(li);
  });
}

function createConnectButton(user) {
  const btn = document.createElement("button");
  btn.textContent = "Connect";
  btn.className = "connectBtn";

  btn.disabled = !!connectedUserId || user.engagedWith !== null;
  
  btn.onclick = () => {
    console.log("Connect button clicked for user:", user._id);
    
    if (connectedUserId) {
      alert("Already engaged in a conversation.");
      return;
    }
    if (user.engagedWith) {
      alert("User is engaged.");
      return;
    }

    console.log("Emitting toggleMic to:", user._id);
    socket.emit("toggleMic", user._id);
  };

  return btn;
}

// ========================
// 🔹 SOCKET EVENT LOGIC
// ========================
function handleUserCreated(userId, name) {
  console.log("User created:", userId, name);
  currentUserId = userId;
  currentUserName = name;
}

async function handleConnectionRequested({ engagedWith }) {
  console.log("Connection requested with:", engagedWith);
  connectedUserId = engagedWith;
  disconnect.disabled = false;
  
  // Determine who is polite based on user IDs
  polite = currentUserId < engagedWith;
  console.log("Polite role:", polite);
  
  await startCall(engagedWith);
}

function handleConnectionReleased() {
  console.log("Connection released");
  cleanupConnection();
}

// ========================
// 🔹 WEBRTC CORE LOGIC
// ========================

async function startCall(targetUserId) {
  console.log("Starting call with:", targetUserId);
  createPeerConnection();

  // Only the impolite peer creates initial offer
  if (!polite) {
    try {
      console.log("Creating initial offer (impolite peer)");
      isMakingOffer = true;
      await pc.setLocalDescription();
      socket.emit("webrtcOffer", { targetUserId, offer: pc.localDescription });
    } catch (err) {
      console.error("Error creating offer:", err);
    } finally {
      isMakingOffer = false;
    }
  } else {
    console.log("Waiting for offer (polite peer)");
  }
}

function createPeerConnection() {
  if (pc) return;

  pc = new RTCPeerConnection(iceServersConfig);

  // Only add local tracks if microphone is enabled
  if (localStream && isLocalMicEnabled) {
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
  console.log("Remote track received");
  remoteAudio.srcObject = event.streams[0];
}

async function handleNegotiationNeeded() {
  try {
    console.log("Negotiation needed, making offer");
    isMakingOffer = true;
    await pc.setLocalDescription();
    socket.emit("webrtcOffer", {
      targetUserId: connectedUserId,
      offer: pc.localDescription,
    });
  } catch (err) {
    console.error("Negotiation error:", err);
  } finally {
    isMakingOffer = false;
  }
}

function handleICEConnectionChange() {
  console.log("ICE connection state:", pc.iceConnectionState);
  if (["failed", "disconnected"].includes(pc.iceConnectionState)) {
    cleanupConnection();
  }
}

// ========================
// 🔹 OFFER / ANSWER / ICE HANDLERS
// ========================

async function handleOffer({ fromUserId, offer }) {
  console.log("Received offer from:", fromUserId);
  
  const offerCollision = isMakingOffer || pc?.signalingState !== "stable";
  isIgnoringOffer = !polite && offerCollision;
  
  console.log("Offer collision:", offerCollision, "Ignoring:", isIgnoringOffer, "Polite:", polite);
  
  if (isIgnoringOffer) {
    console.log("Ignoring offer due to collision");
    return;
  }

  if (!connectedUserId) {
    connectedUserId = fromUserId;
    disconnect.disabled = false;
    polite = currentUserId < fromUserId;
    console.log("Setting polite role from offer:", polite);
  }

  createPeerConnection();
  
  isSettingRemoteAnswerPending = true;

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
  } finally {
    isSettingRemoteAnswerPending = false;
  }
}

async function handleAnswer({ answer }) {
  console.log("Received answer");
  try {
    isSettingRemoteAnswerPending = true;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (err) {
    console.error("Error setting answer:", err);
  } finally {
    isSettingRemoteAnswerPending = false;
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
    // Only rollback if we're in have-local-offer and this is an offer
    if (desc.type === "offer" && pc.signalingState === "have-local-offer") {
      console.log("Rolling back local offer");
      await pc.setLocalDescription({ type: "rollback" });
    }
    
    await pc.setRemoteDescription(desc);
    console.log("Remote description set successfully, signaling state:", pc.signalingState);
    
    // Process pending candidates
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
  console.log("Cleaning up connection");
  if (pc) {
    pc.close();
    pc = null;
  }
  
  connectedUserId = null;
  disconnect.disabled = true;

  if (remoteAudio) {
    remoteAudio.srcObject = null;
  }
}