const socket = io();

// ==== Global State ====
let currentUserId = null;
let currentUserName = null;
let localStream = null;
let peerConnections = {}; // Map of userId -> RTCPeerConnection
let pendingCandidates = {}; // Map of userId -> [candidates]
let isLocalMicEnabled = false;
let userMicStates = {};
let myRoom = new Set(); // Users in my room
let makingOffers = new Set(); // Track ongoing offers

// ==== UI Elements ====
const usersList = document.getElementById("usersList");
const userNameEl = document.getElementById("username");
const leaveRoomBtn = document.getElementById("leaveRoom");
const toggleLocalMicBtn = document.getElementById("toggleLocalMicBtn");
const myRoomEl = document.getElementById("myRoom");
const remoteAudioContainer = document.getElementById("remoteAudioContainer");

// ==== ICE Config ====
const iceServersConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

// ========================
// 🔹 INITIALIZATION
// ========================
function init() {
  socket.emit("join");
  setupSocketHandlers();
  setupUIHandlers();
  setupTouchSupport();
}

init();

// ========================
// 🔹 SOCKET HANDLERS
// ========================
function setupSocketHandlers() {
  socket.on("userCreated", handleUserCreated);
  socket.on("userListUpdate", renderUserList);
  socket.on("userAddedToRoom", handleUserAddedToRoom);
  socket.on("userRemovedFromRoom", handleUserRemovedFromRoom);
  socket.on("roomUpdated", handleRoomUpdated);
  socket.on("micStateChanged", handleMicStateChanged);

  socket.on("userBusy", handleUserBusy);
  socket.on("error", handleError);

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

  // Leave room
  leaveRoomBtn.addEventListener("click", () => {
    leaveRoom();
  });

  // Setup drop zone for the room
  setupDropZone();
}

function setupDropZone() {
  myRoomEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    myRoomEl.classList.add("dragover");
  });

  myRoomEl.addEventListener("dragleave", () => {
    myRoomEl.classList.remove("dragover");
  });

  myRoomEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    myRoomEl.classList.remove("dragover");
    
    const userId = e.dataTransfer.getData("userId");
    if (userId && userId !== currentUserId && !myRoom.has(userId)) {
      console.log("Dropping user into room:", userId);
      socket.emit("addUserToRoom", userId);
    }
  });
}

async function enableLocalMicrophone() {
  try {
    // Request audio with specific constraints
    localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    });
    
    console.log("Local stream acquired, tracks:", localStream.getTracks().length);
    localStream.getTracks().forEach(track => {
      console.log("Local track:", track.kind, "enabled:", track.enabled, "muted:", track.muted);
    });
    
    isLocalMicEnabled = true;
    socket.emit("micStateChanged", { userId: currentUserId, micOn: true });
    userMicStates[currentUserId] = true;
    updateLocalMicButton();

    console.log("Adding tracks to existing peer connections");

    // Add tracks to all existing peer connections
    for (const [userId, pc] of Object.entries(peerConnections)) {
      console.log("Adding local track to peer:", userId);
      localStream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, localStream);
        console.log("Track added to", userId, ":", track.kind, track.label);
      });
      
      // Trigger renegotiation if needed
      if (pc.signalingState === "stable") {
        console.log("Triggering renegotiation for:", userId);
        await createAndSendOffer(userId);
      }
    }
  } catch (err) {
    alert("Microphone access denied or error: " + err.message);
    console.error("Mic error:", err);
  }
}

async function createAndSendOffer(userId) {
  const pc = peerConnections[userId];
  if (!pc) return;
  
  try {
    const offer = await pc.createOffer({
      offerToReceiveAudio: true
    });
    await pc.setLocalDescription(offer);
    socket.emit("webrtcOffer", {
      targetUserId: userId,
      offer: pc.localDescription,
    });
    console.log("Renegotiation offer sent to:", userId);
  } catch (err) {
    console.error("Error creating renegotiation offer:", err);
  }
}

