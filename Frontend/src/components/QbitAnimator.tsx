import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Play, Pause, RefreshCw, Move, Layers, Circle, Square, Save, Trash2, Camera, Download, Video, ChevronRight } from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import logger from '@/utils/logger';

// Color Palette based on the Qbit character
const COLORS = {
  hatBlue: '#0ea5e9',
  hatYellow: '#fbbf24',
  faceWhite: '#f1f5f9',
  coatBlue: '#0284c7',
  coatDarkBlue: '#0369a1',
  shirtOrange: '#f97316',
  chainSilver: '#cbd5e1',
  pantsBlue: '#0369a1',
  shoeBrown: '#78350f',
  eyeBlack: '#0f172a',
  badgeOrange: '#fbbf24'
};

// Types for recording system
interface Keyframe {
  time: number;
  leftArmAngle: number;
  rightArmAngle: number;
  leftLegAngle: number;
  rightLegAngle: number;
  legOffset: number;
  headTilt: number;
  torsoAngle: number;
  coatFlap: number;
  expression: 'neutral' | 'happy' | 'sad' | 'anger' | 'surprise' | 'confusion' | 'smirk' | 'cry';
}

interface SavedAnimation {
  name: string;
  keyframes: Keyframe[];
  duration: number;
}

const QbitAnimator = () => {
  // --- State for Animation Controls ---
  const [leftArmAngle, setLeftArmAngle] = useState(10);
  const [rightArmAngle, setRightArmAngle] = useState(-10);
  
  // Independent Leg Angles
  const [leftLegAngle, setLeftLegAngle] = useState(0);
  const [rightLegAngle, setRightLegAngle] = useState(0);
  
  const [legOffset, setLegOffset] = useState(0);
  const [hipsSway, setHipsSway] = useState(0); 
  const [headTilt, setHeadTilt] = useState(0);
  const [bodyRotation, setBodyRotation] = useState(0);
  
  // Spine & Coat Rigs
  const [torsoAngle, setTorsoAngle] = useState(0);
  const [coatFlap, setCoatFlap] = useState(0); 
  
  // Root transforms
  const [rootX, setRootX] = useState(0);
  const [rootY, setRootY] = useState(0); 
  
  // Expressions State
  const [isBlinking, setIsBlinking] = useState(false);
  const [blinkProgress, setBlinkProgress] = useState(0);
  const [isWinking, setIsWinking] = useState(false);
  const [winkProgress, setWinkProgress] = useState(0);
  const [expression, setExpression] = useState<'neutral' | 'happy' | 'sad' | 'anger' | 'surprise' | 'confusion' | 'smirk' | 'cry'>('neutral');
  const [showPoop, setShowPoop] = useState(false);
  const [handContactX, setHandContactX] = useState(0);
  const [handContactOpacity, setHandContactOpacity] = useState(0);

  // Auto-animation state
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationType, setAnimationType] = useState('idle');
  const requestRef = useRef<number>();

  // Recording system state
  const [isRecording, setIsRecording] = useState(false);
  const [recordedKeyframes, setRecordedKeyframes] = useState<Keyframe[]>([]);
  const [savedAnimations, setSavedAnimations] = useState<SavedAnimation[]>([]);
  const [saveName, setSaveName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [playingCustom, setPlayingCustom] = useState<string | null>(null);
  const recordStartTime = useRef<number>(0);
  const lastRecordTime = useRef<number>(0);
  const customAnimationRef = useRef<number>();
  const svgRef = useRef<SVGSVGElement>(null);

  // Video recording state
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [isEncodingVideo, setIsEncodingVideo] = useState(false);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [videoRecordingProgress, setVideoRecordingProgress] = useState(0);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const videoFramesRef = useRef<string[]>([]);
  const videoRecordingRef = useRef<number>();
  const isRecordingVideoRef = useRef(false);

  // Snapshot download function
  const downloadSnapshot = () => {
    if (!svgRef.current) return;
    
    const svg = svgRef.current;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    
    // Create a canvas to render the SVG
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Fill with background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 800, 800);
    
    const img = new Image();
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    img.onload = () => {
      ctx.drawImage(img, 200, 200, 400, 400);
      URL.revokeObjectURL(url);
      
      // Download
      const link = document.createElement('a');
      link.download = `qbit-pose-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    
    img.src = url;
  };

  // Load FFmpeg
  const loadFFmpeg = async () => {
    if (ffmpegRef.current) return;
    
    const ffmpeg = new FFmpeg();
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    
    ffmpegRef.current = ffmpeg;
    setFfmpegLoaded(true);
  };

  // Capture a single frame
  const captureFrame = (): Promise<string> => {
    return new Promise((resolve) => {
      if (!svgRef.current) {
        resolve('');
        return;
      }
      
      const svg = svgRef.current;
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);
      
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve('');
        return;
      }
      
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, 400, 400);
      
      const img = new Image();
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      
      img.onload = () => {
        ctx.drawImage(img, 0, 0, 400, 400);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      
      img.src = url;
    });
  };

  // Start video recording
  const startVideoRecording = async () => {
    if (!ffmpegLoaded) {
      setIsEncodingVideo(true);
      await loadFFmpeg();
      setIsEncodingVideo(false);
    }
    
    videoFramesRef.current = [];
    isRecordingVideoRef.current = true;
    setIsRecordingVideo(true);
    setVideoRecordingProgress(0);
    
    let frameCount = 0;
    const maxFrames = 300; // ~10 seconds at 30fps
    const captureInterval = 1000 / 30; // 30fps capture
    
    const recordFrame = async () => {
      if (frameCount >= maxFrames || !isRecordingVideoRef.current) {
        if (frameCount >= maxFrames) {
          stopVideoRecording();
        }
        return;
      }
      
      const frame = await captureFrame();
      if (frame) {
        videoFramesRef.current.push(frame);
        frameCount++;
        setVideoRecordingProgress((frameCount / maxFrames) * 100);
      }
      
      videoRecordingRef.current = window.setTimeout(recordFrame, captureInterval);
    };
    
    recordFrame();
  };

  // Stop video recording and encode
  const stopVideoRecording = async () => {
    isRecordingVideoRef.current = false;
    setIsRecordingVideo(false);
    if (videoRecordingRef.current) {
      clearTimeout(videoRecordingRef.current);
    }
    
    if (videoFramesRef.current.length < 10) {
      alert('Not enough frames captured. Please record for longer.');
      return;
    }
    
    setIsEncodingVideo(true);
    
    try {
      const ffmpeg = ffmpegRef.current;
      if (!ffmpeg) {
        throw new Error('FFmpeg not loaded');
      }
      
      // Write frames to FFmpeg virtual filesystem
      for (let i = 0; i < videoFramesRef.current.length; i++) {
        const frameData = videoFramesRef.current[i];
        const base64Data = frameData.split(',')[1];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let j = 0; j < binaryString.length; j++) {
          bytes[j] = binaryString.charCodeAt(j);
        }
        await ffmpeg.writeFile(`frame${i.toString().padStart(4, '0')}.png`, bytes);
      }
      
      // Encode to MP4
      await ffmpeg.exec([
        '-framerate', '30',
        '-i', 'frame%04d.png',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'fast',
        'output.mp4'
      ]);
      
      // Read the output file
      const data = await ffmpeg.readFile('output.mp4');
      // Handle type conversion for Blob
      const uint8Array = data as Uint8Array;
      const arrayBuffer = uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength) as ArrayBuffer;
      const blob = new Blob([arrayBuffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      
      // Download
      const link = document.createElement('a');
      link.download = `qbit-animation-${Date.now()}.mp4`;
      link.href = url;
      link.click();
      
      URL.revokeObjectURL(url);
      
      // Cleanup
      for (let i = 0; i < videoFramesRef.current.length; i++) {
        await ffmpeg.deleteFile(`frame${i.toString().padStart(4, '0')}.png`);
      }
      await ffmpeg.deleteFile('output.mp4');
      
    } catch (error) {
      logger.error('Video encoding failed:', error);
      alert('Video encoding failed. Please try again.');
    }
    
    setIsEncodingVideo(false);
    videoFramesRef.current = [];
    setVideoRecordingProgress(0);
  };
  const animate = (time: number) => {
    if (!isPlaying) return;
    
    const speed = 0.005;
    const t = time * speed;
    
    // Reset temporary states
    setBodyRotation(0);
    setRootX(0);
    setRootY(0); 
    setHipsSway(0);
    setShowPoop(false);
    let targetTorso = 0;
    let targetFlap = 0;

    if (animationType === 'idle') {
      setLeftArmAngle(10 + Math.sin(t) * 5);
      setRightArmAngle(-10 + Math.sin(t + Math.PI) * 5);
      setLeftLegAngle(0);
      setRightLegAngle(0);
      setHeadTilt(Math.sin(t * 0.5) * 2);
      setLegOffset(0);
      targetTorso = Math.sin(t) * 2; 
      targetFlap = 2 + Math.sin(t * 0.5);
    } else if (animationType === 'walk') {
      const legSwing = Math.sin(t * 4) * 25; 
      setLeftArmAngle(20 - legSwing); 
      setRightArmAngle(-20 + legSwing);
      setLeftLegAngle(legSwing);
      setRightLegAngle(-legSwing);
      setLegOffset(Math.abs(Math.sin(t * 4)) * 5);
      setHeadTilt(Math.sin(t * 8) * 2);
      targetTorso = 5; 
      targetFlap = 5 + Math.abs(Math.sin(t * 4)) * 5; 
    } else if (animationType === 'wave') {
      setRightArmAngle(-140 + Math.sin(t * 3) * 20);
      setLeftArmAngle(10);
      setLeftLegAngle(0);
      setRightLegAngle(0);
      setHeadTilt(5);
      setLegOffset(0);
      targetTorso = -2; 
    } else if (animationType === 'floss') {
      const flossSpeed = t * 2.4; 
      const phase = Math.sin(flossSpeed);
      setLegOffset(Math.abs(Math.sin(flossSpeed * 2)) * 3);
      setHeadTilt(phase * 5);
      setHipsSway(-phase * 15); 
      setLeftLegAngle(phase * 5);
      setRightLegAngle(phase * 5);
      if (phase > 0) {
        setLeftArmAngle(40 + phase * 20);
        setRightArmAngle(20 + phase * 20);
      } else {
        setLeftArmAngle(-20 + phase * 20);
        setRightArmAngle(-40 + phase * 20);
      }
      targetTorso = phase * 10;
      targetFlap = 10 + Math.abs(phase) * 5;
    } else if (animationType === 'cartwheel') {
      const cwSpeed = t * 0.5;
      const phase = (cwSpeed % (Math.PI * 2)) / (Math.PI * 2); // 0-1 progress
      
      // Pivot points on the ground (X positions where limbs contact)
      const startX = -80;
      const leftHandX = -40;
      const rightHandX = 40;
      const endX = 80;
      
      // Character needs to arc HIGH enough when inverted to stay above ground
      // Since rotation is around y=370, and character is ~160px tall, 
      // we need ~160px elevation when fully inverted
      
      if (phase < 0.2) {
        // Phase 0: Approach - leaning, reaching with first hand
        const p = phase / 0.2;
        setRootX(startX + p * (leftHandX - startX));
        setRootY(-p * 40); // Start lifting
        setBodyRotation(p * 45); // Start tilting
        setLeftArmAngle(-90 - p * 80); // Left arm reaches down
        setRightArmAngle(-20 + p * 30); // Right arm starts going up
        setLeftLegAngle(p * 20);
        setRightLegAngle(-p * 10);
        setHeadTilt(-p * 15);
        targetFlap = p * 5;
        setHandContactOpacity(p > 0.8 ? (p - 0.8) * 5 : 0);
        setHandContactX(200 + leftHandX);
        
      } else if (phase < 0.45) {
        // Phase 1: First Hand (left) Pivot - rotating around left hand
        const p = (phase - 0.2) / 0.25;
        setRootX(leftHandX + p * (rightHandX - leftHandX) * 0.5);
        // High arc to keep body above ground when inverted
        setRootY(-40 - Math.sin(p * Math.PI) * 140); // Peak at -180
        setBodyRotation(45 + p * 90); // 45° to 135°
        setLeftArmAngle(-170); // Left arm planted
        setRightArmAngle(-90 - p * 60); // Right arm reaching for ground
        setLeftLegAngle(30 + p * 40); // Legs spread wide going up
        setRightLegAngle(-30 - p * 40);
        setHeadTilt(-45 - p * 45);
        targetFlap = 10 + p * 5;
        setHandContactOpacity(1);
        setHandContactX(200 + leftHandX);
        
      } else if (phase < 0.7) {
        // Phase 2: Second Hand (right) Pivot - rotating around right hand
        const p = (phase - 0.45) / 0.25;
        setRootX(leftHandX + (rightHandX - leftHandX) * 0.5 + p * (rightHandX - leftHandX) * 0.5);
        // Continue high arc, descending
        setRootY(-40 - Math.sin((1 - p) * Math.PI) * 140); // Coming down from -180
        setBodyRotation(135 + p * 90); // 135° to 225°
        setLeftArmAngle(-160 + p * 60); // Left arm lifting off
        setRightArmAngle(-170); // Right arm planted
        setLeftLegAngle(70 - p * 30); // Legs coming down
        setRightLegAngle(-70 + p * 30);
        setHeadTilt(-90 - p * 45);
        targetFlap = 15 - p * 5;
        setHandContactOpacity(1);
        setHandContactX(200 + rightHandX);
        
      } else {
        // Phase 3: Landing - legs come down sequentially
        const p = (phase - 0.7) / 0.3;
        setRootX(rightHandX + p * (endX - rightHandX));
        setRootY(-40 * (1 - p)); // Settle back to ground
        setBodyRotation(225 + p * 135); // Complete the rotation to 360°
        setLeftArmAngle(-100 + p * 100); // Arms return to normal
        setRightArmAngle(-100 + p * 100);
        setLeftLegAngle(40 - p * 40); // Legs come together
        setRightLegAngle(-40 + p * 40);
        setHeadTilt(-135 + p * 135); // Head returns
        targetFlap = 10 - p * 10;
        setHandContactOpacity(Math.max(0, 1 - p * 2));
        setHandContactX(200 + rightHandX);
      }
    } else if (animationType === 'ophelia') {
      const slowT = t * 0.8;
      const sway = Math.sin(slowT);
      setHipsSway(sway * 25);
      setHeadTilt(-15 + Math.sin(slowT * 2) * 5);
      setLeftArmAngle(-100 + Math.sin(slowT) * 45);
      setRightArmAngle(-100 + Math.sin(slowT + 1.5) * 45);
      setLeftLegAngle(-sway * 10);
      setRightLegAngle(-sway * 10);
      setLegOffset(Math.abs(Math.sin(slowT * 2)) * 5);
      targetTorso = -10 + Math.cos(slowT) * 5;
      targetFlap = 8 + Math.sin(slowT * 2) * 4;
    } else if (animationType === 'poop') {
      const poopCycle = t % (Math.PI * 4);
      setLeftLegAngle(0);
      setRightLegAngle(0);
      if (poopCycle < Math.PI) { 
        setLegOffset(Math.sin(poopCycle/2) * 40);
        setLeftArmAngle(10 - Math.sin(poopCycle/2) * 30);
        setRightArmAngle(-10 + Math.sin(poopCycle/2) * 30);
        setHeadTilt(Math.sin(poopCycle) * 5);
        targetTorso = 15; 
        if (poopCycle > Math.PI * 0.8) setShowPoop(true);
      } else if (poopCycle < Math.PI * 3) { 
        setLegOffset(40);
        setLeftArmAngle(-20);
        setRightArmAngle(20);
        setHeadTilt(5);
        targetTorso = 20;
        setShowPoop(true);
      } else { 
        const standUpPhase = poopCycle - Math.PI * 3;
        setLegOffset(40 - Math.sin(standUpPhase/2) * 40);
        setLeftArmAngle(-20 + Math.sin(standUpPhase/2) * 30);
        setRightArmAngle(20 - Math.sin(standUpPhase/2) * 30);
        setHeadTilt(5 - Math.sin(standUpPhase/2) * 5);
        targetTorso = 20 - Math.sin(standUpPhase/2) * 20;
        setShowPoop(false);
      }
    } else if (animationType === 'winning') {
      const jumpSpeed = t * 3.5;
      setLegOffset(Math.abs(Math.sin(jumpSpeed)) * 15);
      setHeadTilt(-10 + Math.sin(jumpSpeed) * 5);
      const landing = Math.max(0, -Math.sin(jumpSpeed));
      setLeftLegAngle(-landing * 10);
      setRightLegAngle(landing * 10);
      setLeftArmAngle(-140 + Math.sin(jumpSpeed) * 10);
      setRightArmAngle(-140 + Math.sin(jumpSpeed) * 10);
      targetTorso = -10;
      targetFlap = 15 + Math.sin(jumpSpeed) * 10;
    } else if (animationType === 'moonwalk') {
      const mwSpeed = t * 1.5;
      const cycle = mwSpeed % (Math.PI * 2);
      const phase = Math.sin(cycle);
      
      // Backward sliding movement
      setRootX(Math.sin(mwSpeed * 0.5) * 40);
      
      // Alternating leg positions for moonwalk illusion
      if (phase > 0) {
        setLeftLegAngle(-15);  // Left leg back (planted, sliding)
        setRightLegAngle(10);  // Right leg forward (on toes)
      } else {
        setLeftLegAngle(10);   // Left leg forward (on toes)
        setRightLegAngle(-15); // Right leg back (planted, sliding)
      }
      
      // Subtle bounce for the toe-lift effect
      setLegOffset(Math.abs(phase) * 3);
      
      // Slight forward lean - classic MJ posture
      targetTorso = 8;
      
      // Arms in relaxed position with subtle counter-movement
      setLeftArmAngle(20 + phase * 5);
      setRightArmAngle(-20 - phase * 5);
      
      // Head slightly down, looking cool
      setHeadTilt(-5 + Math.sin(mwSpeed * 2) * 2);
      
      // Minimal hip sway
      setHipsSway(phase * 3);
      
      // Coat responds to backward motion
      targetFlap = 5 + Math.abs(phase) * 3;
    } else if (animationType === 'srk') {
      // Famous Shah Rukh Khan arms-spread pose
      const srkSpeed = t * 0.8;
      const cycle = (srkSpeed % (Math.PI * 4)) / (Math.PI * 4); // 0-1 slow cycle
      
      if (cycle < 0.3) {
        // Build up - arms gradually spreading
        const p = cycle / 0.3;
        setLeftArmAngle(10 + p * 80); // Arms going out
        setRightArmAngle(-10 - p * 80);
        setHeadTilt(p * 15); // Head tilting back
        targetTorso = -p * 15; // Slight lean back
        setLeftLegAngle(0);
        setRightLegAngle(0);
        setLegOffset(0);
        targetFlap = 5 + p * 15;
      } else if (cycle < 0.7) {
        // Hold the iconic pose with subtle sway
        const holdPhase = ((cycle - 0.3) / 0.4) * Math.PI * 2;
        setLeftArmAngle(90 + Math.sin(holdPhase) * 5); // Arms wide with subtle wave
        setRightArmAngle(-90 + Math.sin(holdPhase) * 5);
        setHeadTilt(15 + Math.sin(holdPhase * 0.5) * 3); // Looking up, slight movement
        targetTorso = -15 + Math.sin(holdPhase) * 2;
        setLeftLegAngle(Math.sin(holdPhase) * 3);
        setRightLegAngle(-Math.sin(holdPhase) * 3);
        setLegOffset(0);
        targetFlap = 20 + Math.sin(holdPhase) * 5; // Coat dramatic flutter
      } else {
        // Return to neutral
        const p = (cycle - 0.7) / 0.3;
        setLeftArmAngle(90 - p * 80);
        setRightArmAngle(-90 + p * 80);
        setHeadTilt(15 - p * 15);
        targetTorso = -15 + p * 15;
        setLeftLegAngle(0);
        setRightLegAngle(0);
        setLegOffset(0);
        targetFlap = 20 - p * 15;
      }
      
      setHipsSway(0);
      setRootX(0);
      setRootY(0);
    }

    setTorsoAngle(targetTorso);
    setCoatFlap(targetFlap);

    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    if (isPlaying) {
      requestRef.current = requestAnimationFrame(animate);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      setBodyRotation(0);
      setShowPoop(false);
      setRootX(0);
      setRootY(0);
      setHipsSway(0);
      setLeftLegAngle(0);
      setRightLegAngle(0);
      setTorsoAngle(0);
      setCoatFlap(0);
      setHandContactOpacity(0);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, animationType]);

  // --- Expression Logic ---
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      if (Math.random() > 0.7 && !isBlinking && !isWinking) {
        triggerBlink();
      }
    }, 3000);
    return () => clearInterval(blinkInterval);
  }, [isBlinking, isWinking]);

  const animateExpression = (
    setFlag: React.Dispatch<React.SetStateAction<boolean>>, 
    setProgress: React.Dispatch<React.SetStateAction<number>>
  ) => {
    setFlag(true);
    let start: number | null = null;
    const duration = 200;
    const animateFrame = (timestamp: number) => {
      if (!start) start = timestamp;
      const progress = timestamp - start;
      let val = 0;
      if (progress < duration / 2) {
        val = (progress / (duration / 2));
      } else {
        val = 1 - ((progress - duration/2) / (duration / 2));
      }
      setProgress(Math.max(0, Math.min(1, val)));
      if (progress < duration) requestAnimationFrame(animateFrame);
      else { setFlag(false); setProgress(0); }
    };
    requestAnimationFrame(animateFrame);
  };

  const triggerBlink = () => animateExpression(setIsBlinking, setBlinkProgress);

  const resetPose = () => {
    setIsPlaying(false);
    setPlayingCustom(null);
    setLeftArmAngle(10);
    setRightArmAngle(-10);
    setLegOffset(0);
    setHeadTilt(0);
    setBodyRotation(0);
    setRootY(0);
    setExpression('neutral');
    setShowPoop(false);
    setHipsSway(0);
    setLeftLegAngle(0);
    setRightLegAngle(0);
    setTorsoAngle(0);
    setCoatFlap(0);
  };

  // Recording functions
  const startRecording = () => {
    setIsPlaying(false);
    setPlayingCustom(null);
    setRecordedKeyframes([]);
    recordStartTime.current = Date.now();
    lastRecordTime.current = 0;
    setIsRecording(true);
    // Capture initial keyframe
    captureKeyframe(0);
  };

  const captureKeyframe = useCallback((time: number) => {
    const keyframe: Keyframe = {
      time,
      leftArmAngle,
      rightArmAngle,
      leftLegAngle,
      rightLegAngle,
      legOffset,
      headTilt,
      torsoAngle,
      coatFlap,
      expression
    };
    setRecordedKeyframes(prev => [...prev, keyframe]);
  }, [leftArmAngle, rightArmAngle, leftLegAngle, rightLegAngle, legOffset, headTilt, torsoAngle, coatFlap, expression]);

  // Capture keyframes while recording (on pose change)
  useEffect(() => {
    if (!isRecording) return;
    const elapsed = Date.now() - recordStartTime.current;
    // Only record if enough time has passed (throttle to ~60fps)
    if (elapsed - lastRecordTime.current > 50) {
      captureKeyframe(elapsed);
      lastRecordTime.current = elapsed;
    }
  }, [isRecording, leftArmAngle, rightArmAngle, leftLegAngle, rightLegAngle, legOffset, headTilt, torsoAngle, coatFlap, expression, captureKeyframe]);

  const stopRecording = () => {
    setIsRecording(false);
    if (recordedKeyframes.length > 1) {
      setShowSaveDialog(true);
    }
  };

  const saveAnimation = () => {
    if (!saveName.trim() || recordedKeyframes.length < 2) return;
    const duration = recordedKeyframes[recordedKeyframes.length - 1].time;
    const newAnimation: SavedAnimation = {
      name: saveName.trim(),
      keyframes: [...recordedKeyframes],
      duration
    };
    setSavedAnimations(prev => [...prev, newAnimation]);
    setSaveName('');
    setShowSaveDialog(false);
    setRecordedKeyframes([]);
  };

  const deleteAnimation = (name: string) => {
    setSavedAnimations(prev => prev.filter(a => a.name !== name));
    if (playingCustom === name) {
      setPlayingCustom(null);
    }
  };

  // Play custom animation
  const playCustomAnimation = (animation: SavedAnimation) => {
    setIsPlaying(false);
    setPlayingCustom(animation.name);
    
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = (Date.now() - startTime) % animation.duration;
      
      // Find surrounding keyframes
      let prevKf = animation.keyframes[0];
      let nextKf = animation.keyframes[1] || animation.keyframes[0];
      
      for (let i = 0; i < animation.keyframes.length - 1; i++) {
        if (animation.keyframes[i].time <= elapsed && animation.keyframes[i + 1].time > elapsed) {
          prevKf = animation.keyframes[i];
          nextKf = animation.keyframes[i + 1];
          break;
        }
      }
      
      // Interpolate
      const timeDiff = nextKf.time - prevKf.time;
      const t = timeDiff > 0 ? (elapsed - prevKf.time) / timeDiff : 0;
      
      setLeftArmAngle(prevKf.leftArmAngle + (nextKf.leftArmAngle - prevKf.leftArmAngle) * t);
      setRightArmAngle(prevKf.rightArmAngle + (nextKf.rightArmAngle - prevKf.rightArmAngle) * t);
      setLeftLegAngle(prevKf.leftLegAngle + (nextKf.leftLegAngle - prevKf.leftLegAngle) * t);
      setRightLegAngle(prevKf.rightLegAngle + (nextKf.rightLegAngle - prevKf.rightLegAngle) * t);
      setLegOffset(prevKf.legOffset + (nextKf.legOffset - prevKf.legOffset) * t);
      setHeadTilt(prevKf.headTilt + (nextKf.headTilt - prevKf.headTilt) * t);
      setTorsoAngle(prevKf.torsoAngle + (nextKf.torsoAngle - prevKf.torsoAngle) * t);
      setCoatFlap(prevKf.coatFlap + (nextKf.coatFlap - prevKf.coatFlap) * t);
      setExpression(prevKf.expression);
      
      customAnimationRef.current = requestAnimationFrame(animate);
    };
    
    customAnimationRef.current = requestAnimationFrame(animate);
  };

  const stopCustomAnimation = () => {
    if (customAnimationRef.current) {
      cancelAnimationFrame(customAnimationRef.current);
    }
    setPlayingCustom(null);
  };

  // Cleanup custom animation on unmount
  useEffect(() => {
    return () => {
      if (customAnimationRef.current) {
        cancelAnimationFrame(customAnimationRef.current);
      }
    };
  }, []);

  // --- RIG COMPONENTS ---
  
  const SkeletonRig = () => (
    <div className="skeleton-overlay">
       <div className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider font-bold border-b border-border pb-1 flex items-center gap-2">
         <Layers size={10} /> Skeleton Rig
       </div>
       <svg width="80" height="100" viewBox="0 0 100 120" className="opacity-90">
         <g transform={`translate(50, 60) translate(${rootX/4}, ${rootY/4}) rotate(${bodyRotation})`}>
            <line x1="-10" y1="0" x2="10" y2="0" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" />
            <circle cx="0" cy="0" r="3" fill="hsl(var(--primary))" />
            
            <g transform={`translate(-8, 0) rotate(${leftLegAngle})`}>
               <line x1="0" y1="0" x2="0" y2="25" stroke="#86efac" strokeWidth="2" strokeLinecap="round" />
               <circle cx="0" cy="25" r="2" fill="#86efac" />
            </g>
            <g transform={`translate(8, 0) rotate(${rightLegAngle})`}>
               <line x1="0" y1="0" x2="0" y2="25" stroke="#86efac" strokeWidth="2" strokeLinecap="round" />
               <circle cx="0" cy="25" r="2" fill="#86efac" />
            </g>

            <g transform={`rotate(${torsoAngle})`}>
               <line x1="0" y1="0" x2="0" y2="-30" stroke="hsl(var(--accent))" strokeWidth="2" strokeLinecap="round" />
               <line x1="-14" y1="-30" x2="14" y2="-30" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" />
               
               <g transform={`translate(0, -35) rotate(${headTilt})`}>
                 <circle cx="0" cy="0" r="8" stroke="white" strokeWidth="1.5" fill="rgba(255,255,255,0.2)" />
                 <line x1="0" y1="0" x2="6" y2="0" stroke="white" strokeWidth="1" />
               </g>

               <g transform={`translate(-12, -30) rotate(${leftArmAngle})`}>
                  <line x1="0" y1="0" x2="0" y2="30" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="0" cy="30" r="2.5" fill="#f472b6" />
               </g>
               <g transform={`translate(12, -30) rotate(${rightArmAngle})`}>
                  <line x1="0" y1="0" x2="0" y2="30" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="0" cy="30" r="2.5" fill="#f472b6" />
               </g>
            </g>
         </g>
       </svg>
    </div>
  );

  const Shadow = () => (
    <ellipse cx="200" cy="380" rx="60" ry="10" fill="rgba(0,0,0,0.2)" />
  );

  const Poop = () => (
    <text x="185" y="395" fontSize="30">💩</text>
  );

  const Hips = () => (
    <g transform={`translate(${hipsSway}, ${-legOffset})`}>
       <path d="M175,310 H225 V330 Q225,340 215,340 H185 Q175,340 175,330 Z" fill={COLORS.pantsBlue} />
    </g>
  );

  const LeftLeg = () => (
    <g transform={`translate(185, 320) translate(${hipsSway}, ${-legOffset}) rotate(${leftLegAngle}) translate(-185, -320)`}>
      <rect x="175" y="320" width="20" height="40" rx="5" fill={COLORS.pantsBlue} />
      <path d="M170,360 h30 v10 a5,5 0 0 1 -5,5 h-20 a5,5 0 0 1 -5,-5 z" fill={COLORS.shoeBrown} />
    </g>
  );

  const RightLeg = () => (
    <g transform={`translate(215, 320) translate(${hipsSway}, ${-legOffset}) rotate(${rightLegAngle}) translate(-215, -320)`}>
      <rect x="205" y="320" width="20" height="40" rx="5" fill={COLORS.pantsBlue} />
      <path d="M200,360 h30 v10 a5,5 0 0 1 -5,5 h-20 a5,5 0 0 1 -5,-5 z" fill={COLORS.shoeBrown} />
    </g>
  );

  const Body = () => {
    const flare = coatFlap;
    return (
      <g>
        <path d={`M160,250 Q${150-flare},330 ${160-flare},340 H${240+flare} Q${250+flare},330 240,250 Z`} fill={COLORS.coatDarkBlue} />
        <rect x="185" y="240" width="30" height="90" fill={COLORS.shirtOrange} />
        <path d={`M160,240 Q${155-flare},330 ${170-flare},335 L185,335 L185,240 Z`} fill={COLORS.coatBlue} />
        <path d={`M240,240 Q${245+flare},330 ${230+flare},335 L215,335 L215,240 Z`} fill={COLORS.coatBlue} />
        <path d="M160,240 L150,230 L250,230 L240,240 Z" fill={COLORS.coatDarkBlue} />
        <g transform="translate(200, 245) scale(0.6)">
           <path d="M-40,0 Q0,25 40,0" fill="none" stroke={COLORS.chainSilver} strokeWidth="8" strokeLinecap="round" strokeDasharray="1 10" />
           <circle cx="-30" cy="5" r="5" fill="none" stroke={COLORS.chainSilver} strokeWidth="3" />
           <circle cx="-10" cy="12" r="5" fill="none" stroke={COLORS.chainSilver} strokeWidth="3" />
           <circle cx="10" cy="12" r="5" fill="none" stroke={COLORS.chainSilver} strokeWidth="3" />
           <circle cx="30" cy="5" r="5" fill="none" stroke={COLORS.chainSilver} strokeWidth="3" />
        </g>
      </g>
    );
  };

  const LeftArm = () => (
    <g transform={`translate(175, 245) rotate(${leftArmAngle}) translate(-175, -245)`}>
      <path d="M165,245 L155,300 A10,10 0 0 0 175,300 L185,245 Z" fill={COLORS.coatBlue} />
      <circle cx="165" cy="305" r="8" fill={COLORS.faceWhite} />
    </g>
  );

  const RightArm = () => (
    <g transform={`translate(225, 245) rotate(${rightArmAngle}) translate(-225, -245)`}>
      <path d="M215,245 L225,300 A10,10 0 0 0 245,300 L235,245 Z" fill={COLORS.coatBlue} />
      <circle cx="225" cy="245" r="10" fill={COLORS.coatBlue} />
      <circle cx="235" cy="305" r="8" fill={COLORS.faceWhite} />
    </g>
  );

  const Head = () => {
    // Eye configurations based on expression
    const getEyeConfig = () => {
      switch (expression) {
        case 'happy':
          return { leftY: 205, rightY: 205, leftRx: 5, leftRy: 4, rightRx: 5, rightRy: 4, leftRotate: 0, rightRotate: 0, squint: true };
        case 'sad':
          return { leftY: 208, rightY: 208, leftRx: 5, leftRy: 8, rightRx: 5, rightRy: 8, leftRotate: -10, rightRotate: 10, squint: false };
        case 'anger':
          return { leftY: 207, rightY: 207, leftRx: 5, leftRy: 6, rightRx: 5, rightRy: 6, leftRotate: 15, rightRotate: -15, squint: false };
        case 'surprise':
          return { leftY: 203, rightY: 203, leftRx: 7, leftRy: 10, rightRx: 7, rightRy: 10, leftRotate: 0, rightRotate: 0, squint: false };
        case 'confusion':
          return { leftY: 205, rightY: 208, leftRx: 5, leftRy: 8, rightRx: 5, rightRy: 6, leftRotate: -5, rightRotate: 10, squint: false };
        case 'smirk':
          return { leftY: 205, rightY: 205, leftRx: 5, leftRy: 8, rightRx: 4, rightRy: 5, leftRotate: 0, rightRotate: 0, squint: false };
        case 'cry':
          return { leftY: 208, rightY: 208, leftRx: 5, leftRy: 8, rightRx: 5, rightRy: 8, leftRotate: -15, rightRotate: 15, squint: false };
        default:
          return { leftY: 205, rightY: 205, leftRx: 5, leftRy: 8, rightRx: 5, rightRy: 8, leftRotate: 0, rightRotate: 0, squint: false };
      }
    };

    // Mouth configurations based on expression
    const getMouth = () => {
      switch (expression) {
        case 'happy':
          return <path d="M188,222 Q200,232 212,222" fill="none" stroke={COLORS.eyeBlack} strokeWidth="2.5" strokeLinecap="round" />;
        case 'sad':
          return <path d="M188,228 Q200,220 212,228" fill="none" stroke={COLORS.eyeBlack} strokeWidth="2.5" strokeLinecap="round" />;
        case 'anger':
          return <path d="M190,225 H210" fill="none" stroke={COLORS.eyeBlack} strokeWidth="2.5" strokeLinecap="round" />;
        case 'surprise':
          return <ellipse cx="200" cy="226" rx="6" ry="8" fill={COLORS.eyeBlack} />;
        case 'confusion':
          return <path d="M190,224 Q195,228 205,222 Q210,226 212,224" fill="none" stroke={COLORS.eyeBlack} strokeWidth="2" strokeLinecap="round" />;
        case 'smirk':
          return <path d="M192,224 Q205,228 215,220" fill="none" stroke={COLORS.eyeBlack} strokeWidth="2.5" strokeLinecap="round" />;
        case 'cry':
          return (
            <>
              <path d="M188,228 Q200,220 212,228" fill="none" stroke={COLORS.eyeBlack} strokeWidth="2.5" strokeLinecap="round" />
              {/* Tears */}
              <ellipse cx="182" cy="215" rx="2" ry="4" fill="#60a5fa" opacity="0.8" />
              <ellipse cx="218" cy="215" rx="2" ry="4" fill="#60a5fa" opacity="0.8" />
            </>
          );
        default:
          return <path d="M192,224 Q200,226 208,224" fill="none" stroke={COLORS.eyeBlack} strokeWidth="2" strokeLinecap="round" />;
      }
    };

    // Eyebrow configurations
    const getEyebrows = () => {
      switch (expression) {
        case 'anger':
          return (
            <>
              <path d="M177,192 L193,196" stroke={COLORS.eyeBlack} strokeWidth="2.5" strokeLinecap="round" />
              <path d="M207,196 L223,192" stroke={COLORS.eyeBlack} strokeWidth="2.5" strokeLinecap="round" />
            </>
          );
        case 'sad':
        case 'cry':
          return (
            <>
              <path d="M177,196 L193,192" stroke={COLORS.eyeBlack} strokeWidth="2" strokeLinecap="round" />
              <path d="M207,192 L223,196" stroke={COLORS.eyeBlack} strokeWidth="2" strokeLinecap="round" />
            </>
          );
        case 'surprise':
          return (
            <>
              <path d="M177,190 Q185,186 193,190" stroke={COLORS.eyeBlack} strokeWidth="2" strokeLinecap="round" fill="none" />
              <path d="M207,190 Q215,186 223,190" stroke={COLORS.eyeBlack} strokeWidth="2" strokeLinecap="round" fill="none" />
            </>
          );
        case 'confusion':
          return (
            <>
              <path d="M177,194 L193,192" stroke={COLORS.eyeBlack} strokeWidth="2" strokeLinecap="round" />
              <path d="M207,196 L223,192" stroke={COLORS.eyeBlack} strokeWidth="2" strokeLinecap="round" />
            </>
          );
        default:
          return null;
      }
    };

    const eyeConfig = getEyeConfig();

    return (
      <g transform={`translate(200, 230) rotate(${headTilt}) translate(-200, -230)`}>
        {/* Face */}
        <rect x="160" y="170" width="80" height="70" rx="35" fill={COLORS.faceWhite} />
        
        {/* Eyes */}
        <g>
          {eyeConfig.squint ? (
            <>
              <path d="M178,205 Q185,200 192,205" stroke={COLORS.eyeBlack} strokeWidth="3" strokeLinecap="round" fill="none" />
              <path d="M208,205 Q215,200 222,205" stroke={COLORS.eyeBlack} strokeWidth="3" strokeLinecap="round" fill="none" />
            </>
          ) : (
            <>
              <ellipse cx="185" cy={eyeConfig.leftY} rx={eyeConfig.leftRx} ry={eyeConfig.leftRy} fill={COLORS.eyeBlack} transform={`rotate(${eyeConfig.leftRotate} 185 ${eyeConfig.leftY})`} />
              <ellipse cx="215" cy={eyeConfig.rightY} rx={eyeConfig.rightRx} ry={eyeConfig.rightRy} fill={COLORS.eyeBlack} transform={`rotate(${eyeConfig.rightRotate} 215 ${eyeConfig.rightY})`} />
            </>
          )}
          {/* Blink overlays */}
          <path d={`M175,205 h20 a1,1 0 0 0 -20,0`} fill={COLORS.faceWhite} style={{ transformOrigin: '185px 205px', transform: `scaleY(${blinkProgress})` }} />
          <path d={`M205,205 h20 a1,1 0 0 0 -20,0`} fill={COLORS.faceWhite} style={{ transformOrigin: '215px 205px', transform: `scaleY(${Math.max(blinkProgress, winkProgress)})` }} />
        </g>

        {/* Eyebrows */}
        {getEyebrows()}

        {/* Mouth */}
        {getMouth()}

        {/* Hat */}
        <path d="M160,180 V160 Q160,130 200,130 Q240,130 240,160 V180 H160" fill={COLORS.hatBlue} />
        <path d="M150,180 H250 V190 Q250,200 240,200 H160 Q150,200 150,190 Z" fill={COLORS.hatYellow} />
        
        {/* Badge */}
        <circle cx="200" cy="160" r="12" fill={COLORS.badgeOrange} />
        <g transform={expression === 'sad' || expression === 'cry' ? "translate(200, 160) rotate(180) translate(-200, -160)" : ""}>
          <circle cx="196" cy="158" r="1.5" fill="#5D4037" />
          <circle cx="204" cy="158" r="1.5" fill="#5D4037" />
          <path d="M196,162 Q200,166 204,162" fill="none" stroke="#5D4037" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      </g>
    );
  };

  const AnimationButton = ({ type, label }: { type: string; label: string }) => (
    <button 
      onClick={() => { setIsPlaying(true); setAnimationType(type); }}
      className={`animation-btn ${isPlaying && animationType === type ? 'animation-btn-active' : ''}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col md:flex-row h-screen bg-background text-foreground overflow-hidden">
      
      {/* --- Visualizer Stage --- */}
      <div className="flex-1 flex flex-col items-center justify-center animator-stage p-4 relative">
        <SkeletonRig />

        <div className="stage-badge">
          Qbit Animator v1.8
        </div>
        
        {/* Snapshot Button */}
        {/* <button
          onClick={downloadSnapshot}
          className="absolute top-4 right-4 p-2 rounded-lg bg-secondary/80 hover:bg-secondary text-secondary-foreground transition-all flex items-center gap-2 text-sm"
          title="Download Snapshot"
        >
          <Camera size={16} />
          <Download size={14} />
        </button> */}
        
        {/* Video Recording Button */}
        {/* <div className="absolute top-4 right-24 flex items-center gap-2">
          {isEncodingVideo ? (
            <div className="p-2 rounded-lg bg-secondary/80 text-secondary-foreground flex items-center gap-2 text-sm">
              <RefreshCw size={16} className="animate-spin" />
              <span>Encoding...</span>
            </div>
          ) : isRecordingVideo ? (
            <button
              onClick={stopVideoRecording}
              className="p-2 rounded-lg bg-destructive hover:bg-destructive/80 text-destructive-foreground transition-all flex items-center gap-2 text-sm animate-pulse"
              title="Stop Recording"
            >
              <Square size={14} className="fill-current" />
              <span>{Math.round(videoRecordingProgress)}%</span>
            </button>
          ) : (
            <button
              onClick={startVideoRecording}
              className="p-2 rounded-lg bg-secondary/80 hover:bg-secondary text-secondary-foreground transition-all flex items-center gap-2 text-sm"
              title="Record MP4 Video"
            >
              <Video size={16} />
              <Circle size={12} className="text-destructive fill-destructive" />
            </button>
          )}
        </div> */}

        {/* The SVG Rig */}
        <div className="character-stage">
           <svg ref={svgRef} width="400" height="400" viewBox="0 0 400 400" className="overflow-visible">
              <defs>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              {/* Ground line */}
              <line x1="0" y1="380" x2="400" y2="380" stroke="hsl(var(--muted-foreground))" strokeWidth="2" strokeOpacity="0.3" />
              <Shadow />
              {handContactOpacity > 0 && (
                <ellipse 
                  cx={handContactX} 
                  cy="378" 
                  rx={12 + handContactOpacity * 8} 
                  ry={4 + handContactOpacity * 2} 
                  fill={`rgba(0,0,0,${handContactOpacity * 0.4})`} 
                />
              )}
              {showPoop && <Poop />}
              <g transform={`translate(${rootX}, ${rootY}) rotate(${bodyRotation} 200 370)`}>
                <LeftLeg />
                <RightLeg />
                <Hips />
                <g transform={`translate(0, ${-legOffset}) rotate(${torsoAngle} 200 320)`}>
                    <LeftArm />
                    <Body />
                    <RightArm />
                    <Head />
                </g>
              </g>
           </svg>
        </div>
      </div>

      {/* Rig Controls panel hidden so it doesn't cover the multiplayer button (code kept, not removed) */}
      {false && (
      <div className="w-full md:w-80 control-panel z-10 shadow-xl">
        <div className="flex items-center gap-2 mb-2">
           <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
             <Move size={18} className="text-primary-foreground" />
           </div>
           <h1 className="text-xl font-bold tracking-tight">Rig Controls</h1>
        </div>

        {/* Animation Presets */}
        <div className="space-y-3">
          <label className="control-label">Auto Animate</label>
          <div className="grid grid-cols-3 gap-2">
            <AnimationButton type="idle" label="Idle" />
            <AnimationButton type="walk" label="Walk" />
            <AnimationButton type="wave" label="Wave" />
            <AnimationButton type="floss" label="Floss" />
            <AnimationButton type="moonwalk" label="Moonwalk" />
            <AnimationButton type="cartwheel" label="Slow Wheel" />
            <AnimationButton type="winning" label="Winning" />
            <AnimationButton type="ophelia" label="Fate of Ophelia" />
            <AnimationButton type="poop" label="Poop" />
            <AnimationButton type="srk" label="SRK Pose" />
          </div>
          <div className="flex gap-2 mt-2">
             <button 
                onClick={() => setIsPlaying(!isPlaying)}
                className="flex-1 control-btn"
             >
                {isPlaying ? <><Pause size={16} /> Pause</> : <><Play size={16} /> Play</>}
             </button>
             <button 
                onClick={resetPose}
                className="px-3 control-btn"
                title="Reset Pose"
             >
                <RefreshCw size={16} />
             </button>
          </div>
        </div>

        <hr className="border-border" />

        {/* Expression Controls */}
        <div className="space-y-3">
          <label className="control-label">Expression</label>
          <div className="grid grid-cols-4 gap-2">
            {(['neutral', 'happy', 'sad', 'anger', 'surprise', 'confusion', 'smirk', 'cry'] as const).map((expr) => (
              <button
                key={expr}
                onClick={() => setExpression(expr)}
                className={`p-2 rounded-md text-xs font-medium transition-all capitalize ${
                  expression === expr 
                    ? 'bg-primary text-primary-foreground shadow-lg' 
                    : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
                }`}
              >
                {expr}
              </button>
            ))}
          </div>
        </div>

        <hr className="border-border" />

        {/* Recording Controls */}
        <div className="space-y-3">
          <label className="control-label">Record Animation</label>
          <div className="flex gap-2">
            {!isRecording ? (
              <button
                onClick={startRecording}
                className="flex-1 control-btn bg-destructive/20 hover:bg-destructive/30 text-destructive"
                disabled={isPlaying || !!playingCustom}
              >
                <Circle size={16} className="fill-current" /> Record
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex-1 control-btn bg-destructive text-destructive-foreground animate-pulse"
              >
                <Square size={16} className="fill-current" /> Stop ({recordedKeyframes.length} frames)
              </button>
            )}
          </div>
          
          {/* Save Dialog */}
          {showSaveDialog && (
            <div className="bg-secondary/50 p-3 rounded-lg space-y-2 border border-border">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Animation name..."
                className="w-full px-3 py-2 rounded-md bg-background border border-border text-foreground text-sm"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={saveAnimation}
                  disabled={!saveName.trim()}
                  className="flex-1 control-btn bg-primary text-primary-foreground disabled:opacity-50"
                >
                  <Save size={14} /> Save
                </button>
                <button
                  onClick={() => { setShowSaveDialog(false); setRecordedKeyframes([]); }}
                  className="px-3 control-btn"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Saved Animations */}
          {savedAnimations.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Saved Animations</div>
              {savedAnimations.map((anim) => (
                <div
                  key={anim.name}
                  className={`flex items-center gap-2 p-2 rounded-md transition-all ${
                    playingCustom === anim.name 
                      ? 'bg-primary/20 border border-primary' 
                      : 'bg-secondary/50 hover:bg-secondary'
                  }`}
                >
                  <span className="flex-1 text-sm font-medium truncate">{anim.name}</span>
                  <span className="text-xs text-muted-foreground">{(anim.duration / 1000).toFixed(1)}s</span>
                  {playingCustom === anim.name ? (
                    <button
                      onClick={stopCustomAnimation}
                      className="p-1.5 rounded bg-primary text-primary-foreground"
                    >
                      <Pause size={12} />
                    </button>
                  ) : (
                    <button
                      onClick={() => playCustomAnimation(anim)}
                      className="p-1.5 rounded bg-primary/20 hover:bg-primary/30 text-primary"
                      disabled={isPlaying || isRecording}
                    >
                      <Play size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => deleteAnimation(anim.name)}
                    className="p-1.5 rounded hover:bg-destructive/20 text-destructive"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <hr className="border-border" />
        <div className={`space-y-6 transition-opacity ${isPlaying || playingCustom ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
           <label className="control-label flex items-center gap-2">
             Manual Pose
             {isRecording && <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />}
           </label>

           {/* Arms */}
           <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between text-xs mb-1 text-muted-foreground">
                      <span>L Arm</span>
                  </div>
                  <input 
                    type="range" min="-60" max="160" 
                    value={leftArmAngle} 
                    onChange={(e) => setLeftArmAngle(parseFloat(e.target.value))}
                    className="slider-track accent-primary"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1 text-muted-foreground">
                      <span>R Arm</span>
                  </div>
                  <input 
                    type="range" min="-160" max="60" 
                    value={rightArmAngle} 
                    onChange={(e) => setRightArmAngle(parseFloat(e.target.value))}
                    className="slider-track accent-primary"
                  />
                </div>
              </div>

              {/* Legs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between text-xs mb-1 text-muted-foreground">
                      <span>L Leg</span>
                  </div>
                  <input 
                    type="range" min="-60" max="60" 
                    value={leftLegAngle} 
                    onChange={(e) => setLeftLegAngle(parseFloat(e.target.value))}
                    className="slider-track accent-primary"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1 text-muted-foreground">
                      <span>R Leg</span>
                  </div>
                  <input 
                    type="range" min="-60" max="60" 
                    value={rightLegAngle} 
                    onChange={(e) => setRightLegAngle(parseFloat(e.target.value))}
                    className="slider-track accent-primary"
                  />
                </div>
              </div>
           </div>

           {/* Body & Coat */}
           <div className="space-y-4">
             <div>
                <div className="flex justify-between text-sm mb-1 text-muted-foreground">
                    <span>Torso Bend</span>
                </div>
                <input 
                  type="range" min="-30" max="30" 
                  value={torsoAngle} 
                  onChange={(e) => setTorsoAngle(parseFloat(e.target.value))}
                  className="slider-track accent-primary"
                />
             </div>
             <div>
                <div className="flex justify-between text-sm mb-1 text-muted-foreground">
                    <span>Coat Flap</span>
                </div>
                <input 
                  type="range" min="0" max="40" 
                  value={coatFlap} 
                  onChange={(e) => setCoatFlap(parseFloat(e.target.value))}
                  className="slider-track accent-primary"
                />
             </div>
           </div>

           {/* Height & Head */}
           <div className="space-y-4">
             <div>
                <div className="flex justify-between text-sm mb-1 text-muted-foreground">
                    <span>Bounce / Height</span>
                </div>
                <input 
                  type="range" min="0" max="40" 
                  value={legOffset} 
                  onChange={(e) => setLegOffset(parseFloat(e.target.value))}
                  className="slider-track accent-primary"
                />
             </div>
             <div>
                <div className="flex justify-between text-sm mb-1 text-muted-foreground">
                    <span>Head Tilt</span>
                </div>
                <input 
                  type="range" min="-20" max="20" 
                  value={headTilt} 
                  onChange={(e) => setHeadTilt(parseFloat(e.target.value))}
                  className="slider-track accent-primary"
                />
             </div>
           </div>
        </div>
      </div>
      )}

      {/* Game Entry Point */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background via-background/95 to-transparent">
        <Link to="/lobby" className="block">
          <button className="w-full py-3 px-6 rounded-xl bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500 text-white font-bold text-lg flex items-center justify-center gap-3 shadow-lg hover:shadow-purple-500/25 transition-all group">
            <Layers size={24} />
            <span>Play Multiplayer</span>
            <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </button>
        </Link>
      </div>
    </div>
  );
};

export default QbitAnimator;
