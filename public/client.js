const socket = io();
let connectedUserId = null;
const usersList = document.getElementById('usersList');
const userName = document.getElementById('username');
const releaseMicBtn = document.getElementById('releaseMicBtn');

let localStream = null;
let pc = null;

// Perfect negotiation state flags
let isMakingOffer = false;
let isIgnoringOffer = false;

// Assign roles for glare handling, true means polite peer
const polite = true;

let pendingCandidates = [];

const iceServersConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ]
};

let currentUserId = localStorage.getItem('userId');
let currentUserName = localStorage.getItem('userName');

if (currentUserId) {
  socket.emit('rejoin', currentUserId);
} else {
  socket.emit('join');
}
socket.on('userCreated', (userId, userName) => {
  localStorage.setItem('userId', userId);
  localStorage.setItem('userName', userName);
  currentUserId = userId;
  currentUserName = userName;
});

releaseMicBtn.addEventListener('click', () => {
  if (connectedUserId) {
    socket.emit('releaseMic');
    cleanupConnection();
  }
});

socket.on('userListUpdate', (users) => {
  userName.innerText = `Welcome, ${currentUserName}`;
  usersList.innerHTML = '';
  users.forEach(u => {
    const li = document.createElement('li');
    li.setAttribute('data-userid', u._id);
    li.appendChild(document.createTextNode(u.name + ' '));

    const micBtn = document.createElement('button');
    micBtn.textContent = '🎤';
    micBtn.className = 'micBtn';

    micBtn.disabled = !!connectedUserId || u.engagedWith !== null || u._id === currentUserId;
    micBtn.onclick = () => {
      if (connectedUserId) {
        return alert('Already engaged in a conversation.');
      }
      if (u.engagedWith) {
        return alert('User is engaged.');
      }
      if (u._id === currentUserId) {
        return alert('Cannot talk to yourself.');
      }
      socket.emit('toggleMic', u._id);
    };

    li.appendChild(micBtn);

    const statusSpan = document.createElement('span');
    statusSpan.className = 'status';
    statusSpan.textContent = u.engagedWith ? 'Engaged' : 'Available';
    if (u.engagedWith) li.classList.add('engaged');
    li.appendChild(statusSpan);

    usersList.appendChild(li);
  });
});

socket.on('micToggled', async ({ engagedWith }) => {
  connectedUserId = engagedWith;
  releaseMicBtn.disabled = false;
  await startWebRTC(engagedWith);
});

socket.on('micReleased', () => {
  cleanupConnection();
});

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
  if (pc) return;

  pc = new RTCPeerConnection(iceServersConfig);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtcCandidate', { targetUserId: connectedUserId, candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    let remoteAudio = document.getElementById('remoteAudio');
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.id = 'remoteAudio';
      remoteAudio.autoplay = true;
      document.body.appendChild(remoteAudio);
    }
    remoteAudio.srcObject = event.streams[0];
  };

  // Perfect negotiation pattern handler
  pc.onnegotiationneeded = async () => {
    try {
      isMakingOffer = true;
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.signalingState === 'stable') {
        socket.emit('webrtcOffer', { targetUserId: connectedUserId, offer: pc.localDescription });
      }
    } catch (err) {
      console.error('Error during negotiation:', err);
    } finally {
      isMakingOffer = false;
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      cleanupConnection();
    }
  };
}

async function setRemoteDesc(desc) {
  try {
    // Handle rollback if necessary per perfect negotiation spec
    if (desc.type === 'offer' && (pc.signalingState !== 'stable')) {
      await pc.setRemoteDescription({ type: 'rollback' });
    }
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
  } catch (err) {
    console.error('Failed setting remote description:', err);
  }
}

async function startWebRTC(targetUserId) {
  await startLocalStream();
  createPeerConnection();

  try {
    isMakingOffer = true;
    await pc.setLocalDescription(await pc.createOffer());
    socket.emit('webrtcOffer', { targetUserId, offer: pc.localDescription });
  } catch (err) {
    console.error('Error creating offer:', err);
  } finally {
    isMakingOffer = false;
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

socket.on('webrtcOffer', async ({ fromUserId, offer }) => {
  const offerCollision = isMakingOffer || pc?.signalingState !== 'stable';
  isIgnoringOffer = !polite && offerCollision;
  if (isIgnoringOffer) return;

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
    console.error('Error setting remote description:', err);
  }
});

socket.on('webrtcCandidate', async ({ candidate }) => {
  try {
    const iceCandidate = new RTCIceCandidate(candidate);
    if (pc && pc.remoteDescription && pc.remoteDescription.type && candidateMatchesSDP(iceCandidate)) {
      await pc.addIceCandidate(iceCandidate);
    } else {
      pendingCandidates.push(iceCandidate);
    }
  } catch (err) {
    if (!err.message.includes('Unknown ufrag')) {
      console.error('Error adding ICE candidate:', err);
    }
  }
});

function cleanupConnection() {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
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