function showAudioUnblockPrompt() {
  if (document.getElementById("audioPrompt")) return;
  
  const prompt = document.createElement("div");
  prompt.id = "audioPrompt";
  prompt.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 10000;
    text-align: center;
  `;
  
  prompt.innerHTML = `
    <h3>Enable Audio</h3>
    <p>Click below to enable audio playback</p>
    <button id="enableAudioBtn" style="
      padding: 10px 20px;
      background: #4CAF50;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
    ">Enable Audio</button>
  `;
  
  document.body.appendChild(prompt);
  
  document.getElementById("enableAudioBtn").onclick = () => {
    // Try to play all audio elements
    document.querySelectorAll("audio").forEach(audio => {
      audio.play().catch(err => console.error("Failed to play:", err));
    });
    prompt.remove();
  };
}

function handleRemoteTrack(event, userId) {
  console.log("=== Remote track received from:", userId, "===");
  console.log("Streams:", event.streams.length);
  console.log("Track kind:", event.track.kind);
  console.log("Track enabled:", event.track.enabled);
  console.log("Track muted:", event.track.muted);
  console.log("Track readyState:", event.track.readyState);
  
  if (event.streams && event.streams[0]) {
    console.log("Stream tracks:", event.streams[0].getTracks().length);
    event.streams[0].getTracks().forEach(track => {
      console.log("Stream track:", track.kind, "enabled:", track.enabled, "muted:", track.muted);
    });
  }
  
  let audioEl = document.getElementById(`audio-${userId}`);
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.id = `audio-${userId}`;
    audioEl.autoplay = true;
    audioEl.playsInline = true; // Important for mobile
    audioEl.controls = true; // Keep controls for debugging
    audioEl.volume = 1.0;
    
    // Add to a visible container
    remoteAudioContainer.appendChild(audioEl);
    
    // Add label for debugging
    const label = document.createElement("div");
    label.textContent = `Audio from: ${userId.substring(0, 8)}...`;
    label.style.fontSize = "12px";
    label.style.color = "#666";
    remoteAudioContainer.appendChild(label);
    
    console.log("Created new audio element for:", userId);
  }
  
  if (event.streams && event.streams[0]) {
    audioEl.srcObject = event.streams[0];
    console.log("Set srcObject for audio element");
    
    // Try to play explicitly (helps with autoplay policies)
    audioEl.play()
      .then(() => {
        console.log("Audio playback started successfully for:", userId);
      })
      .catch(err => {
        console.error("Audio playback failed:", err);
        // Show user interaction prompt if autoplay blocked
        showAudioUnblockPrompt();
      });
      
    // Monitor audio element
    audioEl.onloadedmetadata = () => {
      console.log("Audio metadata loaded for:", userId);
    };
    
    audioEl.onplay = () => {
      console.log("Audio started playing for:", userId);
    };
    
    audioEl.onerror = (e) => {
      console.error("Audio element error for:", userId, e);
    };
  }
}


function disableLocalMicrophone() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());

    // Remove tracks from all peer connections
    for (const pc of Object.values(peerConnections)) {
      const senders = pc.getSenders();
      senders.forEach((sender) => {
        if (sender.track && sender.track.kind === "audio") {
          try {
            pc.removeTrack(sender);
          } catch (e) {
            console.warn("removeTrack error:", e);
          }
        }
      });
    }

    localStream = null;
  }
  isLocalMicEnabled = false;
  socket.emit("micStateChanged", { userId: currentUserId, micOn: false });
  userMicStates[currentUserId] = false;
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
    li.setAttribute("draggable", "true");
    li.className = "user-item";
    
    // Check if user is engaged (in someone's room)
    const isEngaged = u.inRoom !== null;
    if (isEngaged) {
      li.classList.add("engaged");
    }

    // User name
    const nameSpan = document.createElement("span");
    nameSpan.className = "user-name";
    nameSpan.textContent = u.name;
    li.appendChild(nameSpan);

    // Status
    const statusSpan = document.createElement("span");
    statusSpan.className = "status";
    statusSpan.textContent = isEngaged ? "(Engaged)" : "(Available)";
    li.appendChild(statusSpan);

    // Mic status
    const micSpan = document.createElement("span");
    micSpan.className = "micStatus";
    const micOn = userMicStates[u._id] ?? false;
    if (isEngaged) {
      micSpan.textContent = micOn ? "🎤" : "🔇";
    }
    li.appendChild(micSpan);

    // Desktop drag handlers
    li.addEventListener("dragstart", (e) => {
      if (isEngaged) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData("userId", u._id);
      li.classList.add("dragging");
    });

    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
    });

    // Mobile touch handlers
    if (!isEngaged) {
      let touchStartTime;
      
      li.addEventListener("touchstart", (e) => {
        touchStartTime = Date.now();
        li.dataset.touchStartTime = touchStartTime;
        
        // Start drag after a short delay
        setTimeout(() => {
          if (li.dataset.touchStartTime === touchStartTime.toString()) {
            handleTouchStart(e, u._id, li);
          }
        }, 200);
      });
      
      // Also support simple tap to add
      li.addEventListener("click", (e) => {
        if (!touchDragState.active && window.innerWidth <= 768) {
          console.log("Click/tap to add user:", u._id);
          socket.emit("addUserToRoom", u._id);
        }
      });
    }

    usersList.appendChild(li);
  });

  updateRoomDisplay();
}

function updateRoomDisplay() {
  myRoomEl.innerHTML = "<h3>My Room (Drop users here)</h3>";
  
  if (myRoom.size === 0) {
    const emptyMsg = document.createElement("p");
    emptyMsg.textContent = "Drag users here to start a group chat";
    emptyMsg.className = "empty-room-msg";
    myRoomEl.appendChild(emptyMsg);
  } else {
    myRoom.forEach((userId) => {
      const userDiv = document.createElement("div");
      userDiv.className = "room-user";
      userDiv.setAttribute("data-userid", userId);
      
      // Find user name from the user list or use stored info
      const userLi = document.querySelector(`li[data-userid="${userId}"]`);
      const userName = userLi ? userLi.querySelector("span").textContent : "User";
      
      userDiv.textContent = userName;
      
      const micOn = userMicStates[userId] ?? false;
      const micIcon = document.createElement("span");
      micIcon.textContent = micOn ? " 🎤" : " 🔇";
      userDiv.appendChild(micIcon);
      
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "✕";
      removeBtn.className = "remove-user-btn";
      removeBtn.onclick = () => removeUserFromRoom(userId);
      userDiv.appendChild(removeBtn);
      
      myRoomEl.appendChild(userDiv);
    });
  }
  
  // Update leave button state
  leaveRoomBtn.disabled = myRoom.size === 0;
}

function removeUserFromRoom(userId) {
  console.log("Removing user from room:", userId);
  socket.emit("removeUserFromRoom", userId);
}

function leaveRoom() {
  console.log("Leaving room");
  socket.emit("leaveRoom");
}

// ========================
// 🔹 SOCKET EVENT LOGIC
// ========================
function handleUserCreated(userId, name) {
  console.log("User created:", userId, name);
  currentUserId = userId;
  currentUserName = name;
}

async function handleUserAddedToRoom({ userId, initiator }) {
  console.log("User added to room:", userId, "Initiator:", initiator);
  myRoom.add(userId);
  updateRoomDisplay();
  
  // Create peer connection - initiator creates offer
  await createPeerConnectionForUser(userId, initiator);
}

function handleUserRemovedFromRoom({ userId }) {
  console.log("User removed from room:", userId);
  myRoom.delete(userId);
  closePeerConnection(userId);
  updateRoomDisplay();
  
  // Remove audio element for this user
  const audioEl = document.getElementById(`audio-${userId}`);
  if (audioEl) {
    audioEl.remove();
  }
}

function handleRoomUpdated({ users }) {
  console.log("Room updated with users:", users);
  
  // Update myRoom set
  const newRoomSet = new Set(users);
  
  // Remove users no longer in room
  for (const userId of myRoom) {
    if (!newRoomSet.has(userId)) {
      console.log("Removing user from room (room update):", userId);
      closePeerConnection(userId);
      const audioEl = document.getElementById(`audio-${userId}`);
      if (audioEl) audioEl.remove();
    }
  }
  
  // Add new users
  for (const userId of newRoomSet) {
    if (!myRoom.has(userId) && userId !== currentUserId) {
      console.log("Adding user to room (room update):", userId);
      myRoom.add(userId);
      // Don't initiate offer here, wait for userAddedToRoom event
    }
  }
  
  myRoom = newRoomSet;
  updateRoomDisplay();
}

function handleMicStateChanged({ userId, micOn }) {
  console.log("Mic state changed:", userId, micOn);
  userMicStates[userId] = micOn;
  updateRoomDisplay();
  
  // Update in user list if visible
  const li = usersList.querySelector(`li[data-userid='${userId}']`);
  if (li) {
    const micSpan = li.querySelector(".micStatus");
    if (micSpan) {
      micSpan.textContent = micOn ? " 🎤" : " 🔇";
    }
  }
}

// ========================
// 🔹 WEBRTC CORE LOGIC
// ========================

async function createPeerConnectionForUser(userId, shouldOffer) {
  if (peerConnections[userId]) {
    console.log("Peer connection already exists for:", userId);
    return;
  }

  console.log("=== Creating peer connection for:", userId, "shouldOffer:", shouldOffer, "===");
  
  const pc = new RTCPeerConnection(iceServersConfig);
  peerConnections[userId] = pc;
  pendingCandidates[userId] = [];

  // Add local tracks if microphone is enabled
  if (localStream && isLocalMicEnabled) {
    console.log("Adding local stream tracks to new peer connection");
    localStream.getTracks().forEach((track) => {
      const sender = pc.addTrack(track, localStream);
      console.log("Added track:", track.kind, "label:", track.label, "enabled:", track.enabled);
    });
  } else {
    console.log("No local stream available or mic disabled");
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      console.log("Sending ICE candidate to:", userId, "type:", candidate.type);
      socket.emit("webrtcCandidate", {
        targetUserId: userId,
        candidate,
      });
    } else {
      console.log("ICE gathering complete for:", userId);
    }
  };

  pc.ontrack = (event) => {
    console.log("=== ontrack fired for:", userId, "===");
    handleRemoteTrack(event, userId);
  };
  
  pc.oniceconnectionstatechange = () => {
    console.log(`ICE connection state for ${userId}:`, pc.iceConnectionState);
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      console.log("✅ ICE connection established with:", userId);
    }
    if (["failed", "disconnected", "closed"].includes(pc.iceConnectionState)) {
      console.log("❌ ICE connection failed/disconnected for:", userId);
      closePeerConnection(userId);
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection state for ${userId}:`, pc.connectionState);
    if (pc.connectionState === "connected") {
      console.log("✅ Peer connection established with:", userId);
    }
  };
  
  pc.onsignalingstatechange = () => {
    console.log(`Signaling state for ${userId}:`, pc.signalingState);
  };

  // Only initiator creates the offer
  if (shouldOffer) {
    console.log("Creating and sending initial offer to:", userId);
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      
      console.log("Offer created, setting local description");
      await pc.setLocalDescription(offer);
      
      console.log("Sending offer to:", userId);
      socket.emit("webrtcOffer", {
        targetUserId: userId,
        offer: pc.localDescription,
      });
    } catch (err) {
      console.error("Error creating initial offer:", err);
    }
  } else {
    console.log("Waiting for offer from:", userId);
  }
}

