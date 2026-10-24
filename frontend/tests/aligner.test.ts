import { describe, it, expect } from 'vitest';
import {
  align,
  normalizeText,
  roundHalfUp,
  MAX_INPUT_LENGTH,
  MAX_TOKENS,
} from '../src/utils/aligner';
import alignmentFixtures from '../../shared/fixtures/alignment.json';

describe('Shared Normalizer and Aligner (TypeScript)', () => {
  it('passes all Section 7.4 shared alignment fixtures identically', () => {
    const cases = alignmentFixtures.cases;
    expect(cases.length).toBeGreaterThanOrEqual(12);

    for (const testCase of cases) {
      const result = align(testCase.target, testCase.input);

      if ('expected_distance' in testCase) {
        expect(result.distance, `Case ${testCase.id} distance`).toBe(testCase.expected_distance);
      }

      if ('expected_score' in testCase) {
        expect(result.score, `Case ${testCase.id} score`).toBe(testCase.expected_score);
      }

      if ('expected_exact' in testCase) {
        expect(result.is_exact, `Case ${testCase.id} is_exact`).toBe(testCase.expected_exact);
      }

      if ('expected_substitutions' in testCase) {
        expect(result.substitutions, `Case ${testCase.id} substitutions`).toBe(testCase.expected_substitutions);
      }

      if ('expected_omissions' in testCase) {
        expect(result.omissions, `Case ${testCase.id} omissions`).toBe(testCase.expected_omissions);
      }

      if ('expected_insertions' in testCase) {
        expect(result.insertions, `Case ${testCase.id} insertions`).toBe(testCase.expected_insertions);
      }

      if ('expected_operations' in testCase) {
        const actualOps = result.aligned_tokens.map((at) => at.operation);
        expect(actualOps, `Case ${testCase.id} operations`).toEqual(testCase.expected_operations);
      }
    }
  });

  it('correctly maps DisplayToken to CanonicalTokens for contractions', () => {
    const norm = normalizeText("I've been here.");
    expect(norm.display_tokens.length).toBe(3);
    expect(norm.display_tokens[0].text).toBe("I've");
    expect(norm.display_tokens[0].canonical_indices).toEqual([0, 1]);

    expect(norm.canonical_tokens.length).toBe(4);
    expect(norm.canonical_tokens[0].value).toBe('i');
    expect(norm.canonical_tokens[0].display_index).toBe(0);
    expect(norm.canonical_tokens[1].value).toBe('have');
    expect(norm.canonical_tokens[1].display_index).toBe(0);
    expect(norm.canonical_tokens[2].value).toBe('been');
    expect(norm.canonical_tokens[2].display_index).toBe(1);
    expect(norm.canonical_tokens[3].value).toBe('here');
    expect(norm.canonical_tokens[3].display_index).toBe(2);
  });

  it('throws an error for empty target string', () => {
    expect(() => align('', 'hello')).toThrow('Normalized target contains no valid tokens');
    expect(() => align('... !?', 'hello')).toThrow('Normalized target contains no valid tokens');
  });

  it('handles empty user input gracefully as all omissions', () => {
    const res = align('Hello world!', '');
    expect(res.distance).toBe(2);
    expect(res.score).toBe(0);
    expect(res.is_exact).toBe(false);
    expect(res.omissions).toBe(2);
    expect(res.insertions).toBe(0);
    expect(res.substitutions).toBe(0);
    expect(res.aligned_tokens.length).toBe(2);
    expect(res.aligned_tokens.every((at) => at.operation === 'omission')).toBe(true);
  });

  it('implements roundHalfUp matching floor(x + 0.5)', () => {
    expect(roundHalfUp(75.0)).toBe(75);
    expect(roundHalfUp(66.6666667)).toBe(67);
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(0.499999)).toBe(0);
    expect(roundHalfUp(2.5)).toBe(3);
  });

  it('clamps input character length and token count', () => {
    const longInput = 'word '.repeat(600);
    expect(longInput.length).toBeGreaterThan(MAX_INPUT_LENGTH);
    const res = align('word', longInput);
    expect(res.input_tokens_count).toBeLessThanOrEqual(MAX_TOKENS);
  });

  it('expands gonna and wanna correctly', () => {
    const res1 = align("I'm gonna leave", 'i am going to leave');
    expect(res1.is_exact).toBe(true);
    expect(res1.score).toBe(100);
    expect(res1.distance).toBe(0);

    const res2 = align('I wanna go', 'i want to go');
    expect(res2.is_exact).toBe(true);
    expect(res2.score).toBe(100);
    expect(res2.distance).toBe(0);
  });
});
