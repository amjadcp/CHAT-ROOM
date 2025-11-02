import { state } from '../state/app-state.js';

/**
 * Updates the "My Room" section showing current participants
 * Displays microphone status for each user
 * Provides remove buttons for each participant
 */
export function updateRoomDisplay(socket) {
  const myRoomEl = document.getElementById('myRoom');
  const leaveRoomBtn = document.getElementById('leaveRoom');
  
  myRoomEl.innerHTML = "<h3>Chat Room (Drop users here)</h3>";
  
  if (state.myRoom.size === 0) {
    const emptyMsg = document.createElement("p");
    emptyMsg.textContent = "Drag users here to start a group chat";
    emptyMsg.className = "empty-room-msg";
    myRoomEl.appendChild(emptyMsg);
  } else {
    state.myRoom.forEach((userId) => {
      const userDiv = document.createElement("div");
      userDiv.className = "room-user";
      userDiv.setAttribute("data-userid", userId);
      
      // Find user name from the user list or use stored info
      const userLi = document.querySelector(`li[data-userid="${userId}"]`);
      const userName = userLi ? userLi.querySelector("span").textContent : "User";
      
      userDiv.textContent = userName;
      
      const micOn = state.userMicStates[userId] ?? false;
      const micIcon = document.createElement("span");
      micIcon.textContent = micOn ? " 🎤" : " 🔇";
      userDiv.appendChild(micIcon);
      
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "✕";
      removeBtn.className = "remove-user-btn";
      removeBtn.onclick = () => removeUserFromRoom(userId, socket);
      userDiv.appendChild(removeBtn);
      
      myRoomEl.appendChild(userDiv);
    });
  }
  
  // Update leave button state
  leaveRoomBtn.disabled = state.myRoom.size === 0;
}

/**
 * Removes a specific user from the room
 */
export function removeUserFromRoom(userId, socket) {
  console.log("Removing user from room:", userId);
  socket.emit("removeUserFromRoom", userId);
}

/**
 * Leaves the current room (removes all users)
 */
export function leaveRoom(socket) {
  console.log("Leaving room");
  socket.emit("leaveRoom");
}