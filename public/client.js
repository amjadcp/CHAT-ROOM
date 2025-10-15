const socket = io();
let connectedUserId = null;
const usersList = document.getElementById('usersList');
const releaseMicBtn = document.getElementById('releaseMicBtn');

let localStream = null;
let pc = null;
let isMakingOffer = false;
let isIgnoringOffer = false;
const polite = true;  // Set polite to true to handle negotiation collisions properly
let pendingCandidates = [];

socket.emit('join', currentUserId);

// Handle releasing mic button
releaseMicBtn.addEventListener('click', () => {
  if (connectedUserId) {
    socket.emit('releaseMic');
    cleanupConnection();
  }
});

// Render or update user list dynamically based on server update
socket.on('userListUpdate', (users) => {
  usersList.innerHTML = '';  // Clear existing list

  users.forEach(u => {
    const li = document.createElement('li');
    li.setAttribute('data-userid', u._id);

    // User name text
    li.appendChild(document.createTextNode(u.name + ' '));

    // Mic button
    const micBtn = document.createElement('button');
    micBtn.textContent = '🎤';
    micBtn.className = 'micBtn';

    // Disable mic if user is engaged, self, or already engaged with someone else
    micBtn.disabled = !!connectedUserId || u.engagedWith !== null || u._id === currentUserId;

    micBtn.onclick = () => {
      if (connectedUserId) return alert('Already engaged in a conversation.');
      if (u.engagedWith) return alert('User is engaged.');
      if (u._id === currentUserId) return alert('Cannot talk to yourself.');
      socket.emit('toggleMic', u._id);
    };

    li.appendChild(micBtn);

    // Status span
    const statusSpan = document.createElement('span');
    statusSpan.className = 'status';
    statusSpan.textContent = u.engagedWith ? 'Engaged' : 'Available';
    if (u.engagedWith) {
      li.classList.add('engaged');
    }

    li.appendChild(statusSpan);

    usersList.appendChild(li);
  });
});

// Handle when mic toggled (engaged)
socket.on('micToggled', async ({ engagedWith }) => {
  connectedUserId = engagedWith;
  releaseMicBtn.disabled = false;
  await startWebRTC(engagedWith);
});

// Handle when mic released
socket.on('micReleased', () => {
  cleanupConnection();
});

// WebRTC helper functions

async function startLocalStream() {
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert('Microphone access denied or error.');
    }
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }, // Google STUN server
      // You can add TURN servers here for better NAT traversal in production
    ]
  });

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('webrtcCandidate', { targetUserId: connectedUserId, candidate: event.candidate });
    }
  };

  pc.ontrack = event => {
    let remoteAudio = document.getElementById('remoteAudio');
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.id = 'remoteAudio';
      remoteAudio.autoplay = true;
      document.body.appendChild(remoteAudio);
    }
    remoteAudio.srcObject = event.streams[0];
  };

  pc.onnegotiationneeded = async () => {
    if (isMakingOffer) return;

    try {
      isMakingOffer = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      socket.emit('webrtcOffer', { targetUserId: connectedUserId, offer: pc.localDescription });
    } catch (err) {
      console.error('Error during negotiationneeded', err);
    } finally {
      isMakingOffer = false;
    }
  };
}

// Override setting remote description with buffering ICE candidate support
async function setRemoteDesc(desc) {
  await pc.setRemoteDescription(desc);
  for (let candidate of pendingCandidates) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (e) {
      if (!e.toString().includes('RTCIceCandidate')) {
        console.error('Failed to add ICE candidate:', e);
      }
    }
  }
  pendingCandidates = [];
}

async function startWebRTC(targetUserId) {
  await startLocalStream();
  createPeerConnection();

  try {
    isMakingOffer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtcOffer', { targetUserId, offer: pc.localDescription });
  } catch (err) {
    console.error('Error creating offer:', err);
  } finally {
    isMakingOffer = false;
  }
}

socket.on('webrtcOffer', async ({ fromUserId, offer }) => {
  const offerCollision = isMakingOffer || pc?.signalingState !== 'stable';
  isIgnoringOffer = !polite && offerCollision;
  if (isIgnoringOffer) {
    console.log('Ignoring offer due to collision');
    return;
  }

  connectedUserId = fromUserId;
  await startLocalStream();
  createPeerConnection();

  try {
    await setRemoteDesc(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtcAnswer', { targetUserId: fromUserId, answer: pc.localDescription });
  } catch (err) {
    console.error('Error handling offer:', err);
  }
});

socket.on('webrtcAnswer', async ({ answer }) => {
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (err) {
    console.error('Error setting remote description for answer:', err);
  }
});

socket.on('webrtcCandidate', async ({ candidate }) => {
  try {
    const iceCandidate = new RTCIceCandidate(candidate);
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      await pc.addIceCandidate(iceCandidate);
    } else {
      pendingCandidates.push(iceCandidate);
    }
  } catch (err) {
    console.error('Error adding ICE candidate:', err);
  }
});

function cleanupConnection() {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  connectedUserId = null;
  releaseMicBtn.disabled = true;

  const remoteAudio = document.getElementById('remoteAudio');
  if (remoteAudio) {
    remoteAudio.srcObject = null;
    remoteAudio.remove();
  }
}