function handleRemoteTrack(event, userId) {
  console.log("Remote track received from:", userId, "streams:", event.streams.length);
  
  let audioEl = document.getElementById(`audio-${userId}`);
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.id = `audio-${userId}`;
    audioEl.autoplay = true;
    audioEl.controls = true; // Add controls for debugging
    remoteAudioContainer.appendChild(audioEl);
    console.log("Created new audio element for:", userId);
  }
  
  if (event.streams && event.streams[0]) {
    audioEl.srcObject = event.streams[0];
    console.log("Set srcObject for audio element, tracks:", event.streams[0].getTracks().length);
  }
}

function closePeerConnection(userId) {
  const pc = peerConnections[userId];
  if (pc) {
    console.log("Closing peer connection for:", userId);
    try {
      pc.close();
    } catch (e) {
      console.warn("Error closing peer connection:", e);
    }
    delete peerConnections[userId];
  }
  delete pendingCandidates[userId];
}

// ========================
// 🔹 OFFER / ANSWER / ICE HANDLERS
// ========================

async function handleOffer({ fromUserId, offer }) {
  console.log("=== Received offer from:", fromUserId, "===");
  console.log("Offer type:", offer.type);
  
  // Create peer connection if it doesn't exist
  if (!peerConnections[fromUserId]) {
    console.log("Creating peer connection for incoming offer");
    await createPeerConnectionForUser(fromUserId, false);
  }
  
  const pc = peerConnections[fromUserId];
  if (!pc) {
    console.error("No peer connection for:", fromUserId);
    return;
  }

  try {
    console.log("Current signaling state:", pc.signalingState);
    console.log("Setting remote description (offer)");
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log("Remote description set successfully");
    
    console.log("Creating answer");
    const answer = await pc.createAnswer();
    console.log("Answer created, setting local description");
    await pc.setLocalDescription(answer);
    
    console.log("Sending answer to:", fromUserId);
    socket.emit("webrtcAnswer", {
      targetUserId: fromUserId,
      answer: pc.localDescription,
    });
    
    // Process pending candidates
    await processPendingCandidates(fromUserId);
  } catch (err) {
    console.error("Error handling offer:", err);
  }
}

