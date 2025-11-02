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

export const state = {
  // User Identity
  currentUserId: null, // This user's unique ID from server
  currentUserName: null,  // This user's display name

  // Media State
  localStream: null, // MediaStream from getUserMedia (local microphone)
  isLocalMicEnabled: false, // Whether local mic is currently active

  // WebRTC State

  // Each remote user needs their own peer connection
  peerConnections: {}, // Map: userId -> RTCPeerConnection

  // ICE candidates may arrive before remote description is set
  // They must be queued and applied later
  pendingCandidates: {}, // Map: userId -> [ICE candidates]

  // Room State
  myRoom: new Set(), // Set of userIds currently in voice chat with me
  userMicStates: {}, // Map: userId -> boolean (mic on/off status)

  // Permission State
  audioContext: null, // Web Audio API context for unblocking autoplay
  permissionRequested: false, // Track if we've requested permission

  /**
   * Touch Drag State
   *
   * Tracks state for touch-based drag-and-drop on mobile devices
   * Native drag-and-drop doesn't work well on touch screens
   * We implement custom touch handling for mobile
   */
  touchDragState: {
    active: false, // Whether a touch drag is in progress
    userId: null, // User being dragged
    element: null, // Original element being dragged
    clone: null, // Visual clone following finger
    startX: 0, // Touch start X coordinate
    startY: 0, // Touch start Y coordinate
    currentX: 0, // Current touch X coordinate
    currentY: 0, // Current touch Y coordinate
  },
};

