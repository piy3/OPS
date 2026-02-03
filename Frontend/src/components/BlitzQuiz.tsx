/**
 * Blitz Quiz Component
 * Overlay shown during the Blitz Quiz phase in multiplayer
 */

import React, { useState, useEffect } from 'react';
import socketService from '@/services/SocketService';

interface BlitzQuizProps {
  question: string;
  options: string[];
  timeLeft: number;
  onAnswer: (index: number) => void;
}

const BlitzQuiz: React.FC<BlitzQuizProps> = ({ question, options, timeLeft, onAnswer }) => {
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [hasAnswered, setHasAnswered] = useState(false);

  // Reset state when question changes
  useEffect(() => {
    setSelectedAnswer(null);
    setHasAnswered(false);
  }, [question]);

  const handleAnswer = (index: number) => {
    if (hasAnswered) return;
    
    setSelectedAnswer(index);
    setHasAnswered(true);
    onAnswer(index);
  };

  const timePercentage = Math.max(0, (timeLeft / 15) * 100);

  return (
    <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
      <div className="bg-slate-800 border-2 border-purple-500 rounded-xl p-8 max-w-lg w-full mx-4 shadow-2xl shadow-purple-500/20">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-purple-400">BLITZ QUIZ!</h2>
          <div className="text-yellow-400 font-mono text-xl">
            {Math.ceil(timeLeft)}s
          </div>
        </div>

        {/* Timer bar */}
        <div className="h-2 bg-slate-700 rounded-full mb-6 overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-1000 ease-linear"
            style={{ width: `${timePercentage}%` }}
          />
        </div>

        {/* Question */}
        <div className="bg-slate-900 rounded-lg p-4 mb-6">
          <p className="text-white text-lg text-center">{question}</p>
        </div>

        {/* Options */}
        <div className="space-y-3">
          {options.map((option, index) => (
            <button
              key={index}
              onClick={() => handleAnswer(index)}
              disabled={hasAnswered}
              className={`w-full p-4 rounded-lg text-left font-medium transition-all ${
                hasAnswered
                  ? selectedAnswer === index
                    ? 'bg-purple-600 text-white border-2 border-purple-400'
                    : 'bg-slate-700 text-slate-400'
                  : 'bg-slate-700 hover:bg-slate-600 text-white hover:border-purple-400 border-2 border-transparent'
              }`}
            >
              <span className="inline-block w-8 h-8 rounded-full bg-slate-600 text-center leading-8 mr-3">
                {String.fromCharCode(65 + index)}
              </span>
              {option}
            </button>
          ))}
        </div>

        {/* Waiting message */}
        {hasAnswered && (
          <div className="mt-6 text-center">
            <p className="text-purple-400 animate-pulse">
              Answer submitted! Waiting for others...
            </p>
          </div>
        )}

        {/* Instructions */}
        {!hasAnswered && (
          <p className="mt-6 text-center text-slate-400 text-sm">
            Answer quickly! Fastest correct answer becomes the Unicorn.
          </p>
        )}
      </div>
    </div>
  );
};

export default BlitzQuiz;
