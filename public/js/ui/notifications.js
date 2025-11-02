/**
 * UI Notifications
 */

export function showSimpleNotification(message, type = 'info', duration = 3000) {
  const existing = document.getElementById('simple-notification');
  if (existing) existing.remove();
  
  const notification = document.createElement('div');
  notification.id = 'simple-notification';
  notification.textContent = message;
  
  const colors = {
    info: '#2196F3',
    warning: '#ff9800',
    error: '#f44336',
    success: '#4CAF50'
  };
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${colors[type]};
    color: white;
    padding: 15px 25px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
    max-width: 500px;
    text-align: center;
    font-size: 14px;
    line-height: 1.4;
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s';
    setTimeout(() => notification.remove(), 300);
  }, duration);
}