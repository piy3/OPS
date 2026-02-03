import React from 'react';

const COLORS = {
  hatBlue: '#0ea5e9',
  hatYellow: '#fbbf24',
  coatBlue: '#0284c7',
  coatDarkBlue: '#0369a1',
  shirtOrange: '#f97316',
  badgeOrange: '#fbbf24',
};

interface IsometricQbitProps {
  rotation?: number;
  isWalking?: boolean;
  scale?: number;
  isEnemy?: boolean;
}

export const IsometricQbit: React.FC<IsometricQbitProps> = ({ 
  rotation = 0, 
  isWalking = false,
  scale = 1,
  isEnemy = false
}) => {
  const walkBob = isWalking ? Math.sin(Date.now() * 0.01) * 2 : 0;
  const coatPulse = isWalking ? Math.sin(Date.now() * 0.02) * 3 : 0;
  
  const colors = isEnemy ? {
    hatBlue: '#ef4444',
    hatYellow: '#fca5a5',
    coatBlue: '#dc2626',
    coatDarkBlue: '#991b1b',
    shirtOrange: '#fca5a5',
    badgeOrange: '#fca5a5',
  } : COLORS;

  return (
    <g transform={`scale(${scale}) rotate(${rotation})`}>
      {/* Shadow */}
      <ellipse cx="0" cy="15" rx="35" ry="20" fill="rgba(0,0,0,0.25)" />
      
      {/* Coat visible from above - oval shape */}
      <ellipse 
        cx="0" 
        cy={5 + walkBob} 
        rx={32 + coatPulse} 
        ry={28 + coatPulse} 
        fill={colors.coatDarkBlue} 
      />
      <ellipse 
        cx="0" 
        cy={3 + walkBob} 
        rx={28 + coatPulse * 0.5} 
        ry={24 + coatPulse * 0.5} 
        fill={colors.coatBlue} 
      />
      
      {/* Orange shirt peeking through */}
      <ellipse cx="0" cy={-2 + walkBob} rx="12" ry="10" fill={colors.shirtOrange} />
      
      {/* Hat brim (yellow ring) */}
      <ellipse cx="0" cy={-5 + walkBob} rx="30" ry="24" fill={colors.hatYellow} />
      
      {/* Hat top (blue) */}
      <ellipse cx="0" cy={-8 + walkBob} rx="24" ry="19" fill={colors.hatBlue} />
      
      {/* Badge with face */}
      <circle cx="0" cy={-8 + walkBob} r="10" fill={colors.badgeOrange} />
      <circle cx="-3" cy={-10 + walkBob} r="1.5" fill="#5D4037" />
      <circle cx="3" cy={-10 + walkBob} r="1.5" fill="#5D4037" />
      <path 
        d={`M-3,${-6 + walkBob} Q0,${-3 + walkBob} 3,${-6 + walkBob}`} 
        fill="none" 
        stroke="#5D4037" 
        strokeWidth="1.5" 
      />
      
      {/* Direction indicator - subtle line showing facing */}
      <line 
        x1="0" 
        y1={-25 + walkBob} 
        x2="0" 
        y2={-40 + walkBob} 
        stroke="rgba(255,255,255,0.5)" 
        strokeWidth="2" 
        strokeLinecap="round" 
      />
      <polygon 
        points="0,-45 -4,-38 4,-38" 
        fill="rgba(255,255,255,0.5)" 
        transform={`translate(0, ${walkBob})`} 
      />
    </g>
  );
};

export default IsometricQbit;
