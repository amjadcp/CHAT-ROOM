/**
 * Peer Connection Management
 */

// ============================================================================
// WEBRTC CORE - PEER CONNECTION CREATION
// ============================================================================

import { state } from '../state/app-state.js';
import { iceServersConfig } from '../config/webrtc-config.js';
import { handleRemoteTrack } from './media-manager.js';
import { createAndSendOffer } from './signaling.js';

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
export async function createPeerConnectionForUser(userId, shouldOffer, socket) {
  if (state.peerConnections[userId]) {
    console.log("Peer connection already exists for:", userId);
    return;
  }

  console.log(
    "=== Creating peer connection for:",
    userId,
    "shouldOffer:",
    shouldOffer,
    "==="
  );
  
  // Create new peer connection with ICE servers
  const pc = new RTCPeerConnection(iceServersConfig);
  state.peerConnections[userId] = pc;
  state.pendingCandidates[userId] = [];

  // Add local tracks if available
  if (state.localStream && state.isLocalMicEnabled) {
    state.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, state.localStream);
      console.log(
        "Added track:",
        track.kind,
        "label:",
        track.label,
        "enabled:",
        track.enabled
      );
    });
  }else {
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
      socket.emit("webrtcCandidate", {
        targetUserId: userId,
        candidate,
      });
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
    console.log(`ICE state for ${userId}:`, pc.iceConnectionState);
    if (["failed", "disconnected", "closed"].includes(pc.iceConnectionState)) {
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

  // Create initial offer if initiator
  if (shouldOffer) {
    await createAndSendOffer(userId, socket);
  }else {
    console.log("Waiting for offer from:", userId);
  }
}

/**
 * Closes a peer connection and cleans up resources
 *
 * @param {string} userId - The user whose connection to close
 */
export function closePeerConnection(userId) {
  const pc = state.peerConnections[userId];
  if (pc) {
    console.log("Closing peer connection for:", userId);
    try {
      pc.close();
    } catch (e) {
      console.warn("Error closing:", e);
    }
    
    delete state.peerConnections[userId];
    delete state.pendingCandidates[userId];
  }
  
  const audioEl = document.getElementById(`audio-${userId}`);
  if (audioEl) audioEl.remove();
}

/**
 * Closes all peer connections and releases resources
 * Called when leaving room or on page unload
 */
export function cleanupAllConnections() {
  for (const userId of Object.keys(state.peerConnections)) {
    closePeerConnection(userId);
  }
  
  state.myRoom.clear();
  
  // Stop local media stream
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = null;
    state.isLocalMicEnabled = false;
  }
}