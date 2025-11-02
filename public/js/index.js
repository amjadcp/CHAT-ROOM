/**
 * Voice Chat Client - Main Entry Point
 * 
 * This is the ONLY file imported in HTML
 * All other modules are imported here
 */

import { requestInitialPermissions } from './permissions/audio-permissions.js';
import { setupSocketHandlers } from './socket/socket-handlers.js';
import { setupUIHandlers } from './ui/ui-handlers.js';
import { setupTouchSupport } from './mobile/touch-support.js';
import { cleanupAllConnections } from './webrtc/peer-connection.js';

/**
 * Initialize Socket.io connection
 * Socket.io connects this client to the signaling server
 * In WebRTC, signaling is used to exchange connection information between peers
 */
const socket = io();


// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================
/**
 * Initializes the application on page load
 * Request permissions immediately on app load
 * Sets up all event listeners and socket handlers
 */
async function init() {
  console.log('🚀 Initializing Voice Chat Application...');
  
  // Step 1: Request audio permissions (shows browser prompt)
  await requestInitialPermissions();
  
  // Step 2: Join the server
  socket.emit('join'); // Request user ID from server
  
  // Step 3: Setup event handlers
  setupSocketHandlers(socket); // Listen for signaling messages
  setupUIHandlers(socket); // Setup button clicks, drag/drop
  setupTouchSupport(socket); // Enable mobile touch interactions
  
  // Step 4: Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    cleanupAllConnections();
    socket.emit('leaveRoom');
  });
  
  console.log('✅ Application initialized successfully');
}

// Start the application
init();