async function handleAnswer({ fromUserId, answer }) {
  console.log("=== Received answer from:", fromUserId, "===");
  console.log("Answer type:", answer.type);
  
  const pc = peerConnections[fromUserId];
  if (!pc) {
    console.warn("No peer connection for answer from:", fromUserId);
    return;
  }

  try {
    console.log("Current signaling state:", pc.signalingState);
    console.log("Setting remote description (answer)");
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log("Remote description (answer) set successfully");
    
    // Process pending candidates
    await processPendingCandidates(fromUserId);
  } catch (err) {
    console.error("Error setting answer:", err);
  }
}

async function handleCandidate({ fromUserId, candidate }) {
  console.log("Received ICE candidate from:", fromUserId);
  
  const pc = peerConnections[fromUserId];
  if (!pc) {
    console.warn("No peer connection for candidate from:", fromUserId);
    return;
  }

  const iceCandidate = new RTCIceCandidate(candidate);
  
  try {
    if (pc.remoteDescription && pc.remoteDescription.type) {
      console.log("Adding ICE candidate immediately");
      await pc.addIceCandidate(iceCandidate);
    } else {
      console.log("Queueing ICE candidate (no remote description yet)");
      if (!pendingCandidates[fromUserId]) {
        pendingCandidates[fromUserId] = [];
      }
      pendingCandidates[fromUserId].push(iceCandidate);
    }
  } catch (err) {
    console.error("Error adding ICE candidate:", err);
  }
}

