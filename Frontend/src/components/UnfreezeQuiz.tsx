/**
 * Unfreeze Quiz Component
 * Overlay shown when a player is frozen (tagged by unicorn)
 * Player must answer questions correctly to respawn
 */

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import socketService, { SOCKET_EVENTS } from '@/services/SocketService';

const ANSWER_COLORS = ['bg-game-answer0', 'bg-game-answer1', 'bg-game-answer2', 'bg-game-answer3'] as const;

interface UnfreezeQuestion {
  id: number;
  question: string;
  options: string[];
  /** Question image URL (Quizizz); when present, shown above question text */
  questionImage?: string | null;
  /** Option image URLs; same length as options; null = no image for that option */
  optionImages?: (string | null)[];
}

interface AnswerResult {
  questionIndex: number;
  isCorrect: boolean;
  correctAnswer?: number;
}

interface UnfreezeQuizProps {
  questions: UnfreezeQuestion[];
  passThreshold: number;
  onComplete?: () => void;
}

const UnfreezeQuiz: React.FC<UnfreezeQuizProps> = ({ questions, passThreshold, onComplete }) => {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerResult[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showingResult, setShowingResult] = useState(false);
  const [waitingForNewQuestions, setWaitingForNewQuestions] = useState(false);

  const currentQuestion = questions[currentQuestionIndex];
  const correctCount = answers.filter(a => a.isCorrect).length;
  const needToPass = passThreshold - correctCount;

  // Reset state when new questions come in
  useEffect(() => {
    setCurrentQuestionIndex(0);
    setAnswers([]);
    setSelectedAnswer(null);
    setShowingResult(false);
    setWaitingForNewQuestions(false);
  }, [questions]);

  // Listen for answer results from server
  useEffect(() => {
    const unsubAnswerResult = socketService.on(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_ANSWER_RESULT, (data: any) => {
      const result: AnswerResult = {
        questionIndex: data.questionIndex,
        isCorrect: data.isCorrect,
        correctAnswer: data.correctAnswer
      };

      setAnswers(prev => [...prev, result]);
      setShowingResult(true);

      // Show result for 1 second then move to next question
      setTimeout(() => {
        setShowingResult(false);
        setSelectedAnswer(null);
        
        if (data.totalAnswered < data.totalQuestions) {
          setCurrentQuestionIndex(prev => prev + 1);
        }
      }, 1000);
    });

    const unsubComplete = socketService.on(SOCKET_EVENTS.SERVER.UNFREEZE_QUIZ_COMPLETE, (data: any) => {
      if (!data.passed && data.retry) {
        // Failed, waiting for new questions
        setWaitingForNewQuestions(true);
      }
    });

    return () => {
      unsubAnswerResult();
      unsubComplete();
    };
  }, []);

  const handleAnswer = (answerIndex: number) => {
    if (showingResult || selectedAnswer !== null) return;
    
    setSelectedAnswer(answerIndex);
    socketService.submitUnfreezeAnswer(currentQuestionIndex, answerIndex);
  };

  const getAnswerStyle = (index: number) => {
    const base = `${ANSWER_COLORS[index % 4]} text-white font-bold border-2 border-transparent`;
    if (!showingResult || selectedAnswer === null) {
      if (selectedAnswer === index) return `${base} border-white ring-2 ring-white`;
      return `${base} hover:brightness-110`;
    }
    const currentResult = answers.find(a => a.questionIndex === currentQuestionIndex);
    if (!currentResult) return `${ANSWER_COLORS[index % 4]} text-white/70 opacity-70`;
    if (index === currentResult.correctAnswer) return 'bg-green-600 text-white border-2 border-green-400';
    if (index === selectedAnswer && !currentResult.isCorrect) return 'bg-red-600 text-white border-2 border-red-400';
    return `${ANSWER_COLORS[index % 4]} text-white/70 opacity-70`;
  };

  if (waitingForNewQuestions) {
    return (
      <div className="absolute inset-0 bg-game-bg flex items-center justify-center z-50">
        <div className="bg-game-card border-2 border-game-accent rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl">
          <div className="flex items-center justify-center gap-2 mb-2">
            <h2 className="text-2xl font-bold text-white uppercase">YOU GOT TAGGED!</h2>
            <RefreshCw className="w-7 h-7 text-game-icon flex-shrink-0" />
          </div>
          <p className="text-white text-center text-sm mb-4">Try again with new questions...</p>
          <div className="flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-game-accent border-t-game-icon"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return null;
  }

  const progressPercent = passThreshold > 0 ? Math.min(100, (correctCount / passThreshold) * 100) : 0;

  return (
    <div className="absolute inset-0 bg-game-bg flex items-center justify-center z-50">
      <div className="bg-game-card rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl border border-game-accent/30">
        {/* Header: YOU GOT TAGGED! + icon */}
        <div className="flex items-center justify-center gap-2 mb-1">
          <h2 className="text-2xl md:text-3xl font-bold text-white uppercase animate-pulse">
            YOU GOT TAGGED!
          </h2>
          <RefreshCw className="w-7 h-7 text-game-icon flex-shrink-0" aria-hidden />
        </div>
        <p className="text-white text-center text-sm mb-4">
          Answer {passThreshold} questions to unfreeze
        </p>

        {/* Progress pill */}
        <div className="flex justify-center mb-4">
          <span className="px-4 py-1.5 rounded-full bg-game-pill border border-game-accent text-white font-mono text-sm">
            {currentQuestionIndex + 1} / {questions.length}
          </span>
        </div>

        {/* Question */}
        <div className="bg-game-pill/60 rounded-xl p-4 mb-5 border border-game-accent/40">
          {currentQuestion.questionImage && (
            <div className="flex justify-center mb-3">
              <img src={currentQuestion.questionImage} alt="" className="max-h-32 max-w-full object-contain rounded" />
            </div>
          )}
          <p className="text-white text-lg font-bold text-center">{currentQuestion.question}</p>
        </div>

        {/* Options: 2x2 grid with number badges */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {currentQuestion.options.map((option, index) => (
            <button
              key={index}
              onClick={() => handleAnswer(index)}
              disabled={showingResult || selectedAnswer !== null}
              className={`relative p-4 rounded-xl text-center font-bold transition-all min-h-[80px] flex flex-col items-center justify-center ${getAnswerStyle(index)}`}
            >
              <span className="absolute top-2 right-2 w-6 h-6 rounded-md bg-black/40 flex items-center justify-center text-white text-xs font-mono">
                {index + 1}
              </span>
              {currentQuestion.optionImages?.[index] ? (
                <img src={currentQuestion.optionImages[index]!} alt="" className="max-h-16 max-w-full object-contain rounded mb-1" />
              ) : null}
              {option ? <span className="text-sm md:text-base">{option}</span> : null}
            </button>
          ))}
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-game-pill rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-game-accent transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Result feedback */}
        {showingResult && answers.length > 0 && (
          <div className="text-center mb-2">
            {answers[answers.length - 1]?.isCorrect ? (
              <p className="text-green-400 text-xl font-bold animate-pulse">CORRECT!</p>
            ) : (
              <p className="text-red-400 text-xl font-bold animate-pulse">WRONG!</p>
            )}
          </div>
        )}

        <p className="text-white/70 text-center text-sm">
          {correctCount} correct of {passThreshold} needed
        </p>
      </div>
    </div>
  );
};

export default UnfreezeQuiz;
