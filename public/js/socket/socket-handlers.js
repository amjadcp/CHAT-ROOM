/**
 * Socket Event Handlers
 */

import { state } from '../state/app-state.js';
import { renderUserList } from '../ui/user-list.js';
import { updateRoomDisplay } from '../ui/room-display.js';
import { showSimpleNotification } from '../ui/notifications.js';
import { createPeerConnectionForUser, closePeerConnection } from '../webrtc/peer-connection.js';
import { handleOffer, handleAnswer, handleCandidate } from '../webrtc/signaling.js';

export function setupSocketHandlers(socket) {
  // User Management

  /**
   * Called when this user is created on the server
   * Stores user ID and name for future reference
   */
  socket.on('userCreated', (userId, name) => {
    console.log('User created:', userId, name);
    state.currentUserId = userId;
    state.currentUserName = userName;
  });
  
  socket.on('userListUpdate', (users) => {
    renderUserList(users, socket);
  });
  
  // Room Management

  /**
   * Called when a user is added to the room
   * Creates a peer connection with the new user
   *
   * @param {Object} params
   * @param {string} params.userId - The user being added
   * @param {boolean} params.initiator - Whether we should create the offer
   *
   * WebRTC Connection Initiation:
   * - Only ONE peer should create the initial offer
   * - The "initiator" flag determines who creates the offer
   * - This prevents both peers from creating offers simultaneously
   */
  socket.on('userAddedToRoom', async ({ userId, initiator }) => {
    console.log('User added to room:', userId, 'Initiator:', initiator);
    state.myRoom.add(userId);
    updateRoomDisplay(socket);

    // Create peer connection - initiator creates offer
    await createPeerConnectionForUser(userId, initiator, socket);
  });
  
  /**
   * Called when a user is removed from the room
   * Closes the peer connection and cleans up resources
   */
  socket.on('userRemovedFromRoom', ({ userId }) => {
    console.log('User removed from room:', userId);
    state.myRoom.delete(userId);
    closePeerConnection(userId);
    updateRoomDisplay(socket);
  });
  
  /**
   * Called when the room state is synchronized from server
   * Updates local room state to match server
   * Useful for handling disconnects/reconnects
   */
  socket.on('roomUpdated', ({ users }) => {
    console.log('Room updated with users:', users);
    
    // Update myRoom set
    const newRoomSet = new Set(users);
    
    // Remove users no longer in room
    for (const userId of state.myRoom) {
      if (!newRoomSet.has(userId)) {
        console.log("Removing user from room (room update):", userId);
        closePeerConnection(userId);
      }
    }
    
    // Update room set
    state.myRoom.clear();

    // Add new users
    users.forEach(userId => {
      if (userId !== state.currentUserId) {
        console.log("Adding user to room (room update):", userId);
        state.myRoom.add(userId);
      }
    });
    
    updateRoomDisplay(socket);
  });
  
  // Microphone State

  /**
   * Called when microphone state changes for any user
   * Updates UI to reflect current mic status
   */
  socket.on('micStateChanged', ({ userId, micOn }) => {
    console.log('Mic state changed:', userId, micOn);
    state.userMicStates[userId] = micOn;
    updateRoomDisplay(socket);
    
    // Update in user list if visible
    const li = document.querySelector(`li[data-userid='${userId}']`);
    if (li) {
      const micSpan = li.querySelector('.micStatus');
      if (micSpan) {
        micSpan.textContent = micOn ? ' 🎤' : ' 🔇';
      }
    }
  });
  
  // Error Handling
  socket.on('userBusy', ({ userId, message }) => {
    console.log('User is busy:', userId, message);
    showSimpleNotification(message, 'warning');
  });
  
  socket.on('error', ({ message }) => {
    console.error('Server error:', message);
    showSimpleNotification(message, 'error');
  });
  
  // WebRTC Signaling Events (the core of peer connection establishment)
  socket.on('webrtcOffer', (data) => handleOffer(data, socket)); // Receive SDP offer
  socket.on('webrtcAnswer', (data) => handleAnswer(data, socket)); // Receive SDP answer
  socket.on('webrtcCandidate', (data) => handleCandidate(data, socket)); // Receive ICE candidate
}