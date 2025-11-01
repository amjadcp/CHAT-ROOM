// ============================================================================
// SOCKET.IO CONNECTION
// ============================================================================
// Socket.io connects this client to the signaling server
// In WebRTC, signaling is used to exchange connection information between peers
const socket = io();

// ============================================================================
// GLOBAL STATE MANAGEMENT
// ============================================================================
/**
 * WebRTC requires tracking multiple states:
 * - User identity and room membership
 * - Media streams (local microphone)
 * - Peer connections (one per remote user)
 * - ICE candidates (for NAT traversal)
 */

// User Identity
let currentUserId = null;      // This user's unique ID from server
let currentUserName = null;    // This user's display name

// Media State
let localStream = null;        // MediaStream from getUserMedia (local microphone)
let isLocalMicEnabled = false; // Whether local mic is currently active

// WebRTC Core State
let peerConnections = {};      // Map: userId -> RTCPeerConnection
                               // Each remote user needs their own peer connection
                               
let pendingCandidates = {};    // Map: userId -> [ICE candidates]
                               // ICE candidates may arrive before remote description is set
                               // They must be queued and applied later

// Room State
let myRoom = new Set();        // Set of userIds currently in voice chat with me
let userMicStates = {};        // Map: userId -> boolean (mic on/off status)

// Offer State Management
let makingOffers = new Set();  // Track ongoing offer negotiations to prevent conflicts

// ============================================================================
// UI ELEMENT REFERENCES
// ============================================================================
const usersList = document.getElementById("usersList");
const userNameEl = document.getElementById("username");
const leaveRoomBtn = document.getElementById("leaveRoom");
const toggleLocalMicBtn = document.getElementById("toggleLocalMicBtn");
const myRoomEl = document.getElementById("myRoom");
const remoteAudioContainer = document.getElementById("remoteAudioContainer");

// ============================================================================
// WEBRTC CONFIGURATION
// ============================================================================
/**
 * ICE (Interactive Connectivity Establishment) Configuration
 * 
 * STUN servers help peers discover their public IP addresses and ports
 * This is necessary because most devices are behind NAT (Network Address Translation)
 * 
 * Without STUN:
 * - Peers only know their private IP (e.g., 192.168.1.x)
 * - Cannot establish direct connections across the internet
 * 
 * With STUN:
 * - Peers discover their public IP:port combination
 * - Can establish peer-to-peer connections through NAT
 * 
 * Google provides free STUN servers for WebRTC
 */
const iceServersConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================
/**
 * Initializes the application on page load
 * Sets up all event listeners and socket handlers
 */
function init() {
  socket.emit("join");          // Request user ID from server
  setupSocketHandlers();        // Listen for signaling messages
  setupUIHandlers();            // Setup button clicks, drag/drop
  setupTouchSupport();          // Enable mobile touch interactions
}

init(); // Start the application

// ============================================================================
// SOCKET EVENT HANDLERS - SIGNALING
// ============================================================================
/**
 * WebRTC Signaling Overview:
 * 
 * WebRTC handles media transmission, but NOT connection setup
 * Signaling (exchanging connection info) must be implemented separately
 * 
 * This app uses Socket.io for signaling:
 * 1. When user A wants to connect to user B:
 *    - A creates an "offer" (SDP describing A's media capabilities)
 *    - A sends offer to server
 *    - Server forwards offer to B
 * 
 * 2. User B receives the offer:
 *    - B creates an "answer" (SDP describing B's media capabilities)
 *    - B sends answer back through server to A
 * 
 * 3. Both users exchange ICE candidates:
 *    - Each peer discovers network routes (ICE candidates)
 *    - Candidates are sent through server to the other peer
 *    - Peers try each candidate pair until connection succeeds
 * 
 * Socket handlers below implement this signaling protocol
 */

function setupSocketHandlers() {
  // User Management Events
  socket.on("userCreated", handleUserCreated);
  socket.on("userListUpdate", renderUserList);
  
  // Room Management Events
  socket.on("userAddedToRoom", handleUserAddedToRoom);
  socket.on("userRemovedFromRoom", handleUserRemovedFromRoom);
  socket.on("roomUpdated", handleRoomUpdated);
  
  // Media State Events
  socket.on("micStateChanged", handleMicStateChanged);
  
  // Error Handling
  socket.on("userBusy", handleUserBusy);
  socket.on("error", handleError);
  
  // WebRTC Signaling Events (the core of peer connection establishment)
  socket.on("webrtcOffer", handleOffer);      // Receive SDP offer
  socket.on("webrtcAnswer", handleAnswer);    // Receive SDP answer
  socket.on("webrtcCandidate", handleCandidate); // Receive ICE candidate
}

// ============================================================================
// UI EVENT HANDLERS
// ============================================================================
/**
 * Sets up user interface interactions
 */
