import { state } from '../state/app-state.js';
import { AUDIO_CONSTRAINTS } from '../config/webrtc-config.js';
import { showSimpleNotification } from '../ui/notifications.js';

/**
 * Requests microphone permission when app loads
 *
 * 1. Browser shows native "Allow microphone?" prompt
 * 2. User clicks "Allow" (this counts as user interaction)
 * 3. This unblocks audio autoplay for the entire session
 * 4. Remote audio can now play automatically
 *
 */
export async function requestInitialPermissions() {
  if (state.permissionRequested) return;
  state.permissionRequested = true;
  
  try {
    console.log('Requesting microphone permission...');
    
    const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
    console.log('✅ Microphone permission granted');
    
    // Store the stream
    state.localStream = stream;
    
    // Keep tracks DISABLED by default (user isn't transmitting yet)
    stream.getTracks().forEach(track => {
      track.enabled = false;
    });
    
    // Initialize audio playback (critical for autoplay)
    await initializeAudioPlayback();
    console.log('✅ Audio system initialized');
    
  } catch (error) {
    console.error('❌ Permission error:', error);
    handlePermissionError(error);
  }
}

/**
 * Initializes Web Audio API to unblock autoplay
 *
 * CRITICAL for solving the autoplay issue:
 * - Creating AudioContext during permission grant unblocks audio
 * - This allows remote audio elements to autoplay later
 * - Without this, incoming audio will be blocked
 */
async function initializeAudioPlayback() {
  try {
    // Create AudioContext (this unblocks autoplay)
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();
    
    // Resume if suspended
    if (state.audioContext.state === 'suspended') {
      await state.audioContext.resume();
    }
    
    console.log("AudioContext state:", audioContext.state);

    // Play silent audio to fully unlock (browser quirk)
    await playUnlockSound();
  } catch (error) {
    console.error('Audio initialization error:', error);
  }
}

/**
 * Plays a brief silent sound to unlock audio
 *
 * Browser Quirk:
 * Some browsers need actual audio playback to fully unlock
 * This "primes" the audio system for future autoplay
 */
function playUnlockSound() {
  return new Promise((resolve) => {
    if (!state.audioContext) {
      resolve();
      return;
    }
    
    try {
      // Create silent oscillator
      const oscillator = state.audioContext.createOscillator();
      const gainNode = state.audioContext.createGain();
      
      gainNode.gain.value = 0.001; // Nearly silent
      oscillator.connect(gainNode);
      gainNode.connect(state.audioContext.destination);
      
      oscillator.start(0);
      
      setTimeout(() => {
        oscillator.stop();
        console.log("Audio unlocked");
        resolve();
      }, 100);
    } catch (e) {
      console.warn("Silent sound failed:", e);
      resolve();
    }
  });
}

function handlePermissionError(error) {
  if (error.name === 'NotAllowedError') {
    showSimpleNotification(
      '🎤 Microphone access denied. You can listen but won\'t be able to speak.',
      'warning',
      8000
    );
  } else if (error.name === 'NotFoundError') {
    showSimpleNotification(
      '🎤 No microphone found. You can still listen to others.',
      'info',
      5000
    );
  }
}