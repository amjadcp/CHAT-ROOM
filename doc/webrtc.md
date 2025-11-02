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