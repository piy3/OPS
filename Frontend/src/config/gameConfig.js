/**
 * Game Configuration Constants
 * 
 * Position Update Rate Configuration:
 * 
 * CLIENT (Frontend):
 *   - Sends position updates at ~30fps (every 33ms)
 *   - Configured by POSITION_UPDATE_INTERVAL below
 * 
 * SERVER (Backend):
 *   - Accepts updates at ~30fps (every 30ms)
 *   - Slightly lower to account for network jitter
 *   - Server checks throttle FIRST before any heavy work
 * 
 * These values should be kept in sync with Backend/config/constants.js
 */

export const POSITION_CONFIG = {
    // How often to send position updates to server (ms)
    // 33ms = ~30fps - good balance of smoothness vs bandwidth
    UPDATE_INTERVAL: 33,
    
    // Minimum time since respawn before accepting position updates (ms)
    RESPAWN_COOLDOWN: 500,
};

export const GAME_CONFIG = {
    // Movement interpolation settings
    INTERPOLATION_SPEED: 0.15,
    
    // Grid/cell settings are calculated dynamically based on maze layout
};