async function processPendingCandidates(userId) {
  const pc = peerConnections[userId];
  const candidates = pendingCandidates[userId] || [];
  
  if (candidates.length > 0) {
    console.log(`Processing ${candidates.length} pending candidates for:`, userId);
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error("Error adding pending candidate:", err);
      }
    }
    pendingCandidates[userId] = [];
  }
}

function handleUserBusy({ userId, message }) {
  console.log("User is busy:", userId, message);
  
  // Show a notification to the user
  showNotification(message, "warning");
}

function handleError({ message }) {
  console.error("Server error:", message);
  showNotification(message, "error");
}

function showNotification(message, type = "info") {
  // Remove existing notification if any
  const existing = document.getElementById("notification");
  if (existing) {
    existing.remove();
  }
  
  const notification = document.createElement("div");
  notification.id = "notification";
  notification.textContent = message;
  
  // Style based on type
  const colors = {
    info: "#2196F3",
    warning: "#ff9800",
    error: "#f44336",
    success: "#4CAF50"
  };
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${colors[type] || colors.info};
    color: white;
    padding: 15px 20px;
    border-radius: 5px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  
  document.body.appendChild(notification);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease-out";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}


// ========================
// 🔹 CLEANUP
// ========================

function cleanupAllConnections() {
  console.log("Cleaning up all connections");
  
  for (const userId of Object.keys(peerConnections)) {
    closePeerConnection(userId);
  }
  
  myRoom.clear();
  updateRoomDisplay();
  
  // Remove all remote audio elements
  remoteAudioContainer.innerHTML = "";
  
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    isLocalMicEnabled = false;
    updateLocalMicButton();
  }
}

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  cleanupAllConnections();
  socket.emit("leaveRoom");
});

// ========================
// 🔹 TOUCH SUPPORT FOR MOBILE
// ========================
let touchDragState = {
  active: false,
  userId: null,
  element: null,
  clone: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0
};

