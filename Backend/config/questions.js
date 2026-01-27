/**
 * Quiz Questions Database
 * Questions for catch quiz system
 */

export const QUIZ_QUESTIONS = [
    { q: "12 + 15 = ?", options: ["25", "27", "30"], a: 1 },
    { q: "Capital of France?", options: ["Berlin", "London", "Paris"], a: 2 },
    { q: "H2O is...", options: ["Water", "Salt", "Air"], a: 0 },
    { q: "Fastest land animal?", options: ["Cheetah", "Lion", "Horse"], a: 0 },
    { q: "Red Planet?", options: ["Venus", "Mars", "Jupiter"], a: 1 },
    { q: "5 * 6 = ?", options: ["30", "36", "25"], a: 0 },
    { q: "Opposite of Cold?", options: ["Ice", "Wet", "Hot"], a: 2 },
    { q: "Spiders legs count?", options: ["6", "8", "10"], a: 1 },
    { q: "Banana color?", options: ["Yellow", "Blue", "Purple"], a: 0 },
    { q: "Sqrt(81)?", options: ["8", "9", "7"], a: 1 },
    { q: "Boiling point (C)?", options: ["90", "100", "120"], a: 1 },
    { q: "Primary color?", options: ["Green", "Red", "Orange"], a: 1 },
    { q: "How many continents?", options: ["5", "6", "7"], a: 2 },
    { q: "Who painted Mona Lisa?", options: ["Picasso", "Da Vinci", "Van Gogh"], a: 1 },
    { q: "Largest ocean?", options: ["Atlantic", "Indian", "Pacific"], a: 2 },
    { q: "10 * 10 = ?", options: ["100", "110", "90"], a: 0 },
    { q: "Smallest prime number?", options: ["0", "1", "2"], a: 2 },
    { q: "Days in a week?", options: ["5", "6", "7"], a: 2 },
    { q: "How many players in football?", options: ["9", "10", "11"], a: 2 },
    { q: "Capital of Japan?", options: ["Seoul", "Tokyo", "Beijing"], a: 1 },
    { q: "Author of Harry Potter?", options: ["Rowling", "Tolkien", "King"], a: 0 },
    { q: "Largest planet?", options: ["Earth", "Saturn", "Jupiter"], a: 2 },
    { q: "25 / 5 = ?", options: ["4", "5", "6"], a: 1 },
    { q: "Currency of UK?", options: ["Euro", "Pound", "Dollar"], a: 1 },
    { q: "Number of months?", options: ["10", "11", "12"], a: 2 },
    { q: "Tallest mammal?", options: ["Elephant", "Giraffe", "Whale"], a: 1 },
    { q: "100 - 37 = ?", options: ["63", "73", "53"], a: 0 },
    { q: "Coldest continent?", options: ["Arctic", "Antarctica", "Asia"], a: 1 },
    { q: "Sides in pentagon?", options: ["4", "5", "6"], a: 1 },
    { q: "Gas for breathing?", options: ["Nitrogen", "Oxygen", "Carbon"], a: 1 }
];

/**
 * Get random quiz questions
 * @param {number} count - Number of questions needed
 * @returns {Array} Array of random questions with IDs
 */
export function getRandomQuestions(count = 5) {
    const shuffled = [...QUIZ_QUESTIONS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map((q, index) => ({
        id: index,
        question: q.q,
        options: q.options,
        correctAnswer: q.a
    }));
}

/**
 * Quiz configuration for collision quiz (original system)
 */
export const QUIZ_CONFIG = {
    QUESTIONS_PER_QUIZ: 5,
    TOTAL_TIME_LIMIT: 120000, // 2 minutes in milliseconds
    TIME_PER_QUESTION: 24000 // 24 seconds per question (120s / 5 questions)
};

/**
 * Blitz Quiz configuration for game loop system
 * Single question, all players answer simultaneously
 */
export const BLITZ_QUIZ_CONFIG = {
    QUESTIONS_PER_BLITZ: 1,           // Single question per Blitz
    TIME_LIMIT: 15000,                // 15 seconds total
    COUNTDOWN_BEFORE_START: 3000,     // 3 second countdown before question shows
    MIN_PLAYERS_FOR_RESERVE: 3        // Need at least 3 players for reserve unicorn
};

/**
 * Get a single random question for Blitz Quiz
 * @returns {Object} Single question with id
 */
export function getBlitzQuestion() {
    const randomIndex = Math.floor(Math.random() * QUIZ_QUESTIONS.length);
    const q = QUIZ_QUESTIONS[randomIndex];
    return {
        id: randomIndex,
        question: q.q,
        options: q.options,
        correctAnswer: q.a
    };
}
