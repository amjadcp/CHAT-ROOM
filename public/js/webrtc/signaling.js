// ============================================================================
// WebRTC - SIGNALING
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

import { state } from '../state/app-state.js';
import { createPeerConnectionForUser } from './peer-connection.js';

/**
 * Creates and sends a new offer to a peer
 * Used for renegotiation when media tracks change
 *
 * SDP (Session Description Protocol):
 * - Text format describing media capabilities
 * - Includes codecs, formats, transport addresses
 * - Exchanged via offer/answer model
 */
export async function createAndSendOffer(userId, socket) {
  const pc = state.peerConnections[userId];
  if (!pc) return;
  
  try {
    const offer = await pc.createOffer({ 
      offerToReceiveAudio: true, // We want to receive audio
      offerToReceiveVideo: false, // We don't need video
     });
    await pc.setLocalDescription(offer);

    console.log("Sending offer to:", userId);
    // Send offer through signaling server
    socket.emit("webrtcOffer", {
      targetUserId: userId,
      offer: pc.localDescription,
    });
  } catch (err) {
    console.error("Error creating offer:", err);
  }
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
export async function handleOffer({ fromUserId, offer }, socket) {
  console.log("=== Received offer from:", fromUserId, "===");
  console.log("Offer type:", offer.type);
  
  // Create peer connection if it doesn't exist
  if (!state.peerConnections[fromUserId]) {
    await createPeerConnectionForUser(fromUserId, false, socket);
  }
  
  const pc = state.peerConnections[fromUserId];
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
export async function handleAnswer({ fromUserId, answer }, socket) {
  console.log("=== Received answer from:", fromUserId, "===");
  console.log("Answer type:", answer.type);
  
  const pc = state.peerConnections[fromUserId];
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
export async function handleCandidate({ fromUserId, candidate }, socket) {
  console.log("Received ICE candidate from:", fromUserId);

  const pc = state.peerConnections[fromUserId];
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
      if (!state.pendingCandidates[fromUserId]) {
        state.pendingCandidates[fromUserId] = [];
      }
      state.pendingCandidates[fromUserId].push(iceCandidate);
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
  const pc = state.peerConnections[userId];
  const candidates = state.pendingCandidates[userId] || [];
  
  if (candidates.length > 0) {
    console.log(`Processing ${candidates.length} pending candidates for:`, userId);
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error("Error adding pending candidate:", err);
      }
    }
    state.pendingCandidates[userId] = [];
  }
}