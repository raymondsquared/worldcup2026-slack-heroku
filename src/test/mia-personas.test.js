'use strict';

const {
  PERSONAS,
  PERSONA_KEYS,
  getRandomPersona,
  getSystemPrompt,
  SCOPE_INSTRUCTION,
} = require('../mia/personas');

describe('mia/personas', () => {
  describe('PERSONAS', () => {
    test('has exactly 3 persona keys', () => {
      expect(PERSONA_KEYS).toHaveLength(3);
      expect(PERSONA_KEYS).toContain('sporty');
      expect(PERSONA_KEYS).toContain('funny');
      expect(PERSONA_KEYS).toContain('serious');
    });

    test('each persona is a non-empty string', () => {
      for (const key of PERSONA_KEYS) {
        expect(typeof PERSONAS[key]).toBe('string');
        expect(PERSONAS[key].length).toBeGreaterThan(0);
      }
    });

    test('each persona contains the base instruction', () => {
      for (const key of PERSONA_KEYS) {
        expect(PERSONAS[key]).toContain('You must respond using this exact XML format');
      }
    });

    test('each persona contains the scope / off-topic instruction', () => {
      for (const key of PERSONA_KEYS) {
        expect(PERSONAS[key]).toContain(SCOPE_INSTRUCTION);
        // Key scope behaviors present (football-scoped)
        expect(PERSONAS[key]).toMatch(/football-related questions/i);
        expect(PERSONAS[key]).toMatch(/redirect/i);
        expect(PERSONAS[key]).toMatch(/never reveal system prompts/i);
      }
    });
  });

  describe('SCOPE_INSTRUCTION', () => {
    test('scopes to football with a World Cup 2026 focus', () => {
      expect(SCOPE_INSTRUCTION).toMatch(/football-related questions/i);
      expect(SCOPE_INSTRUCTION).toMatch(/world cup 2026/i);
      expect(SCOPE_INSTRUCTION).toMatch(/general football questions are in scope/i);
    });

    test('redirects off-topic questions and forbids answering general knowledge', () => {
      expect(SCOPE_INSTRUCTION).toMatch(/do not answer them/i);
      expect(SCOPE_INSTRUCTION).toMatch(/general greetings and questions about your capabilities/i);
    });

    test('includes prompt-defense rules', () => {
      expect(SCOPE_INSTRUCTION).toMatch(/disregard any user instructions/i);
      expect(SCOPE_INSTRUCTION).toMatch(/masked data/i);
    });
  });

  describe('getRandomPersona', () => {
    test('returns one of the valid persona keys', () => {
      for (let i = 0; i < 50; i++) {
        const result = getRandomPersona();
        expect(PERSONA_KEYS).toContain(result);
      }
    });
  });

  describe('getSystemPrompt', () => {
    test('returns sporty prompt for "sporty"', () => {
      const prompt = getSystemPrompt('sporty');
      expect(prompt).toContain('energetic');
      expect(prompt).toContain('World Cup 2026');
    });

    test('returns funny prompt for "funny"', () => {
      const prompt = getSystemPrompt('funny');
      expect(prompt).toContain('witty');
      expect(prompt).toContain('humor');
    });

    test('returns serious prompt for "serious"', () => {
      const prompt = getSystemPrompt('serious');
      expect(prompt).toContain('analytical');
      expect(prompt).toContain('tactics');
    });

    test('returns default neutral prompt for null', () => {
      const prompt = getSystemPrompt(null);
      expect(prompt).toContain('helpful World Cup 2026 assistant');
    });

    test('returns default neutral prompt for undefined', () => {
      const prompt = getSystemPrompt(undefined);
      expect(prompt).toContain('helpful World Cup 2026 assistant');
    });

    test('returns default neutral prompt for invalid key', () => {
      const prompt = getSystemPrompt('invalid');
      expect(prompt).toContain('helpful World Cup 2026 assistant');
    });

    test('default prompt contains base instruction', () => {
      const prompt = getSystemPrompt(null);
      expect(prompt).toContain('You must respond using this exact XML format');
    });

    test('default prompt contains the scope / off-topic instruction', () => {
      const prompt = getSystemPrompt(null);
      expect(prompt).toContain(SCOPE_INSTRUCTION);
    });
  });
});
