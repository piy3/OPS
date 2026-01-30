/**
 * Character configuration for player avatars
 * Maps character IDs to their metadata and images
 */

// Import character images
import oneImg from '../assets/characters/one.png';
import twoImg from '../assets/characters/two.png';
import threeImg from '../assets/characters/three.png';
import fourImg from '../assets/characters/four.png';
import fiveImg from '../assets/characters/five.png';
import sixImg from '../assets/characters/six.png';
import sevenImg from '../assets/characters/seven.png';
import eightImg from '../assets/characters/eight.png';

// Character IDs in order (must match backend CHARACTER_IDS)
export const CHARACTER_IDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * Character map: id -> { id, name, image }
 * Frontend owns this map and resolves id -> image locally
 */
export const CHARACTER_MAP = {
  one: {
    id: 'one',
    name: 'Character One',
    image: oneImg
  },
  two: {
    id: 'two',
    name: 'Character Two',
    image: twoImg
  },
  three: {
    id: 'three',
    name: 'Character Three',
    image: threeImg
  },
  four: {
    id: 'four',
    name: 'Character Four',
    image: fourImg
  },
  five: {
    id: 'five',
    name: 'Character Five',
    image: fiveImg
  },
  six: {
    id: 'six',
    name: 'Character Six',
    image: sixImg
  },
  seven: {
    id: 'seven',
    name: 'Character Seven',
    image: sevenImg
  },
  eight: {
    id: 'eight',
    name: 'Character Eight',
    image: eightImg
  },
  // nine uses eight as placeholder until nine.png is created
  nine: {
    id: 'nine',
    name: 'Character Nine',
    image: eightImg // Placeholder - replace with nineImg when available
  }
};

/**
 * Get character by ID with fallback
 * @param {string} characterId - The character ID
 * @returns {Object|null} Character object or null if not found
 */
export const getCharacter = (characterId) => {
  return CHARACTER_MAP[characterId] || null;
};

/**
 * Get character image URL by ID
 * @param {string} characterId - The character ID
 * @returns {string|null} Image URL or null if not found
 */
export const getCharacterImage = (characterId) => {
  const character = CHARACTER_MAP[characterId];
  return character?.image || null;
};

/**
 * Build a map of character ID -> image URL for all characters
 * Useful for passing to Phaser for texture loading
 * @returns {Object} Map of characterId -> imageUrl
 */
export const getCharacterImageUrls = () => {
  const urls = {};
  Object.keys(CHARACTER_MAP).forEach(id => {
    urls[id] = CHARACTER_MAP[id].image;
  });
  return urls;
};

export default CHARACTER_MAP;
