import { state } from '../state/app-state.js';
import { updateRoomDisplay } from './room-display.js';
import { handleTouchStart } from '../mobile/touch-support.js';

/**
 * Renders the list of available users
 * Shows their status (available/engaged) and microphone state
 * Enables drag-and-drop functionality for desktop
 * Enables touch interactions for mobile
 */
export function renderUserList(users, socket) {
  const userNameEl = document.getElementById('username');
  const usersList = document.getElementById('usersList');
  
  userNameEl.innerText = `Welcome, ${state.currentUserName}`;
  usersList.innerHTML = "";

  users.forEach((u) => {
    // Skip current user
    if (u._id === state.currentUserId) return;

    const li = document.createElement("li");
    li.setAttribute("data-userid", u._id);
    li.setAttribute("draggable", "true");
    li.className = "user-item";
    
    // Check if user is engaged (in someone's room)
    const isEngaged = u.inRoom !== null;
    if (isEngaged) {
      li.classList.add("engaged");
    }

    // User name
    const nameSpan = document.createElement("span");
    nameSpan.className = "user-name";
    nameSpan.textContent = u.name;
    li.appendChild(nameSpan);

    // Status
    const statusSpan = document.createElement("span");
    statusSpan.className = "status";
    statusSpan.textContent = isEngaged ? "(Engaged)" : "(Available)";
    li.appendChild(statusSpan);

    // Mic status
    const micSpan = document.createElement("span");
    micSpan.className = "micStatus";
    const micOn = state.userMicStates[u._id] ?? false;
    if (isEngaged) {
      micSpan.textContent = micOn ? "🎤" : "🔇";
    }
    li.appendChild(micSpan);

    // Desktop drag handlers
    li.addEventListener("dragstart", (e) => {
      if (isEngaged) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData("userId", u._id);
      li.classList.add("dragging");
    });

    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
    });

    // Mobile touch handlers
    if (!isEngaged) {
      let touchStartTime;
      
      li.addEventListener("touchstart", (e) => {
        touchStartTime = Date.now();
        li.dataset.touchStartTime = touchStartTime;
        
        // Start drag after a short delay
        setTimeout(() => {
          if (li.dataset.touchStartTime === touchStartTime.toString()) {
            handleTouchStart(e, u._id, li);
          }
        }, 200);
      });
      
      // Also support simple tap to add
      li.addEventListener("click", (e) => {
        if (!state.touchDragState.active && window.innerWidth <= 768) {
          console.log("Click/tap to add user:", u._id);
          socket.emit("addUserToRoom", u._id);
        }
      });
    }

    usersList.appendChild(li);
  });

  updateRoomDisplay(socket);
}