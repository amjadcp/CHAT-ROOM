import { state } from '../state/app-state.js';
import { AUDIO_CONSTRAINTS } from '../config/webrtc-config.js';
import { createAndSendOffer } from './signaling.js';
import { showSimpleNotification } from '../ui/notifications.js';
import { updateLocalMicButton } from '../ui/ui-handlers.js';

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
 *
 * Our Permission Strategy:
 * 1. Request microphone permission on app load (shows browser prompt)
 * 2. Keep stream active but tracks DISABLED (user not transmitting)
 * 3. When user clicks "Unmute", enable existing tracks (no new prompt)
 * 4. When user clicks "Mute", disable tracks (keep permission)
 * 5. This allows instant mute/unmute without repeated permission prompts
 */

/**
 * Enables local microphone and adds audio track to all peer connections
 *
 * Process:
 * 1. Check if we have existing stream from app load
 * 2. If yes: Simply enable tracks (track.enabled = true)
 * 3. If no: Request new stream via getUserMedia (fallback)
 * 4. Add audio tracks to all existing peer connections
 * 5. Trigger renegotiation if needed (new offer/answer exchange)
 *
 * Track States:
 * - track.enabled = false: Microphone active but not transmitting (muted)
 * - track.enabled = true: Microphone transmitting audio to peers (unmuted)
 * - track.stop(): Releases microphone hardware (requires new permission)
 */
export async function enableLocalMicrophone(socket) {
  try {
    // If we already have stream from initial request, just enable it
    if (state.localStream) {
      console.log('Enabling pre-requested microphone');
      state.localStream.getTracks().forEach(track => {
        track.enabled = true;
      });
    } else {
      // Fallback: request new stream
      console.log('Requesting new microphone stream');
      const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
      state.localStream = stream;
    }
    
    state.isLocalMicEnabled = true;
    socket.emit("micStateChanged", { userId: state.currentUserId, micOn: true });
    state.userMicStates[state.currentUserId] = true;
    updateLocalMicButton();

    // Add tracks to existing peer connections
    for (const [userId, pc] of Object.entries(state.peerConnections)) {
      state.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, state.localStream);
      });
      
      if (pc.signalingState === "stable") {
        await createAndSendOffer(userId, socket);
      }
    }
  } catch (err) {
    console.error("Mic error:", err);
    showSimpleNotification("Microphone error: " + err.message, 'error');
  }
}

/**
 * Disables local microphone (mutes without releasing permission)
 *
 * Process:
 * 1. Disable all tracks (not stop) - user stops transmitting
 * 2. Remove tracks from peer connections (stops sending to peers)
 * 3. Keep localStream reference (maintains permission)
 * 4. Update UI to show muted state
 * 5. Notify server of mic state change
 */
export function disableLocalMicrophone(socket) {
  if (state.localStream) {
    // Disable instead of stopping (keeps permission for quick re-enable)
    state.localStream.getTracks().forEach((track) => {
      track.enabled = false;
    });

    // Remove tracks from peer connections
    for (const pc of Object.values(state.peerConnections)) {
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
  }
  
  state.isLocalMicEnabled = false;
  socket.emit("micStateChanged", { userId: state.currentUserId, micOn: false });
  state.userMicStates[state.currentUserId] = false;
  updateLocalMicButton();
}

// ============================================================================
// MEDIA MANAGEMENT - REMOTE AUDIO
// ============================================================================
/**
 * Handles incoming audio track from remote peer
 *
 * WebRTC Track Event:
 * - Fired when remote peer adds a track via pc.addTrack()
 * - Contains MediaStreamTrack and MediaStream objects
 * - We attach the stream to an <audio> element for playback
 *
 * How it works:
 * 1. Remote peer's mic → encrypted transmission → our peer connection
 * 2. ontrack event fires with the audio stream
 * 3. Create/reuse <audio> element with unique ID per user
 * 4. Set audioEl.srcObject = event.streams[0]
 * 5. Browser decodes and plays audio automatically
 *
 * Browser Autoplay Policy:
 * - Modern browsers block autoplay without user interaction
 * - Our solution: Request mic permission on page load
 * - This unblocks autoplay for the entire session
 * - Audio plays automatically when remote peer speaks
 * - Fallback prompt shown if autoplay still blocked (rare)
 *
 * @param {RTCTrackEvent} event - Track event containing remote audio stream
 * @param {string} userId - ID of remote user sending audio
 */
export function handleRemoteTrack(event, userId) {
  console.log("=== Remote track received from:", userId, "===");
  
  let audioEl = document.getElementById(`audio-${userId}`);
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.id = `audio-${userId}`;
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.controls = false;
    audioEl.volume = 1.0;
    
    const container = document.getElementById('remoteAudioContainer');
    container.appendChild(audioEl);
  }
  
  if (event.streams && event.streams[0]) {
    audioEl.srcObject = event.streams[0];
    
    audioEl.play()
      .then(() => console.log("✅ Audio playing for:", userId))
      .catch(err => {
        console.error("❌ Autoplay blocked:", err);
        showAudioBlockedPrompt(userId);
      });
  }
}

function showAudioBlockedPrompt(userId) {
  showSimpleNotification('Click to enable audio from this user', 'warning', 5000);
}