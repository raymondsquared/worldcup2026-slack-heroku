'use strict';

const { LOW_CONFIDENCE_PHRASE } = require('./personas');

// Normalize for comparison: lowercase, strip trailing punctuation/whitespace
const NORMALIZED_PHRASE = LOW_CONFIDENCE_PHRASE.toLowerCase().replace(/[.!?]+$/, '');

function isLowConfidence(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = text.trim().toLowerCase();
  return normalized.includes(NORMALIZED_PHRASE);
}

module.exports = { isLowConfidence };
