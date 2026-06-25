'use strict';

// Trust-layer guardrails. All masking, sanitization, and toxicity matching is
// driven by the named pattern lists below so the rules are easy to scan in one
// place and extend without touching the function bodies.

// PII masked out before the prompt reaches MIA and restored in the response.
const SAMPLE_PII_PATTERNS = [
  { type: 'EMAIL', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'PHONE', regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g },
];

// Prompt-injection fragments stripped from user input (defense-in-depth on top
// of role separation).
const SAMPLE_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /system\s*:/gi,
  /---+|```+/g,
];

// Toxic phrases. A match rejects the input before MIA is called, or suppresses
// the output, replacing it with TOXIC_REPLY. Add patterns here to widen scope.
const SAMPLE_TOXIC_PATTERNS = [/harm yourself/i, /self-harm/i];

const TOXIC_REPLY = 'I can only help with World Cup 2026 questions.';

function maskPii(text) {
  const map = {};
  const counters = {};
  let masked = text;

  for (const { type, regex } of SAMPLE_PII_PATTERNS) {
    regex.lastIndex = 0;
    masked = masked.replace(regex, (match) => {
      counters[type] = (counters[type] || 0) + 1;
      const token = `[${type}_${counters[type]}]`;
      map[token] = match;
      return token;
    });
  }

  return { masked, map };
}

function sanitizeInput(text) {
  let sanitized = text;
  for (const pattern of SAMPLE_INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  return sanitized.trim();
}

function filterToxic(text) {
  if (SAMPLE_TOXIC_PATTERNS.some((pattern) => pattern.test(text))) {
    return { safe: false, text: TOXIC_REPLY };
  }
  return { safe: true, text };
}

function demaskPii(text, map) {
  let demasked = text;
  for (const [token, original] of Object.entries(map)) {
    demasked = demasked.replaceAll(token, original);
  }
  return demasked;
}

module.exports = { maskPii, demaskPii, sanitizeInput, filterToxic, TOXIC_REPLY };
