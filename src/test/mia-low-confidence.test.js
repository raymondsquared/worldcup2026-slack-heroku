'use strict';

const { isLowConfidence } = require('../mia/low-confidence');
const { LOW_CONFIDENCE_PHRASE } = require('../mia/personas');

describe('mia/low-confidence', () => {
  describe('detects the canonical low-confidence phrase', () => {
    test('detects exact phrase', () => {
      expect(isLowConfidence(LOW_CONFIDENCE_PHRASE)).toBe(true);
    });

    test('detects phrase with surrounding whitespace', () => {
      expect(isLowConfidence(`  ${LOW_CONFIDENCE_PHRASE}  `)).toBe(true);
    });

    test('detects phrase with newline', () => {
      expect(isLowConfidence(`\n${LOW_CONFIDENCE_PHRASE}\n`)).toBe(true);
    });

    test('detects phrase without trailing period', () => {
      expect(isLowConfidence("I don't have enough information to answer this")).toBe(true);
    });

    test('detects phrase with different casing', () => {
      expect(isLowConfidence("I Don't Have Enough Information To Answer This.")).toBe(true);
    });

    test('detects phrase with extra words before', () => {
      expect(isLowConfidence("I'm sorry, I don't have enough information to answer this.")).toBe(
        true,
      );
    });

    test('detects phrase with extra words after', () => {
      expect(
        isLowConfidence(
          "I don't have enough information to answer this. Could you provide more context?",
        ),
      ).toBe(true);
    });

    test('detects phrase wrapped in apology', () => {
      expect(
        isLowConfidence(
          "Unfortunately, I don't have enough information to answer this based on the context provided.",
        ),
      ).toBe(true);
    });
  });

  describe('returns false for non-matching responses', () => {
    test('returns false for normal answer', () => {
      expect(isLowConfidence('USA plays Mexico on June 12.')).toBe(false);
    });

    test('returns false for partial match (missing key words)', () => {
      expect(isLowConfidence("I don't have enough information")).toBe(false);
    });

    test('returns false for similar but different wording', () => {
      expect(isLowConfidence("I don't know.")).toBe(false);
    });

    test('returns false for confident answer mentioning information', () => {
      expect(isLowConfidence('Here is the information about the match: USA won 2-1.')).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(isLowConfidence('')).toBe(false);
    });

    test('returns false for null', () => {
      expect(isLowConfidence(null)).toBe(false);
    });

    test('returns false for undefined', () => {
      expect(isLowConfidence(undefined)).toBe(false);
    });
  });
});
