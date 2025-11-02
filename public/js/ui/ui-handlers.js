import { enableLocalMicrophone, disableLocalMicrophone } from '../webrtc/media-manager.js';
import { leaveRoom } from './room-display.js';
import { state } from '../state/app-state.js';

// ============================================================================
// UI EVENT HANDLERS
// ============================================================================

/**
 * Sets up user interface interactions
 */
export function setupUIHandlers(socket) {
  const toggleLocalMicBtn = document.getElementById('toggleLocalMicBtn');
  const leaveRoomBtn = document.getElementById('leaveRoom');
  
  // Toggle local microphone on/off
  toggleLocalMicBtn.addEventListener('click', async () => {
    if (!state.isLocalMicEnabled) {
      await enableLocalMicrophone(socket);
    } else {
      disableLocalMicrophone(socket);
    }
  });
  
  // Leave room
  leaveRoomBtn.addEventListener('click', () => {
    leaveRoom(socket);
  });
  
  // Setup drag-and-drop area for adding users to room
  setupDropZone(socket);
}

/**
 * Configures the "My Room" area as a drop zone for dragging users
 * Allows desktop users to drag/drop users into voice chat
 */
function setupDropZone(socket) {
  const myRoomEl = document.getElementById('myRoom');
  
  // Visual feedback when dragging over the room
  myRoomEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    myRoomEl.classList.add('dragover');
  });
  
  myRoomEl.addEventListener('dragleave', () => {
    myRoomEl.classList.remove('dragover');
  });
  
  // Handle user drop
  myRoomEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    myRoomEl.classList.remove('dragover');
    
    const userId = e.dataTransfer.getData('userId');
    if (userId && userId !== state.currentUserId && !state.myRoom.has(userId)) {
      socket.emit('addUserToRoom', userId);
    }
  });
}