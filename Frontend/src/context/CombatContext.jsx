/**
 * Combat Context - Handles health, coins, powerups, and knockback
 * Changes frequently during gameplay
 */

import { createContext, useContext, useState, useMemo, useRef, useEffect } from 'react';

// Player state constants (matching backend)
export const PLAYER_STATE = {
  ACTIVE: 'active',
  FROZEN: 'frozen',
  IMMUNE: 'immune',
  IN_IFRAMES: 'in_iframes'
};

// Combat config constants (matching backend)
export const COMBAT_CONFIG = {
  MAX_HEALTH: 100,
  IFRAME_DURATION: 3000,
  FREEZE_DURATION: 5000
};

const CombatContext = createContext(null);

export const useCombat = () => {
  const context = useContext(CombatContext);
  if (!context) {
    throw new Error('useCombat must be used within a CombatProvider');
  }
  return context;
};

export const CombatProvider = ({ children }) => {
  // Combat System state
  const [playersHealth, setPlayersHealth] = useState({}); // { playerId: { health, maxHealth, state, inIFrames } }
  const [hitNotification, setHitNotification] = useState(null); // { attackerName, victimName, damage }
  const [myPlayerState, setMyPlayerState] = useState(PLAYER_STATE.ACTIVE);
  const [myHealth, setMyHealth] = useState(COMBAT_CONFIG.MAX_HEALTH);
  const [inIFrames, setInIFrames] = useState(false);

  // Coin & Powerup state
  const [coins, setCoins] = useState([]); // [{ id, row, col }]
  const [powerups, setPowerups] = useState([]); // [{ id, row, col, type }]
  const [coinCollectNotification, setCoinCollectNotification] = useState(null);
  const [powerupCollectNotification, setPowerupCollectNotification] = useState(null);
  const [isImmune, setIsImmune] = useState(false);
  const [immunePlayers, setImmunePlayers] = useState(new Set()); // Set of player IDs with immunity
  const powerupNotificationTimeoutRef = useRef(null);

  // Knockback state
  const [knockbackActive, setKnockbackActive] = useState(false); // Is local player being knocked back
  const [knockbackPlayers, setKnockbackPlayers] = useState(new Set()); // Set of player IDs being knocked back

  // Cleanup powerup notification timeout on unmount
  useEffect(() => {
    return () => {
      if (powerupNotificationTimeoutRef.current) {
        clearTimeout(powerupNotificationTimeoutRef.current);
      }
    };
  }, []);

  const value = useMemo(() => ({
    // Combat System state
    playersHealth,
    setPlayersHealth,
    hitNotification,
    setHitNotification,
    myPlayerState,
    setMyPlayerState,
    myHealth,
    setMyHealth,
    inIFrames,
    setInIFrames,
    // Coin & Powerup state
    coins,
    setCoins,
    powerups,
    setPowerups,
    coinCollectNotification,
    setCoinCollectNotification,
    powerupCollectNotification,
    setPowerupCollectNotification,
    isImmune,
    setIsImmune,
    immunePlayers,
    setImmunePlayers,
    powerupNotificationTimeoutRef,
    // Knockback state
    knockbackActive,
    setKnockbackActive,
    knockbackPlayers,
    setKnockbackPlayers,
  }), [
    playersHealth, hitNotification, myPlayerState, myHealth, inIFrames,
    coins, powerups, coinCollectNotification, powerupCollectNotification,
    isImmune, immunePlayers, knockbackActive, knockbackPlayers
  ]);

  return (
    <CombatContext.Provider value={value}>
      {children}
    </CombatContext.Provider>
  );
};

export default CombatContext;
