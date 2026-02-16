/**
 * Blitz Quiz Component
 * Overlay shown during the Blitz Quiz phase in multiplayer
 */

import React, { useState, useEffect } from 'react';

const ANSWER_COLORS = ['bg-game-answer0', 'bg-game-answer1', 'bg-game-answer2', 'bg-game-answer3'] as const;

interface BlitzQuizProps {
  question: string;
  options: string[];
  timeLeft: number;
  onAnswer: (index: number) => void;
  /** Question image URL (Quizizz); when present, shown above question text */
  questionImage?: string | null;
  /** Option image URLs; same length as options; null = no image for that option */
  optionImages?: (string | null)[];
  /** When true, hide the timer bar and timer badge (e.g. for 3-question entry quiz) */
  hideTimer?: boolean;
  /** Optional label above question (e.g. "Question 2/3") */
  questionLabel?: string;
  /** Whether this is the final question in a per-player quiz (changes waiting message) */
  isFinalQuestion?: boolean;
}

const BlitzQuiz: React.FC<BlitzQuizProps> = ({ question, options, timeLeft, onAnswer, questionImage, optionImages, hideTimer, questionLabel, isFinalQuestion }) => {
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [hasAnswered, setHasAnswered] = useState(false);

  // Reset state when question changes (use questionLabel which is unique per question index,
  // since question text can have duplicates in the quiz pool)
  useEffect(() => {
    setSelectedAnswer(null); 
    setHasAnswered(false);
  }, [questionLabel]);

  const handleAnswer = (index: number) => {
    if (hasAnswered) return;
    
    setSelectedAnswer(index);
    setHasAnswered(true);
    onAnswer(index);
  };

  const timePercentage = Math.max(0, (timeLeft / 15) * 100);

  return (
    <div className="absolute inset-0 bg-game-bg flex items-center justify-center z-50">
      <div className="bg-game-card rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl border border-game-accent/30">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 gap-4">
          <div className="flex-1">
            <h2 className="text-2xl md:text-3xl font-bold text-cream">
              {questionLabel ?? 'Answer correct for 10 bonus coins'}
            </h2>
          </div>
          {!hideTimer && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="px-3 py-1.5 rounded-full bg-game-pill border border-game-accent text-game-icon font-mono text-xl font-bold">
                {Math.ceil(timeLeft)}s
              </span>
            </div>
          )}
        </div>

        {/* Timer bar (hidden for entry quiz) */}
        {!hideTimer && (
          <div className="h-2 bg-game-pill rounded-full mb-6 overflow-hidden">
            <div
              className="h-full bg-game-accent transition-all duration-1000 ease-linear"
              style={{ width: `${timePercentage}%` }}
            />
          </div>
        )}

        {/* Question */}
        <div className="bg-game-pill/60 rounded-xl p-4 mb-5 border border-game-accent/40">
          {questionImage && (
            <div className="flex justify-center mb-3">
              <img src={questionImage} alt="" className="max-h-32 max-w-full object-contain rounded" />
            </div>
          )}
          <p className="text-cream text-lg font-bold text-center">{question}</p>
        </div>

        {/* Options: 2x2 grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {options.map((option, index) => (
            <button
              key={index}
              onClick={() => handleAnswer(index)}
              disabled={hasAnswered}
              className={`relative p-4 rounded-xl text-center font-bold transition-all min-h-[80px] flex flex-col items-center justify-center text-cream ${
                hasAnswered
                  ? selectedAnswer === index
                    ? 'ring-2 ring-cream ring-offset-2 ring-offset-game-card ' + ANSWER_COLORS[index % 4]
                    : ANSWER_COLORS[index % 4] + ' opacity-60'
                  : ANSWER_COLORS[index % 4] + ' hover:brightness-110'
              }`}
            >
              <span className="absolute top-2 right-2 w-6 h-6 rounded-md bg-black/40 flex items-center justify-center text-cream text-xs font-mono">
                {index + 1}
              </span>
              {optionImages?.[index] ? (
                <img src={optionImages[index]!} alt="" className="max-h-16 max-w-full object-contain rounded mb-1" />
              ) : null}
              {option ? <span className="text-sm md:text-base">{option}</span> : null}
            </button>
          ))}
        </div>

        {hasAnswered && (
          <p className="text-center text-game-accent font-medium animate-pulse">
            {isFinalQuestion ? 'Entering the maze...' : 'Answer submitted! Waiting for others...'}
          </p>
        )}
      </div>
    </div>
  );
};

export default BlitzQuiz;