function setupTouchSupport() {
  const touchIndicator = document.getElementById('touchIndicator');
  
  // Touch event handlers will be added per user item
  document.addEventListener('touchmove', handleTouchMove, { passive: false });
  document.addEventListener('touchend', handleTouchEnd);
  document.addEventListener('touchcancel', handleTouchEnd);
}

function handleTouchStart(e, userId, element) {
  // Check if user is engaged
  if (element.classList.contains('engaged')) {
    return;
  }
  
  e.preventDefault();
  
  const touch = e.touches[0];
  
  touchDragState = {
    active: true,
    userId: userId,
    element: element,
    clone: null,
    startX: touch.clientX,
    startY: touch.clientY,
    currentX: touch.clientX,
    currentY: touch.clientY
  };
  
  // Create a clone for dragging
  const clone = element.cloneNode(true);
  clone.classList.add('touch-dragging');
  clone.style.width = element.offsetWidth + 'px';
  clone.style.left = touch.clientX - (element.offsetWidth / 2) + 'px';
  clone.style.top = touch.clientY - 20 + 'px';
  document.body.appendChild(clone);
  
  touchDragState.clone = clone;
  
  // Add visual feedback to original
  element.style.opacity = '0.3';
  
  // Show touch indicator
  const indicator = document.getElementById('touchIndicator');
  indicator.classList.add('active');
  indicator.style.left = touch.clientX + 'px';
  indicator.style.top = touch.clientY + 'px';
}

function handleTouchMove(e) {
  if (!touchDragState.active) return;
  
  e.preventDefault();
  
  const touch = e.touches[0];
  touchDragState.currentX = touch.clientX;
  touchDragState.currentY = touch.clientY;
  
  // Move the clone
  if (touchDragState.clone) {
    touchDragState.clone.style.left = touch.clientX - (touchDragState.clone.offsetWidth / 2) + 'px';
    touchDragState.clone.style.top = touch.clientY - 20 + 'px';
  }
  
  // Update touch indicator
  const indicator = document.getElementById('touchIndicator');
  indicator.style.left = touch.clientX + 'px';
  indicator.style.top = touch.clientY + 'px';
  
  // Check if over drop zone
  const dropZone = myRoomEl;
  const rect = dropZone.getBoundingClientRect();
  
  if (touch.clientX >= rect.left && 
      touch.clientX <= rect.right && 
      touch.clientY >= rect.top && 
      touch.clientY <= rect.bottom) {
    dropZone.classList.add('touch-dragover');
  } else {
    dropZone.classList.remove('touch-dragover');
  }
}

function handleTouchEnd(e) {
  if (!touchDragState.active) return;
  
  const touch = e.changedTouches[0];
  
  // Check if dropped in the room area
  const dropZone = myRoomEl;
  const rect = dropZone.getBoundingClientRect();
  
  if (touch.clientX >= rect.left && 
      touch.clientX <= rect.right && 
      touch.clientY >= rect.top && 
      touch.clientY <= rect.bottom) {
    
    const userId = touchDragState.userId;
    if (userId && userId !== currentUserId && !myRoom.has(userId)) {
      console.log("Touch dropping user into room:", userId);
      socket.emit("addUserToRoom", userId);
    }
  }
  
  // Cleanup
  if (touchDragState.clone) {
    touchDragState.clone.remove();
  }
  
  if (touchDragState.element) {
    touchDragState.element.style.opacity = '';
  }
  
  dropZone.classList.remove('touch-dragover');
  
  // Hide touch indicator
  const indicator = document.getElementById('touchIndicator');
  indicator.classList.remove('active');
  
  touchDragState = {
    active: false,
    userId: null,
    element: null,
    clone: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0
  };
}

// Alternative: Tap to add (simpler mobile interaction)
function handleUserTap(e, userId, element) {
  if (element.classList.contains('engaged')) {
    return;
  }
  
  // Prevent if we're dragging
  if (touchDragState.active) {
    return;
  }
  
  // Check if this is a tap (not a drag)
  const timeSinceStart = Date.now() - element.dataset.touchStartTime;
  if (timeSinceStart < 300) { // 300ms threshold for tap
    console.log("Tapping user to add to room:", userId);
    socket.emit("addUserToRoom", userId);
    
    // Visual feedback
    element.style.transform = 'scale(0.95)';
    setTimeout(() => {
      element.style.transform = '';
    }, 200);
  }
}