function setupUIHandlers() {
  // Toggle local microphone on/off
  toggleLocalMicBtn.addEventListener("click", async () => {
    if (!isLocalMicEnabled) {
      await enableLocalMicrophone();
    } else {
      disableLocalMicrophone();
    }
  });

  // Leave the current voice room
  leaveRoomBtn.addEventListener("click", () => {
    leaveRoom();
  });

  // Setup drag-and-drop area for adding users to room
  setupDropZone();
}

/**
 * Configures the "My Room" area as a drop zone for dragging users
 * Allows desktop users to drag/drop users into voice chat
 */
function setupDropZone() {
  // Visual feedback when dragging over the room
  myRoomEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    myRoomEl.classList.add("dragover");
  });

  myRoomEl.addEventListener("dragleave", () => {
    myRoomEl.classList.remove("dragover");
  });

  // Handle user drop
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

// ============================================================================
// MEDIA MANAGEMENT - LOCAL MICROPHONE
// ============================================================================
/**
 * WebRTC Media Stream Overview:
 * 
 * getUserMedia() requests access to user's media devices
 * Returns a MediaStream containing audio/video tracks
 * 
 * MediaStream -> contains one or more MediaStreamTrack objects
 * MediaStreamTrack -> represents single audio or video source
 * 
 * For voice chat, we only need audio tracks
 * These tracks are then added to RTCPeerConnection objects
 * to be transmitted to remote peers
 */

/**
 * Enables local microphone and adds audio track to all peer connections
 * 
 * Process:
 * 1. Request microphone access via getUserMedia
 * 2. Store the resulting MediaStream
 * 3. Add audio tracks to all existing peer connections
 * 4. Trigger renegotiation if needed (new offer/answer exchange)
 */
async function enableLocalMicrophone() {
  try {
    // Request audio with quality enhancements
    localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,  // Remove echo/feedback
        noiseSuppression: true,  // Remove background noise
        autoGainControl: true    // Normalize volume levels
      } 
    });
    
    console.log("Local stream acquired, tracks:", localStream.getTracks().length);
    localStream.getTracks().forEach(track => {
      console.log("Local track:", track.kind, "enabled:", track.enabled, "muted:", track.muted);
    });
    
    // Update state and UI
    isLocalMicEnabled = true;
    socket.emit("micStateChanged", { userId: currentUserId, micOn: true });
    userMicStates[currentUserId] = true;
    updateLocalMicButton();

    console.log("Adding tracks to existing peer connections");

    /**
     * Add tracks to all existing peer connections
     * 
     * Why? If microphone was enabled AFTER peer connections were created,
     * we need to add the audio track and renegotiate the connection
     * 
     * RTCPeerConnection.addTrack() adds a track to be sent to remote peer
     * This may trigger renegotiation (new offer/answer exchange)
     */
    for (const [userId, pc] of Object.entries(peerConnections)) {
      console.log("Adding local track to peer:", userId);
      localStream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, localStream);
        console.log("Track added to", userId, ":", track.kind, track.label);
      });
      
      // If connection is stable, trigger renegotiation
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

/**
 * Creates and sends a new offer to a peer
 * Used for renegotiation when media tracks change
 * 
 * SDP (Session Description Protocol):
 * - Text format describing media capabilities
 * - Includes codecs, formats, transport addresses
 * - Exchanged via offer/answer model
 */
async function createAndSendOffer(userId) {
  const pc = peerConnections[userId];
  if (!pc) return;
  
  try {
    // Create SDP offer
    const offer = await pc.createOffer({
      offerToReceiveAudio: true  // We want to receive audio from peer
    });
    
    // Set as local description (starts ICE gathering)
    await pc.setLocalDescription(offer);
    
    // Send offer through signaling server
    socket.emit("webrtcOffer", {
      targetUserId: userId,
      offer: pc.localDescription,
    });
    console.log("Renegotiation offer sent to:", userId);
  } catch (err) {
    console.error("Error creating renegotiation offer:", err);
  }
}

/**
 * Disables local microphone and removes tracks from peer connections
 */
