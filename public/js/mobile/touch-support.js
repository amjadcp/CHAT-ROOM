import { state } from '../state/app-state.js';

/**
 * Sets up touch support for mobile devices
 *
 * Mobile Touch Challenges:
 * - Drag-and-drop API doesn't work on touch screens
 * - Need to handle touchstart, touchmove, touchend manually
 * - Must create visual feedback (dragged element clone)
 * - Must detect when touch is over drop zone
 */
export function setupTouchSupport(socket) {
  // Global touch move and end handlers
  // These track the drag across the entire screen
  document.addEventListener('touchmove', (e) => handleTouchMove(e, socket), { passive: false });
  document.addEventListener('touchend', (e) => handleTouchEnd(e, socket));
  document.addEventListener('touchcancel', (e) => handleTouchEnd(e, socket));
}

/**
 * Handles touch start on a user element
 * Initiates the drag operation
 *
 * @param {TouchEvent} e - Touch event
 * @param {string} userId - User being dragged
 * @param {HTMLElement} element - Element being dragged
 */
export function handleTouchStart(e, userId, element) {
  // Check if user is engaged (can't drag engaged users)
  if (element.classList.contains('engaged')) return;
  
  e.preventDefault();
  
  const touch = e.touches[0];
  
  state.touchDragState = {
    active: true,
    userId: userId,
    element: element,
    clone: null,
    startX: touch.clientX,
    startY: touch.clientY,
    currentX: touch.clientX,
    currentY: touch.clientY
  };
  
  /**
   * Create Visual Clone
   *
   * On touch devices, we need to show what's being dragged
   * Create a clone of the element that follows the finger
   */
  const clone = element.cloneNode(true);
  clone.classList.add('touch-dragging');
  clone.style.cssText = `
    position: fixed;
    width: ${element.offsetWidth}px;
    left: ${touch.clientX - (element.offsetWidth / 2)}px;
    top: ${touch.clientY - 20}px;
    pointer-events: none;
    z-index: 10000;
    opacity: 0.8;
  `;
  document.body.appendChild(clone);
  
  state.touchDragState.clone = clone;

  // Add visual feedback to original element
  element.style.opacity = '0.3';
  
  // Show touch indicator (visual hint of drag)
  const indicator = document.getElementById('touchIndicator');
  if (indicator) {
    indicator.classList.add('active');
    indicator.style.left = touch.clientX + 'px';
    indicator.style.top = touch.clientY + 'px';
  }
}

/**
 * Handles touch move during drag
 * Updates clone position and checks for drop zone
 *
 * @param {TouchEvent} e - Touch event
 */
function handleTouchMove(e, socket) {
  if (!state.touchDragState.active) return;
  
  // Prevent scrolling while dragging
  e.preventDefault();
  
  const touch = e.touches[0];
  state.touchDragState.currentX = touch.clientX;
  state.touchDragState.currentY = touch.clientY;
  
  // Move the visual clone to follow finger
  if (state.touchDragState.clone) {
    state.touchDragState.clone.style.left = touch.clientX - (state.touchDragState.clone.offsetWidth / 2) + 'px';
    state.touchDragState.clone.style.top = touch.clientY - 20 + 'px';
  }
  
  // Update touch indicator position
  const indicator = document.getElementById('touchIndicator');
  if (indicator) {
    indicator.style.left = touch.clientX + 'px';
    indicator.style.top = touch.clientY + 'px';
  }
  
  /**
   * Check if Over Drop Zone
   *
   * Detect if the finger is over the "My Room" drop zone
   * Provide visual feedback by adding CSS class
   */
  const dropZone = document.getElementById('myRoom');
  const rect = dropZone.getBoundingClientRect();
  
  if (touch.clientX >= rect.left && 
      touch.clientX <= rect.right && 
      touch.clientY >= rect.top && 
      touch.clientY <= rect.bottom) {
    dropZone.classList.add('touch-dragover');
  } else {
    dropZone.classList.remove('touch-dragover');
  }
}

/**
 * Handles touch end - completes or cancels the drag
 * Checks if user was dropped in the room zone
 *
 * @param {TouchEvent} e - Touch event
 */
function handleTouchEnd(e, socket) {
  if (!state.touchDragState.active) return;
  
  const touch = e.changedTouches[0];
  
  /**
   * Check if Dropped in Room
   *
   * If the finger was released over the drop zone,
   * add the user to the room
   */
  const dropZone = document.getElementById('myRoom');
  const rect = dropZone.getBoundingClientRect();
  
  if (touch.clientX >= rect.left && 
      touch.clientX <= rect.right && 
      touch.clientY >= rect.top && 
      touch.clientY <= rect.bottom) {
    
    const userId = state.touchDragState.userId;
    if (userId && userId !== state.currentUserId && !state.myRoom.has(userId)) {
      socket.emit('addUserToRoom', userId);
    }
  }
  
  // Cleanup
  if (state.touchDragState.clone) {
    state.touchDragState.clone.remove();
  }
  
  if (state.touchDragState.element) {
    state.touchDragState.element.style.opacity = '';
  }
  
  dropZone.classList.remove('touch-dragover');
  
  // Hide touch indicator
  const indicator = document.getElementById('touchIndicator');
  if (indicator) {
    indicator.classList.remove('active');
  }
  
   // Reset touch drag state
  state.touchDragState = {
    active: false,
    userId: null,
    element: null,
    clone: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0
  };
}