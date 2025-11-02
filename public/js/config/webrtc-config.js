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

export const iceServersConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

export const AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
};