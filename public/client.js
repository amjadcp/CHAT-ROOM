const socket = io();

// ==== Global State ====
let currentUserId = null;
let currentUserName = null;
let connectedUserId = null;
let localStream = null;
let pc = null;
let pendingCandidates = [];
let isLocalMicEnabled = false;
let userMicStates = {};

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
  socket.on("micStateChanged", handleMicStateChanged);

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
    socket.emit("micStateChanged", { userId: currentUserId, micOn: true });
    userMicStates[currentUserId] = true;
    updateMicStatusInList(currentUserId, true);
    updateLocalMicButton();

    // If peer connection exists, add audio track(s) and trigger renegotiation
    if (pc) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      // Renegotiate so remote receives our audio
      if (connectedUserId) {
        await maybeNegotiate();
      }
    }
  } catch (err) {
    alert("Microphone access denied or error: " + err.message);
    console.error("Mic error:", err);
  }
}

function disableLocalMicrophone() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());

    if (pc) {
      const senders = pc.getSenders();
      senders.forEach((sender) => {
        if (sender.track && sender.track.kind === "audio") {
          try {
            pc.removeTrack(sender);
          } catch (e) {
            // removeTrack might throw on some older implementations; ignore errors
            console.warn("removeTrack error:", e);
          }
        }
      });

      // Renegotiate to inform remote we stopped sending audio
      if (connectedUserId) {
        // don't await; allow UI to continue — onnegotiationneeded may also fire depending on browser
        maybeNegotiate().catch((e) => console.error("Reneg negotiation error:", e));
      }
    }

    localStream = null;
  }
  isLocalMicEnabled = false;
  socket.emit("micStateChanged", { userId: currentUserId, micOn: false });
  userMicStates[currentUserId] = false;
  updateMicStatusInList(currentUserId, false);
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

    // Status (engaged / available)
    const statusSpan = document.createElement("span");
    statusSpan.className = "status";
    statusSpan.textContent = u.engagedWith ? "Engaged" : "Available";
    if (u.engagedWith) li.classList.add("engaged");
    li.appendChild(statusSpan);

    // Mic status (ON/OFF)
    const micSpan = document.createElement("span");
    micSpan.className = "micStatus";

    const micOn = userMicStates[u._id] ?? false;
    if (u.engagedWith) {
      micSpan.textContent = micOn ? "🎤 Mic ON" : "🔇 Mic OFF";
      micSpan.classList.toggle("activeMic", micOn);
      micSpan.classList.toggle("inactiveMic", !micOn);
    } else {
      // If not engaged, hide mic info
      micSpan.textContent = "";
      micSpan.classList.remove("activeMic", "inactiveMic");
    }

    li.appendChild(micSpan);
    usersList.appendChild(li);
  });

  // Update current user's mic state display if desired
  updateMicStatusInList(currentUserId, userMicStates[currentUserId] ?? false);
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

function updateMicStatusInList(userId, micOn) {
  const li = usersList.querySelector(`li[data-userid='${userId}']`);
  if (!li) return;

  let micSpan = li.querySelector(".micStatus");
  if (!micSpan) {
    micSpan = document.createElement("span");
    micSpan.className = "micStatus";
    li.appendChild(micSpan);
  }

  // Update text and classes
  micSpan.textContent = micOn ? "🎤 Mic ON" : "🔇 Mic OFF";
  micSpan.classList.toggle("activeMic", micOn);
  micSpan.classList.toggle("inactiveMic", !micOn);
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

  // Determine who is polite based on user IDs (string comparison is okay as long as consistent)
  polite = currentUserId < engagedWith;
  console.log("Polite role:", polite);

  await startCall(engagedWith);
}

function handleConnectionReleased() {
  console.log("Connection released");
  cleanupConnection();
}

function handleMicStateChanged({ userId, micOn }) {
  console.log("Mic state changed:", userId, micOn);
  userMicStates[userId] = micOn;
  updateMicStatusInList(userId, micOn);
}

// ========================
// 🔹 WEBRTC CORE LOGIC
// ========================

// Helper: trigger a negotiation (createOffer -> setLocalDescription -> send)
async function maybeNegotiate() {
  if (!pc || !connectedUserId) return;

  // If we're already creating an offer, don't start another
  if (isMakingOffer) {
    console.log("Already making an offer; skipping maybeNegotiate");
    return;
  }

  try {
    console.log("maybeNegotiate: creating offer...");
    isMakingOffer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtcOffer", {
      targetUserId: connectedUserId,
      offer: pc.localDescription,
    });
  } catch (err) {
    console.error("Error in maybeNegotiate:", err);
  } finally {
    isMakingOffer = false;
  }
}

async function startCall(targetUserId) {
  console.log("Starting call with:", targetUserId);
  createPeerConnection();

  // Only the impolite peer creates initial offer (polite waits for incoming offer)
  if (!polite) {
    try {
      console.log("Creating initial offer (impolite peer)");
      isMakingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtcOffer", { targetUserId, offer: pc.localDescription });
    } catch (err) {
      console.error("Error creating offer:", err);
    } finally {
      isMakingOffer = false;
    }
  } else {
    console.log("Polite peer: waiting for offer");
  }
}