function disableLocalMicrophone() {
  if (localStream) {
    // Stop all tracks (releases hardware)
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
  
  // Update state and UI
  isLocalMicEnabled = false;
  socket.emit("micStateChanged", { userId: currentUserId, micOn: false });
  userMicStates[currentUserId] = false;
  updateLocalMicButton();
}

/**
 * Updates the microphone button appearance
 */
function updateLocalMicButton() {
  if (isLocalMicEnabled) {
    toggleLocalMicBtn.textContent = "🎤 Mute";
    toggleLocalMicBtn.classList.add("active");
  } else {
    toggleLocalMicBtn.textContent = "🎤 Unmute";
    toggleLocalMicBtn.classList.remove("active");
  }
}

// ============================================================================
// MEDIA MANAGEMENT - REMOTE AUDIO
// ============================================================================
/**
 * Handles incoming audio track from remote peer
 * 
 * WebRTC Track Event:
 * - Fired when remote peer adds a track
 * - Contains MediaStreamTrack and MediaStream
 * - We attach the stream to an <audio> element for playback
 * 
 * Browser Audio Policies:
 * - Modern browsers block autoplay without user interaction
 * - We attempt autoplay and fallback to user prompt if blocked
 */
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
  
  // Find or create audio element for this peer
  let audioEl = document.getElementById(`audio-${userId}`);
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.id = `audio-${userId}`;
    audioEl.autoplay = true;
    audioEl.playsInline = true; // Important for mobile Safari
    audioEl.controls = true;    // Show controls for debugging
    audioEl.volume = 1.0;
    
    // Add to container
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
    // Attach remote stream to audio element
    audioEl.srcObject = event.streams[0];
    console.log("Set srcObject for audio element");
    
    // Attempt to play (may be blocked by browser policy)
    audioEl.play()
      .then(() => {
        console.log("Audio playback started successfully for:", userId);
      })
      .catch(err => {
                console.error("Audio playback failed:", err);
        // Show user interaction prompt if autoplay blocked
        showAudioUnblockPrompt();
      });
      
    // Monitor audio element events for debugging
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

/**
 * Shows a prompt to enable audio playback
 * Required when browser blocks autoplay due to policy
 * 
 * Browser Autoplay Policy:
 * - Prevents websites from playing audio without user interaction
 * - Protects users from unwanted sounds
 * - Requires user gesture (click, tap) to enable audio
 */
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

// ============================================================================
// UI RENDERING - USER LIST
// ============================================================================
/**
 * Renders the list of available users
 * Shows their status (available/engaged) and microphone state
 * Enables drag-and-drop functionality for desktop
 * Enables touch interactions for mobile
 */
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

// ============================================================================
// UI RENDERING - ROOM DISPLAY
// ============================================================================
/**
 * Updates the "My Room" section showing current participants
 * Displays microphone status for each user
 * Provides remove buttons for each participant
 */
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

/**
 * Removes a specific user from the room
 */
function removeUserFromRoom(userId) {
  console.log("Removing user from room:", userId);
  socket.emit("removeUserFromRoom", userId);
}

/**
 * Leaves the current room (removes all users)
 */
function leaveRoom() {
  console.log("Leaving room");
  socket.emit("leaveRoom");
}

// ============================================================================
// SOCKET EVENT HANDLERS - USER MANAGEMENT
// ============================================================================
/**
 * Called when this user is created on the server
 * Stores user ID and name for future reference
 */
function handleUserCreated(userId, name) {
  console.log("User created:", userId, name);
  currentUserId = userId;
  currentUserName = name;
}

/**
 * Called when microphone state changes for any user
 * Updates UI to reflect current mic status
 */
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

// ============================================================================
// SOCKET EVENT HANDLERS - ROOM MANAGEMENT
// ============================================================================
/**
 * Called when a user is added to the room
 * Creates a peer connection with the new user
 * 
 * @param {Object} params
 * @param {string} params.userId - The user being added
 * @param {boolean} params.initiator - Whether we should create the offer
 * 
 * WebRTC Connection Initiation:
 * - Only ONE peer should create the initial offer
 * - The "initiator" flag determines who creates the offer
 * - This prevents both peers from creating offers simultaneously
 */
async function handleUserAddedToRoom({ userId, initiator }) {
  console.log("User added to room:", userId, "Initiator:", initiator);
  myRoom.add(userId);
  updateRoomDisplay();
  
  // Create peer connection - initiator creates offer
  await createPeerConnectionForUser(userId, initiator);
}

/**
 * Called when a user is removed from the room
 * Closes the peer connection and cleans up resources
 */
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

/**
 * Called when the room state is synchronized from server
 * Updates local room state to match server
 * Useful for handling disconnects/reconnects
 */
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

// ============================================================================
// SOCKET EVENT HANDLERS - ERROR HANDLING
// ============================================================================
/**
 * Called when a user we're trying to add is already busy
 */
function handleUserBusy({ userId, message }) {
  console.log("User is busy:", userId, message);
  showNotification(message, "warning");
}

/**
 * Called when a general error occurs
 */
function handleError({ message }) {
  console.error("Server error:", message);
  showNotification(message, "error");
}

/**
 * Shows a temporary notification to the user
 * 
 * @param {string} message - The message to display
 * @param {string} type - Type: "info", "warning", "error", "success"
 */
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

// ============================================================================
// WEBRTC CORE - PEER CONNECTION CREATION
// ============================================================================
/**
 * Creates an RTCPeerConnection for a specific user
 * 
 * RTCPeerConnection:
 * - The core WebRTC API for peer-to-peer communication
 * - Handles media transmission, encryption, and NAT traversal
 * - One connection needed per remote peer
 * 
 * Connection Lifecycle:
 * 1. Create RTCPeerConnection
 * 2. Add local media tracks (if available)
 * 3. Exchange SDP offers/answers (signaling)
 * 4. Exchange ICE candidates (for NAT traversal)
 * 5. Connection established - media flows
 * 
 * @param {string} userId - The remote user's ID
 * @param {boolean} shouldOffer - Whether this peer should create the offer
 */
async function createPeerConnectionForUser(userId, shouldOffer) {
  if (peerConnections[userId]) {
    console.log("Peer connection already exists for:", userId);
    return;
  }

  console.log("=== Creating peer connection for:", userId, "shouldOffer:", shouldOffer, "===");
  
  // Create new peer connection with ICE servers
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

  /**
   * ICE Candidate Event Handler
   * 
   * ICE (Interactive Connectivity Establishment):
   * - Finds the best path to connect two peers
   * - Tests multiple network routes (candidates)
   * - Each candidate represents a possible connection path
   * 
   * Candidate Types:
   * - host: Direct connection (same network)
   * - srflx: Server reflexive (through STUN, public IP)
   * - relay: Relayed through TURN server (fallback)
   * 
   * Process:
   * 1. ICE agent discovers candidates
   * 2. Each candidate is sent to remote peer via signaling
   * 3. Peers try candidate pairs until connection succeeds
   */
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

  /**
   * Track Event Handler
   * 
   * Fired when remote peer adds a media track
   * This is how we receive audio/video from the other user
   */
  pc.ontrack = (event) => {
    console.log("=== ontrack fired for:", userId, "===");
    handleRemoteTrack(event, userId);
  };
  
  /**
   * ICE Connection State Handler
   * 
   * Monitors the ICE connection state:
   * - new: ICE agent is gathering candidates
   * - checking: ICE agent is checking candidate pairs
   * - connected: ICE agent found a working connection
   * - completed: ICE agent finished (all candidates checked)
   * - failed: ICE agent couldn't find a connection
   * - disconnected: Connection lost (may reconnect)
   * - closed: Connection permanently closed
   */
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

  /**
   * Connection State Handler
   * 
   * Monitors the overall peer connection state:
   * - new: Connection just created
   * - connecting: Connection is being established
   * - connected: Connection is established and media can flow
   * - disconnected: Connection lost temporarily
   * - failed: Connection failed permanently
   * - closed: Connection closed
   */
  pc.onconnectionstatechange = () => {
    console.log(`Connection state for ${userId}:`, pc.connectionState);
    if (pc.connectionState === "connected") {
      console.log("✅ Peer connection established with:", userId);
    }
  };
  
  /**
   * Signaling State Handler
   * 
   * Monitors the signaling state during offer/answer exchange:
   * - stable: No offer/answer exchange in progress
   * - have-local-offer: Local offer created, waiting for answer
   * - have-remote-offer: Remote offer received, need to create answer
   * - have-local-pranswer: Provisional answer sent
   * - have-remote-pranswer: Provisional answer received
   * - closed: Connection closed
   */
  pc.onsignalingstatechange = () => {
    console.log(`Signaling state for ${userId}:`, pc.signalingState);
  };

  /**
   * Create Initial Offer (if this peer is the initiator)
   * 
   * SDP Offer/Answer Exchange:
   * - Offer describes what media sender wants to send/receive
   * - Answer describes what media receiver can send/receive
   * - Both are in SDP (Session Description Protocol) format
   * 
   * Only the initiator creates the offer to avoid race conditions
   */
  if (shouldOffer) {
    console.log("Creating and sending initial offer to:", userId);
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,  // We want to receive audio
        offerToReceiveVideo: false  // We don't need video
      });
      
      console.log("Offer created, setting local description");
      // Setting local description starts ICE gathering
      await pc.setLocalDescription(offer);
      
      console.log("Sending offer to:", userId);
      // Send offer through signaling server
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

/**
 * Closes a peer connection and cleans up resources
 * 
 * @param {string} userId - The user whose connection to close
 */
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

// ============================================================================
// WEBRTC SIGNALING - OFFER/ANSWER/ICE HANDLERS
// ============================================================================
/**
 * Handles incoming SDP offer from remote peer
 * 
 * Offer/Answer Flow:
 * 1. Peer A creates offer (describes its capabilities)
 * 2. Peer A sets offer as local description
 * 3. Peer A sends offer to Peer B via signaling
 * 4. Peer B receives offer
 * 5. Peer B sets offer as remote description
 * 6. Peer B creates answer (describes its capabilities)
 * 7. Peer B sets answer as local description
 * 8. Peer B sends answer to Peer A via signaling
 * 9. Peer A receives answer
 * 10. Peer A sets answer as remote description
 * 11. Connection established (with ICE)
 * 
 * @param {Object} params
 * @param {string} params.fromUserId - User who sent the offer
 * @param {RTCSessionDescription} params.offer - The SDP offer
 */
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
    
    /**
     * Set Remote Description
     * 
     * The offer contains:
     * - Media codecs supported
     * - Transport protocols
     * - ICE candidates
     * - DTLS fingerprints (for encryption)
     * 
     * Setting remote description tells our peer connection
     * what the other peer wants to send/receive
     */
    console.log("Setting remote description (offer)");
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log("Remote description set successfully");
    
    /**
     * Create Answer
     * 
     * The answer describes what WE can send/receive
     * Must be compatible with the offer
     * WebRTC negotiates the best common formats
     */
    console.log("Creating answer");
    const answer = await pc.createAnswer();
    console.log("Answer created, setting local description");
    await pc.setLocalDescription(answer);
    
    /**
     * Send Answer
     * 
     * Send our answer back to the peer who sent the offer
     * They will set it as their remote description
     */
    console.log("Sending answer to:", fromUserId);
    socket.emit("webrtcAnswer", {
      targetUserId: fromUserId,
      answer: pc.localDescription,
    });
    
    // Process any ICE candidates that arrived early
    await processPendingCandidates(fromUserId);
  } catch (err) {
    console.error("Error handling offer:", err);
  }
}

