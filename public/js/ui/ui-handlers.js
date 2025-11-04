import {
  enableLocalMicrophone,
  disableLocalMicrophone,
} from "../webrtc/media-manager.js";
import { leaveRoom } from "./room-display.js";
import { state } from "../state/app-state.js";

// ============================================================================
// UI EVENT HANDLERS
// ============================================================================

/**
 * Sets up user interface interactions
 */
export function setupUIHandlers(socket) {
  const toggleLocalMicBtn = document.getElementById("toggleLocalMicBtn");
  const leaveRoomBtn = document.getElementById("leaveRoom");

  // Toggle local microphone on/off
  toggleLocalMicBtn.addEventListener("click", async () => {
    if (!state.isLocalMicEnabled) {
      await enableLocalMicrophone(socket);
    } else {
      disableLocalMicrophone(socket);
    }
  });

  // Leave room
  leaveRoomBtn.addEventListener("click", () => {
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
  const myRoomEl = document.getElementById("myRoom");

  // Visual feedback when dragging over the room
  myRoomEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    myRoomEl.classList.add("dragover");
  });

  myRoomEl.addEventListener("dragleave", () => {
    myRoomEl.classList.remove("dragover");
  });

  // Handle user drop
  myRoomEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    myRoomEl.classList.remove("dragover");

    const userId = e.dataTransfer.getData("userId");
    if (userId && userId !== state.currentUserId && !state.myRoom.has(userId)) {
      socket.emit("addUserToRoom", userId);
    }
  });
}

/**
 * Updates the microphone button appearance
 */
export function updateLocalMicButton() {
  const btn = document.getElementById("toggleLocalMicBtn");
  if (!btn) return;

  if (state.isLocalMicEnabled) {
    btn.classList.add("active");
    btn.innerHTML = `<svg class="w-[42px] h-[42px] text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="none" viewBox="0 0 24 24">
  <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9v3a5.006 5.006 0 0 1-5 5h-4a5.006 5.006 0 0 1-5-5V9m7 9v3m-3 0h6M11 3h2a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/>
</svg>
`;
  } else {
    btn.classList.remove("active");
    btn.innerHTML = `
    <svg class="w-[42px] h-[42px] text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="none" viewBox="0 0 24 24">
          <path fill="currentColor" d="M19.97 9.012a1 1 0 1 0-2 0h2Zm-1 2.988 1 .001V12h-1Zm-8.962 4.98-.001 1h.001v-1Zm-3.52-1.46.708-.708-.707.707ZM5.029 12h-1v.001l1-.001Zm3.984 7.963a1 1 0 1 0 0 2v-2Zm5.975 2a1 1 0 0 0 0-2v2ZM7.017 8.017a1 1 0 1 0 2 0h-2Zm6.641 4.862a1 1 0 1 0 .667 1.886l-.667-1.886Zm-7.63-2.87a1 1 0 1 0-2 0h2Zm9.953 5.435a1 1 0 1 0 1 1.731l-1-1.731ZM12 16.979h1a1 1 0 0 0-1-1v1ZM5.736 4.322a1 1 0 0 0-1.414 1.414l1.414-1.414Zm12.528 15.356a1 1 0 0 0 1.414-1.414l-1.414 1.414ZM17.97 9.012V12h2V9.012h-2Zm0 2.987a3.985 3.985 0 0 1-1.168 2.813l1.415 1.414a5.985 5.985 0 0 0 1.753-4.225l-2-.002Zm-7.962 3.98a3.985 3.985 0 0 1-2.813-1.167l-1.414 1.414a5.985 5.985 0 0 0 4.225 1.753l.002-2Zm-2.813-1.167a3.985 3.985 0 0 1-1.167-2.813l-2 .002a5.985 5.985 0 0 0 1.753 4.225l1.414-1.414Zm3.808-10.775h1.992v-2h-1.992v2Zm1.992 0c1.097 0 1.987.89 1.987 1.988h2a3.988 3.988 0 0 0-3.987-3.988v2Zm1.987 1.988v4.98h2v-4.98h-2Zm-5.967 0c0-1.098.89-1.988 1.988-1.988v-2a3.988 3.988 0 0 0-3.988 3.988h2Zm-.004 15.938H12v-2H9.012v2Zm2.988 0h2.987v-2H12v2ZM9.016 8.017V6.025h-2v1.992h2Zm5.967 2.987a1.99 1.99 0 0 1-1.325 1.875l.667 1.886a3.989 3.989 0 0 0 2.658-3.76h-2ZM6.03 12v-1.992h-2V12h2Zm10.774 2.812a3.92 3.92 0 0 1-.823.632l1.002 1.731a5.982 5.982 0 0 0 1.236-.949l-1.415-1.414ZM4.322 5.736l13.942 13.942 1.414-1.414L5.736 4.322 4.322 5.736ZM12 15.98h-1.992v2H12v-2Zm-1 1v3.984h2V16.98h-2Z"/>
    </svg>`;
  }
}