function createPeerConnection() {
  if (pc) return;

  pc = new RTCPeerConnection(iceServersConfig);

  // Add local tracks if microphone is enabled
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

  // Use onnegotiationneeded to follow perfect negotiation pattern and avoid races
  pc.onnegotiationneeded = async () => {
    console.log("onnegotiationneeded fired");
    // If polite and an offer collision occurs, polite will wait and handle via handleOffer
    if (isMakingOffer) {
      console.log("Already making an offer; skipping onnegotiationneeded");
      return;
    }

    try {
      isMakingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtcOffer", {
        targetUserId: connectedUserId,
        offer: pc.localDescription,
      });
    } catch (err) {
      console.error("Negotiationneeded error:", err);
    } finally {
      isMakingOffer = false;
    }
  };
}

function handleRemoteTrack(event) {
  console.log("Remote track received");
  // attach first stream
  remoteAudio.srcObject = event.streams[0];
}

async function handleNegotiationNeeded() {
  // not used; we use pc.onnegotiationneeded directly
}

// ICE state handling
function handleICEConnectionChange() {
  console.log("ICE connection state:", pc?.iceConnectionState);
  if (!pc) return;
  if (["failed", "disconnected", "closed"].includes(pc.iceConnectionState)) {
    cleanupConnection();
  }
}

// ========================
// 🔹 OFFER / ANSWER / ICE HANDLERS
// ========================

async function handleOffer({ fromUserId, offer }) {
  console.log("Received offer from:", fromUserId);

  // Offer collision detection
  const offerCollision = isMakingOffer || pc?.signalingState !== "stable";
  isIgnoringOffer = !polite && offerCollision;

  console.log("Offer collision:", offerCollision, "Ignoring:", isIgnoringOffer, "Polite:", polite);

  if (isIgnoringOffer) {
    console.log("Ignoring offer due to collision");
    return;
  }

  // If we don't have a connected user set, set it now
  if (!connectedUserId) {
    connectedUserId = fromUserId;
    disconnect.disabled = false;
    polite = currentUserId < fromUserId;
    console.log("Setting polite role from offer:", polite);
  }

  createPeerConnection();

  isSettingRemoteAnswerPending = true;

  try {
    // setRemoteDesc handles rollback if needed
    await setRemoteDesc(offer);

    // Create an answer to the incoming offer
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
    if (!pc) {
      console.warn("No peer connection while receiving answer");
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    // After setting remote, process any pending candidates
    await flushPendingCandidates();
  } catch (err) {
    console.error("Error setting answer:", err);
  } finally {
    isSettingRemoteAnswerPending = false;
  }
}

async function handleCandidate({ candidate }) {
  const iceCandidate = new RTCIceCandidate(candidate);
  try {
    // If pc and remoteDescription exist and ufrag matches, add immediately.
    if (pc && pc.remoteDescription && candidateMatchesSDP(iceCandidate)) {
      await pc.addIceCandidate(iceCandidate);
    } else {
      // otherwise queue until remote description is set
      pendingCandidates.push(iceCandidate);
    }
  } catch (err) {
    // Ignore Unknown ufrag errors (they'll be handled when SDPs are set)
    if (!err.message || !err.message.includes("Unknown ufrag")) {
      console.error("Error adding ICE candidate:", err);
    }
  }
}

function candidateMatchesSDP(candidate) {
  const sdp = pc?.remoteDescription?.sdp;
  if (!sdp) return false;
  const match = /a=ice-ufrag:(\S+)/.exec(sdp);
  if (!match) return false;
  const ufrag = match[1];
  // candidate.usernameFragment is the standardized property name for the candidate ufrag
  return candidate.usernameFragment === ufrag;
}

async function flushPendingCandidates() {
  if (!pc || !pc.remoteDescription) return;
  for (const cand of pendingCandidates) {
    try {
      await pc.addIceCandidate(cand);
    } catch (e) {
      console.error("Candidate add error while flushing:", e);
    }
  }
  pendingCandidates = [];
}

async function setRemoteDesc(desc) {
  try {
    // Only rollback if we're in have-local-offer and this is an offer
    if (desc.type === "offer" && pc.signalingState === "have-local-offer") {
      console.log("Rolling back local offer before setting remote offer");
      await pc.setLocalDescription({ type: "rollback" });
    }

    // Accept either plain object or RTCSessionDescription
    await pc.setRemoteDescription(new RTCSessionDescription(desc));
    console.log("Remote description set successfully, signaling state:", pc.signalingState);

    // After remote description set, flush queued ICE candidates
    await flushPendingCandidates();
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
    try {
      pc.close();
    } catch (e) {
      console.warn("Error closing pc:", e);
    }
    pc = null;
  }

  connectedUserId = null;
  disconnect.disabled = true;

  if (remoteAudio) {
    remoteAudio.srcObject = null;
  }

  // Stop and clear local stream (but keep mic UI state as-is)
  if (localStream) {
    try {
      localStream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      console.warn("Error stopping local tracks on cleanup:", e);
    }
    localStream = null;
  }

  // Reset negotiation flags to safe defaults
  isMakingOffer = false;
  isIgnoringOffer = false;
  isSettingRemoteAnswerPending = false;
  pendingCandidates = [];
  isLocalMicEnabled = false;
  updateLocalMicButton();
}
