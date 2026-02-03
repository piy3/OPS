/**
 * Unfreeze Quiz Component
 * Overlay shown when a player is frozen (tagged by unicorn)
 * Player must answer questions correctly to respawn
 */

import React, { useState, useEffect } from 'react';
import socketService from '@/services/SocketService';

interface UnfreezeQuestion {
  id: number;
  question: string;
  options: string[];
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
    const unsubAnswerResult = socketService.on('unfreeze_quiz_answer_result', (data: any) => {
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

    const unsubComplete = socketService.on('unfreeze_quiz_complete', (data: any) => {
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
    if (!showingResult || selectedAnswer === null) {
      // Not showing result yet
      if (selectedAnswer === index) {
        return 'bg-cyan-600 text-white border-2 border-cyan-400';
      }
      return 'bg-slate-700 hover:bg-slate-600 text-white hover:border-cyan-400 border-2 border-transparent';
    }

    // Showing result
    const currentResult = answers.find(a => a.questionIndex === currentQuestionIndex);
    if (!currentResult) return 'bg-slate-700 text-slate-400';

    if (index === currentResult.correctAnswer) {
      return 'bg-green-600 text-white border-2 border-green-400';
    }
    if (index === selectedAnswer && !currentResult.isCorrect) {
      return 'bg-red-600 text-white border-2 border-red-400';
    }
    return 'bg-slate-700 text-slate-400';
  };

  if (waitingForNewQuestions) {
    return (
      <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
        <div className="bg-slate-800 border-2 border-red-500 rounded-xl p-8 max-w-lg w-full mx-4 shadow-2xl shadow-red-500/20">
          <h2 className="text-2xl font-bold text-red-400 text-center mb-4">WRONG!</h2>
          <p className="text-white text-center text-lg mb-4">Try again with new questions...</p>
          <div className="flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return null;
  }

  return (
    <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
      <div className="bg-slate-800 border-2 border-cyan-500 rounded-xl p-8 max-w-lg w-full mx-4 shadow-2xl shadow-cyan-500/20">
        {/* Header */}
        <div className="flex items-center justify-center mb-6">
          <h2 className="text-2xl font-bold text-cyan-400 animate-pulse">
            YOU'VE BEEN FROZEN!
          </h2>
        </div>

        {/* Ice particles effect */}
        <div className="absolute top-0 left-0 right-0 h-20 overflow-hidden pointer-events-none">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 bg-cyan-300 rounded-full opacity-60 animate-bounce"
              style={{
                left: `${10 + i * 12}%`,
                animationDelay: `${i * 0.2}s`,
                animationDuration: '2s'
              }}
            />
          ))}
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-4">
          {questions.map((_, index) => (
            <div
              key={index}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                index < currentQuestionIndex
                  ? answers[index]?.isCorrect
                    ? 'bg-green-600 text-white'
                    : 'bg-red-600 text-white'
                  : index === currentQuestionIndex
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-600 text-slate-400'
              }`}
            >
              {index < currentQuestionIndex ? (
                answers[index]?.isCorrect ? '✓' : '✗'
              ) : (
                index + 1
              )}
            </div>
          ))}
        </div>

        {/* Info text */}
        <div className="text-center mb-4">
          <p className="text-cyan-300 text-sm">
            Answer {needToPass > 0 ? `${needToPass} more` : '0 more'} correctly to unfreeze!
          </p>
        </div>

        {/* Question */}
        <div className="bg-slate-900 rounded-lg p-4 mb-6 border border-cyan-800">
          <p className="text-white text-lg text-center">{currentQuestion.question}</p>
        </div>

        {/* Options */}
        <div className="space-y-3">
          {currentQuestion.options.map((option, index) => (
            <button
              key={index}
              onClick={() => handleAnswer(index)}
              disabled={showingResult || selectedAnswer !== null}
              className={`w-full p-4 rounded-lg text-left font-medium transition-all ${getAnswerStyle(index)}`}
            >
              <span className="inline-block w-8 h-8 rounded-full bg-slate-600 text-center leading-8 mr-3">
                {String.fromCharCode(65 + index)}
              </span>
              {option}
            </button>
          ))}
        </div>

        {/* Result feedback */}
        {showingResult && answers.length > 0 && (
          <div className="mt-6 text-center">
            {answers[answers.length - 1]?.isCorrect ? (
              <p className="text-green-400 text-xl font-bold animate-pulse">
                CORRECT!
              </p>
            ) : (
              <p className="text-red-400 text-xl font-bold animate-pulse">
                WRONG!
              </p>
            )}
          </div>
        )}

        {/* Score display */}
        <div className="mt-4 text-center">
          <p className="text-slate-400 text-sm">
            Score: {correctCount} / {answers.length} answered
          </p>
        </div>
      </div>
    </div>
  );
};

export default UnfreezeQuiz;
