/**
 * Quizizz / external quiz service
 * Fetches and normalizes questions from Quizizz API for blitz and unfreeze quizzes.
 */

import { QUIZIZZ_CONFIG } from '../config/constants.js';
import log from '../utils/logger.js';

/**
 * Strip HTML tags and decode common entities to plain text (Node-safe, no DOM).
 * @param {string} html - HTML string
 * @returns {string} Plain text
 */
function stripHtml(html) {
    if (typeof html !== 'string') return '';
    let text = html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const entities = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
    Object.entries(entities).forEach(([entity, char]) => {
        text = text.split(entity).join(char);
    });
    return text;
}

/**
 * Build full Quizizz API URL for a quiz ID.
 * @param {string} quizId - Quiz ID
 * @returns {string} Full URL
 */
function buildQuizUrl(quizId) {
    const base = QUIZIZZ_CONFIG.getBaseUrl();
    const path = `${QUIZIZZ_CONFIG.QUIZ_PATH}/${encodeURIComponent(quizId)}?${QUIZIZZ_CONFIG.QUERY}`;
    return `${base}${path}`;
}

/**
 * Extract question image URL from structure.query.media (first element with type === 'image' and url).
 * @param {Array|undefined} media - structure.query.media
 * @returns {string|null}
 */
function getQuestionImageUrl(media) {
    const first = Array.isArray(media) && media[0] ? media[0] : null;
    if (!first || first.type !== 'image' || typeof first.url !== 'string') return null;
    return first.url;
}

/**
 * Extract option image URL from option.media (first element with url).
 * @param {object} opt - option object
 * @returns {string|null}
 */
function getOptionImageUrl(opt) {
    const first = opt?.media?.[0];
    if (!first || typeof first.url !== 'string') return null;
    return first.url;
}

/**
 * Fetch quiz from Quizizz API and normalize to QbitMaze question shape.
 * Shape: { id, question, options, correctAnswer, questionImage, optionImages }
 * @param {string} quizId - Quiz ID
 * @returns {Promise<Array<{id: number, question: string, options: string[], correctAnswer: number, questionImage: string|null, optionImages: (string|null)[]}>|null>} Normalized questions or null on error/empty
 */
async function fetchAndNormalizeQuestions(quizId) {
    if (!quizId || typeof quizId !== 'string') return null;
    const url = buildQuizUrl(quizId);
    const timeoutMs = QUIZIZZ_CONFIG.FETCH_TIMEOUT_MS ?? 10000;

    let response;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
    } catch (err) {
        log.warn({ quizId, err: err.message }, 'Quizizz fetch failed');
        return null;
    }

    if (!response.ok) {
        log.warn({ quizId, status: response.status }, 'Quizizz fetch bad status');
        return null;
    }

    let data;
    try {
        data = await response.json();
    } catch (err) {
        log.warn({ quizId, err: err.message }, 'Quizizz parse JSON failed');
        return null;
    }

    const quiz = data?.data?.quiz ?? data?.quiz ?? data;
    const rawQuestions = quiz?.info?.questions ?? quiz?.questions ?? [];
    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
        log.warn({ quizId }, 'Quizizz no questions');
        return null;
    }

    const normalized = [];
    for (let i = 0; i < rawQuestions.length; i++) {
        const item = rawQuestions[i];
        const structure = item?.structure;
        if (!structure?.query?.text || !Array.isArray(structure.options)) continue;
        const questionText = stripHtml(structure.query.text);
        const options = structure.options.map(opt => stripHtml(opt?.text ?? ''));
        const correctAnswer = typeof structure.answer === 'number' ? structure.answer : 0;
        if (correctAnswer < 0 || correctAnswer >= options.length) continue;
        const questionImage = getQuestionImageUrl(structure.query?.media);
        const optionImages = structure.options.map(opt => getOptionImageUrl(opt));
        normalized.push({
            id: i,
            question: questionText,
            options,
            correctAnswer,
            questionImage: questionImage ?? null,
            optionImages
        });
    }

    if (normalized.length === 0) {
        log.warn({ quizId }, 'Quizizz no valid questions after normalize');
        return null;
    }
    log.info({ quizId, count: normalized.length }, 'Quizizz loaded questions');
    return normalized;
}

const quizizzService = {
    buildQuizUrl,
    stripHtml,
    fetchAndNormalizeQuestions
};

export default quizizzService;