/**
 * Handles incoming SDP answer from remote peer
 * 
 * This completes the offer/answer exchange
 * After this, ICE will establish the actual connection
 * 
 * @param {Object} params
 * @param {string} params.fromUserId - User who sent the answer
 * @param {RTCSessionDescription} params.answer - The SDP answer
 */
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
    
    /**
     * Set Remote Description (Answer)
     * 
     * The answer tells us what the remote peer agreed to send/receive
     * After this, both peers know the media formats and transport details
     * ICE can now establish the actual connection
     */
    console.log("Setting remote description (answer)");
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log("Remote description (answer) set successfully");
    
    // Process any ICE candidates that arrived early
    await processPendingCandidates(fromUserId);
  } catch (err) {
    console.error("Error setting answer:", err);
  }
}

/**
 * Handles incoming ICE candidate from remote peer
 * 
 * ICE Candidate Exchange:
 * - After SDP exchange, peers exchange ICE candidates
 * - Each candidate represents a possible connection path
 * - Peers try each candidate pair until one works
 * - Candidates can arrive before or after SDP exchange
 * 
 * Candidate Format:
 * - IP address and port
 * - Transport protocol (UDP/TCP)
 * - Candidate type (host/srflx/relay)
 * - Priority (higher = preferred)
 * 
 * @param {Object} params
 * @param {string} params.fromUserId - User who sent the candidate
 * @param {RTCIceCandidate} params.candidate - The ICE candidate
 */
async function handleCandidate({ fromUserId, candidate }) {
  console.log("Received ICE candidate from:", fromUserId);
  
  const pc = peerConnections[fromUserId];
  if (!pc) {
    console.warn("No peer connection for candidate from:", fromUserId);
    return;
  }

  const iceCandidate = new RTCIceCandidate(candidate);
  
  try {
    /**
     * Add ICE Candidate
     * 
     * Can only add candidates after remote description is set
     * If remote description isn't set yet, queue the candidate
     * 
     * Why? The remote description contains information needed
     * to validate and use the ICE candidates
     */
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

/**
 * Processes queued ICE candidates after remote description is set
 * 
 * Candidates may arrive before the remote description
 * We queue them and add them once remote description is set
 * 
 * @param {string} userId - User whose candidates to process
 */
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

// ============================================================================
// CLEANUP AND CONNECTION MANAGEMENT
// ============================================================================
/**
 * Closes all peer connections and releases resources
 * Called when leaving room or on page unload
 */
function cleanupAllConnections() {
  console.log("Cleaning up all connections");
  
  // Close all peer connections
  for (const userId of Object.keys(peerConnections)) {
    closePeerConnection(userId);
  }
  
  // Clear room state
  myRoom.clear();
  updateRoomDisplay();
  
  // Remove all remote audio elements
  remoteAudioContainer.innerHTML = "";
  
  // Stop local media stream
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    isLocalMicEnabled = false;
    updateLocalMicButton();
  }
}

/**
 * Cleanup on page unload
 * Ensures we properly disconnect from all peers
 */
window.addEventListener("beforeunload", () => {
  cleanupAllConnections();
  socket.emit("leaveRoom");
});

// ============================================================================
// MOBILE TOUCH SUPPORT
// ============================================================================
/**
 * Touch Drag State
 * 
 * Tracks state for touch-based drag-and-drop on mobile devices
 * Native drag-and-drop doesn't work well on touch screens
 * We implement custom touch handling for mobile
 */
let touchDragState = {
  active: false,      // Whether a touch drag is in progress
  userId: null,       // User being dragged
  element: null,      // Original element being dragged
  clone: null,        // Visual clone following finger
  startX: 0,          // Touch start X coordinate
  startY: 0,          // Touch start Y coordinate
  currentX: 0,        // Current touch X coordinate
  currentY: 0         // Current touch Y coordinate
};

/**
 * Sets up touch support for mobile devices
 * 
 * Mobile Touch Challenges:
 * - Drag-and-drop API doesn't work on touch screens
 * - Need to handle touchstart, touchmove, touchend manually
 * - Must create visual feedback (dragged element clone)
 * - Must detect when touch is over drop zone
 */
function setupTouchSupport() {
  const touchIndicator = document.getElementById('touchIndicator');
  
  // Global touch move and end handlers
  // These track the drag across the entire screen
  document.addEventListener('touchmove', handleTouchMove, { passive: false });
  document.addEventListener('touchend', handleTouchEnd);
  document.addEventListener('touchcancel', handleTouchEnd);
}

/**
 * Handles touch start on a user element
 * Initiates the drag operation
 * 
 * @param {TouchEvent} e - Touch event
 * @param {string} userId - User being dragged
 * @param {HTMLElement} element - Element being dragged
 */
function handleTouchStart(e, userId, element) {
  // Check if user is engaged (can't drag engaged users)
  if (element.classList.contains('engaged')) {
    return;
  }
  
  e.preventDefault();
  
  const touch = e.touches[0];
  
  // Initialize drag state
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
  
  /**
   * Create Visual Clone
   * 
   * On touch devices, we need to show what's being dragged
   * Create a clone of the element that follows the finger
   */
  const clone = element.cloneNode(true);
  clone.classList.add('touch-dragging');
  clone.style.width = element.offsetWidth + 'px';
  clone.style.left = touch.clientX - (element.offsetWidth / 2) + 'px';
  clone.style.top = touch.clientY - 20 + 'px';
  document.body.appendChild(clone);
  
  touchDragState.clone = clone;
  
  // Add visual feedback to original element
  element.style.opacity = '0.3';
  
  // Show touch indicator (visual hint of drag)
  const indicator = document.getElementById('touchIndicator');
  indicator.classList.add('active');
  indicator.style.left = touch.clientX + 'px';
  indicator.style.top = touch.clientY + 'px';
}

/**
 * Handles touch move during drag
 * Updates clone position and checks for drop zone
 * 
 * @param {TouchEvent} e - Touch event
 */
function handleTouchMove(e) {
  if (!touchDragState.active) return;
  
  // Prevent scrolling while dragging
  e.preventDefault();
  
  const touch = e.touches[0];
  touchDragState.currentX = touch.clientX;
  touchDragState.currentY = touch.clientY;
  
  // Move the visual clone to follow finger
  if (touchDragState.clone) {
    touchDragState.clone.style.left = touch.clientX - (touchDragState.clone.offsetWidth / 2) + 'px';
    touchDragState.clone.style.top = touch.clientY - 20 + 'px';
  }
  
  // Update touch indicator position
  const indicator = document.getElementById('touchIndicator');
  indicator.style.left = touch.clientX + 'px';
  indicator.style.top = touch.clientY + 'px';
  
  /**
   * Check if Over Drop Zone
   * 
   * Detect if the finger is over the "My Room" drop zone
   * Provide visual feedback by adding CSS class
   */
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

/**
 * Handles touch end - completes or cancels the drag
 * Checks if user was dropped in the room zone
 * 
 * @param {TouchEvent} e - Touch event
 */
function handleTouchEnd(e) {
  if (!touchDragState.active) return;
  
  const touch = e.changedTouches[0];
  
  /**
   * Check if Dropped in Room
   * 
   * If the finger was released over the drop zone,
   * add the user to the room
   */
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
  
  // Cleanup - remove clone and reset state
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
  
  // Reset touch drag state
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

/**
 * Handles tap gesture as alternative to drag-and-drop
 * Simpler interaction for mobile users
 * 
 * Tap vs Drag:
 * - Drag: More intuitive on desktop
 * - Tap: Simpler on mobile (less precision needed)
 * - This function provides tap-to-add as a fallback
 * 
 * @param {TouchEvent} e - Touch event
 * @param {string} userId - User to add to room
 * @param {HTMLElement} element - Element that was tapped
 */
function handleUserTap(e, userId, element) {
  // Don't allow tapping engaged users
  if (element.classList.contains('engaged')) {
    return;
  }
  
  // Prevent if we're dragging (to avoid conflicts)
  if (touchDragState.active) {
    return;
  }
  
  /**
   * Tap Detection
   * 
   * A tap is a quick touch and release
   * We check if the touch duration was short (< 300ms)
   * This distinguishes taps from drag starts
   */
  const timeSinceStart = Date.now() - element.dataset.touchStartTime;
  if (timeSinceStart < 300) { // 300ms threshold for tap
    console.log("Tapping user to add to room:", userId);
    socket.emit("addUserToRoom", userId);
    
    // Visual feedback - scale animation
    element.style.transform = 'scale(0.95)';
    setTimeout(() => {
      element.style.transform = '';
    }, 200);
  }
}

// ============================================================================
// WEBRTC CONCEPTS SUMMARY
// ============================================================================
/**
 * === WEBRTC ARCHITECTURE OVERVIEW ===
 * 
 * 1. SIGNALING (Socket.io in this app)
 *    - WebRTC doesn't specify how to exchange connection info
 *    - We use Socket.io for signaling server
 *    - Signaling exchanges: SDP offers/answers, ICE candidates
 * 
 * 2. SDP (Session Description Protocol)
 *    - Text format describing media session
 *    - Contains: codecs, formats, encryption keys, network info
 *    - Offer/Answer model: One peer offers, other answers
 * 
 * 3. ICE (Interactive Connectivity Establishment)
 *    - Discovers best path between peers
 *    - Handles NAT traversal (most devices are behind NAT)
 *    - Tries multiple candidates until connection works
 * 
 * 4. STUN (Session Traversal Utilities for NAT)
 *    - Server that helps peers discover public IP addresses
 *    - Enables direct peer-to-peer connections through NAT
 *    - Free STUN servers available (e.g., Google's)
 * 
 * 5. TURN (Traversal Using Relays around NAT)
 *    - Fallback when direct connection fails
 *    - Relays media through server (not peer-to-peer)
 *    - Not used in this app (would require TURN server)
 * 
 * 6. DTLS (Datagram Transport Layer Security)
 *    - WebRTC encrypts all media by default
 *    - Uses DTLS for key exchange
 *    - Ensures privacy and security
 * 
 * 7. SRTP (Secure Real-time Transport Protocol)
 *    - Encrypted media transmission
 *    - All audio/video is encrypted end-to-end
 *    - Automatic in WebRTC
 * 
 * === CONNECTION ESTABLISHMENT FLOW ===
 * 
 * Step 1: User A wants to connect to User B
 * 
 * Step 2: A creates RTCPeerConnection
 *         - Configures ICE servers (STUN)
 *         - Adds local media tracks (microphone)
 * 
 * Step 3: A creates SDP Offer
 *         - Describes what A wants to send/receive
 *         - Contains codec information, media formats
 *         - createOffer() generates the SDP
 * 
 * Step 4: A sets Local Description
 *         - setLocalDescription(offer)
 *         - Starts ICE candidate gathering
 * 
 * Step 5: A sends Offer to B (via signaling)
 *         - Uses Socket.io to send to server
 *         - Server forwards to B
 * 
 * Step 6: B receives Offer
 *         - Creates RTCPeerConnection if needed
 *         - Adds local media tracks
 * 
 * Step 7: B sets Remote Description
 *         - setRemoteDescription(offer)
 *         - Now B knows what A wants
 * 
 * Step 8: B creates SDP Answer
 *         - Describes what B can send/receive
 *         - Must be compatible with A's offer
 *         - createAnswer() generates the SDP
 * 
 * Step 9: B sets Local Description
 *         - setLocalDescription(answer)
 *         - Starts ICE candidate gathering
 * 
 * Step 10: B sends Answer to A (via signaling)
 *          - Uses Socket.io to send to server
 *          - Server forwards to A
 * 
 * Step 11: A receives Answer
 *          - setRemoteDescription(answer)
 *          - Now both peers know the media format
 * 
 * Step 12: ICE Candidate Exchange (parallel to above)
 *          - As each peer gathers candidates, they send them
 *          - Other peer adds them: addIceCandidate()
 *          - ICE tries candidate pairs until connection works
 * 
 * Step 13: Connection Established
 *          - ICE finds working candidate pair
 *          - Media starts flowing directly between peers
 *          - ontrack event fires for remote media
 * 
 * Step 14: Media Playback
 *          - Remote audio track attached to <audio> element
 *          - Browser plays audio automatically
 * 
 * === KEY WEBRTC APIs USED ===
 * 
 * RTCPeerConnection:
 *   - new RTCPeerConnection(config)
 *   - pc.addTrack(track, stream)
 *   - pc.createOffer()
 *   - pc.createAnswer()
 *   - pc.setLocalDescription(sdp)
 *   - pc.setRemoteDescription(sdp)
 *   - pc.addIceCandidate(candidate)
 *   - pc.close()
 * 
 * MediaDevices (getUserMedia):
 *   - navigator.mediaDevices.getUserMedia(constraints)
 *   - Returns Promise<MediaStream>
 * 
 * MediaStream:
 *   - Contains MediaStreamTrack objects
 *   - stream.getTracks()
 *   - track.stop()
 * 
 * Events:
 *   - onicecandidate: New ICE candidate discovered
 *   - ontrack: Remote media track received
 *   - oniceconnectionstatechange: ICE state changed
 *   - onconnectionstatechange: Overall connection state changed
 *   - onsignalingstatechange: Signaling state changed
 * 
 * === COMMON ISSUES AND SOLUTIONS ===
 * 
 * Issue: No audio heard from remote peer
 * Solutions:
 *   - Check browser autoplay policy (may need user interaction)
 *   - Verify remote track is enabled
 *   - Check audio element volume
 *   - Ensure remote peer has microphone enabled
 *   - Check ICE connection state (must be "connected")
 * 
 * Issue: ICE connection fails
 * Solutions:
 *   - Check STUN server is reachable
 *   - Check firewall settings
 *   - Try adding TURN server for relay
 *   - Check network connectivity
 * 
 * Issue: Offer/Answer exchange fails
 * Solutions:
 *   - Ensure only one peer creates initial offer
 *   - Check signaling is working (Socket.io connected)
 *   - Verify remote description is set before adding ICE candidates
 *   - Check for correct SDP format
 * 
 * Issue: Race conditions in signaling
 * Solutions:
 *   - Use initiator flag to determine who offers
 *   - Queue ICE candidates if remote description not set
 *   - Handle renegotiation carefully (check signaling state)
 * 
 * Issue: Mobile autoplay blocked
 * Solutions:
 *   - Show user prompt to enable audio
 *   - Require user gesture before playing
 *   - Use playsinline attribute on <audio>
 * 
 * === SECURITY CONSIDERATIONS ===
 * 
 * 1. Encryption:
 *    - WebRTC encrypts all media by default (SRTP)
 *    - No additional encryption needed
 *    - Media never sent in plaintext
 * 
 * 2. Signaling Security:
 *    - Signaling server should use WSS (WebSocket Secure)
 *    - Implement authentication on signaling server
 *    - Validate all signaling messages
 * 
 * 3. Permission Prompts:
 *    - getUserMedia requires user permission
 *    - User must explicitly allow microphone access
 *    - Browser shows indicator when mic is active
 * 
 * 4. Privacy:
 *    - IP addresses visible to peers (through ICE)
 *    - Use TURN relay for IP privacy if needed
 *    - Inform users of peer-to-peer nature
 * 
 * === PERFORMANCE OPTIMIZATION ===
 * 
 * 1. Audio Quality:
 *    - Enable echo cancellation
 *    - Enable noise suppression
 *    - Enable auto gain control
 *    - Use appropriate codecs (Opus is best for voice)
 * 
 * 2. Connection Management:
 *    - Reuse peer connections when possible
 *    - Close connections properly to free resources
 *    - Implement connection timeouts
 * 
 * 3. Resource Cleanup:
 *    - Stop tracks when done: track.stop()
 *    - Close peer connections: pc.close()
 *    - Remove audio elements from DOM
 *    - Clear event listeners
 * 
 * 4. Scalability:
 *    - Each peer needs connection to every other peer (mesh)
 *    - N users = N*(N-1)/2 total connections
 *    - Mesh doesn't scale beyond ~4-6 users
 *    - For larger groups, use SFU (Selective Forwarding Unit)
 * 
 * === BROWSER COMPATIBILITY ===
 * 
 * Supported Browsers:
 *   - Chrome/Edge (Chromium): Full support
 *   - Firefox: Full support
 *   - Safari: Full support (iOS 11+)
 *   - Opera: Full support
 * 
 * Not Supported:
 *   - Internet Explorer (any version)
 *   - Older Android browsers (< Android 5)
 * 
 * Prefixes (legacy):
 *   - Older browsers used webkit/moz prefixes
 *   - Modern code doesn't need prefixes
 *   - Adapter.js library handles compatibility
 * 
 * === TESTING WEBRTC APPLICATIONS ===
 * 
 * 1. Local Testing:
 *    - Use https://localhost (getUserMedia requires HTTPS)
 *    - Or use http://localhost (exception for localhost)
 *    - Test with multiple browser tabs
 * 
 * 2. Network Testing:
 *    - Test on different networks (WiFi, cellular)
 *    - Test with VPN enabled
 *    - Test behind corporate firewalls
 * 
 * 3. Debugging Tools:
 *    - Chrome: chrome://webrtc-internals
 *    - Firefox: about:webrtc
 *    - Shows all peer connections, ICE candidates, stats
 * 
 * 4. Common Test Scenarios:
 *    - Both users on same network
 *    - Users on different networks (NAT traversal)
 *    - One user behind strict firewall
 *    - Mobile device on cellular
 *    - Poor network conditions (packet loss, latency)
 * 
 * === FURTHER LEARNING RESOURCES ===
 * 
 * Official Specs:
 *   - W3C WebRTC API: https://w3c.github.io/webrtc-pc/
 *   - MDN WebRTC Guide: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
 * 
 * Books:
 *   - "WebRTC for the Curious" (open source book)
 *   - "Real-Time Communication with WebRTC" (O'Reilly)
 * 
 * Tools:
 *   - Adapter.js: Browser compatibility shim
 *   - Simple-peer: Simplified WebRTC wrapper
 *   - PeerJS: High-level WebRTC library
 * 
 * === END OF DOCUMENTATION ===
 */