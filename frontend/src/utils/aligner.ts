/**
 * Shared Normalizer and Aligner for FluentTube AI (TypeScript implementation).
 * Implements Section 7 of the specification:
 * - Unicode NFKC normalization
 * - Typographic apostrophe normalization
 * - Tokenization with internal apostrophes, hyphens as delimiters
 * - Explicit contraction expansion dictionary
 * - Token-level Levenshtein distance with fixed tie-breaking: diagonal > omission > insertion
 * - Unified round_half_up: floor(x + 0.5)
 */

export const RULES_VERSION = 1;
export const MAX_INPUT_LENGTH = 2000;
export const MAX_TOKENS = 256;

export const DEFAULT_CONTRACTIONS: Record<string, string[]> = {
  "i'm": ["i", "am"],
  "you're": ["you", "are"],
  "we're": ["we", "are"],
  "they're": ["they", "are"],
  "i've": ["i", "have"],
  "you've": ["you", "have"],
  "we've": ["we", "have"],
  "they've": ["they", "have"],
  "don't": ["do", "not"],
  "doesn't": ["does", "not"],
  "didn't": ["did", "not"],
  "can't": ["can", "not"],
  "cannot": ["can", "not"],
  "won't": ["will", "not"],
  "isn't": ["is", "not"],
  "aren't": ["are", "not"],
  "wasn't": ["was", "not"],
  "weren't": ["were", "not"],
  "haven't": ["have", "not"],
  "hasn't": ["has", "not"],
  "hadn't": ["had", "not"],
  "couldn't": ["could", "not"],
  "shouldn't": ["should", "not"],
  "wouldn't": ["would", "not"],
  "i'll": ["i", "will"],
  "you'll": ["you", "will"],
  "he'll": ["he", "will"],
  "she'll": ["she", "will"],
  "it'll": ["it", "will"],
  "we'll": ["we", "will"],
  "they'll": ["they", "will"],
  "gonna": ["going", "to"],
  "wanna": ["want", "to"],
};

export interface DisplayToken {
  index: number;
  text: string;
  canonical_indices: number[];
  start_char: number;
  end_char: number;
}

export interface CanonicalToken {
  index: number;
  value: string;
  display_index: number;
}

export interface NormalizedText {
  raw_text: string;
  normalized_text: string;
  display_tokens: DisplayToken[];
  canonical_tokens: CanonicalToken[];
}

export type AlignmentOp = 'match' | 'substitution' | 'omission' | 'insertion';

export interface AlignedToken {
  operation: AlignmentOp;
  target_token: string | null;
  target_index: number | null;
  target_display_index: number | null;
  input_token: string | null;
  input_index: number | null;
}

export interface AlignmentResult {
  rules_version: number;
  score: number;
  distance: number;
  is_exact: boolean;
  substitutions: number;
  omissions: number;
  insertions: number;
  target_tokens_count: number;
  input_tokens_count: number;
  aligned_tokens: AlignedToken[];
  target_normalized: NormalizedText;
  input_normalized: NormalizedText;
}

/**
 * Shared non-negative rounding: floor(x + 0.5)
 */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/**
 * Normalizes typographic apostrophes and single quotation marks to ASCII '
 */
export function normalizeApostrophes(text: string): string {
  return text
    .replace(/\u2019/g, "'") // right single quote
    .replace(/\u2018/g, "'") // left single quote
    .replace(/\u02BB/g, "'") // modifier letter turned comma
    .replace(/\u02BC/g, "'") // modifier letter apostrophe
    .replace(/\u0092/g, "'") // Windows-1252 right single quote decoded as latin-1
    .replace(/\u0091/g, "'") // Windows-1252 left single quote decoded as latin-1
    .replace(/`/g, "'");     // backtick
}

// Regex matching alphanumeric sequences with internal apostrophes
const WORD_PATTERN = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;

/**
 * Executes Section 7.1 Pipeline v1:
 * 1. Unicode NFKC normalization
 * 2. Normalize typographic apostrophes to ASCII '
 * 3. Extract words (sequences of letters/digits with internal apostrophes; hyphens delimit)
 * 4. Retain original text for display, convert to lowercase for comparison
 * 5. Expand whole tokens via explicit dictionary
 * 10. Clamp input to 2000 chars and 256 tokens
 */
export function normalizeText(text: string, isInput = false): NormalizedText {
  if (text == null) {
    text = '';
  }

  const raw_text = text;
  if (isInput && text.length > MAX_INPUT_LENGTH) {
    text = text.slice(0, MAX_INPUT_LENGTH);
  }

  // Step 1: NFKC
  const nfkc_text = text.normalize('NFKC');

  // Step 2: Apostrophes
  const cleaned_text = normalizeApostrophes(nfkc_text);

  // Step 3, 4, 5: Token extraction and expansion
  const display_tokens: DisplayToken[] = [];
  const canonical_tokens: CanonicalToken[] = [];

  const regex = new RegExp(WORD_PATTERN);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cleaned_text)) !== null) {
    if (canonical_tokens.length >= MAX_TOKENS) {
      break;
    }

    const word_text = match[0];
    const start_char = match.index;
    const end_char = regex.lastIndex;

    const lowered = word_text.toLowerCase();
    const expanded = DEFAULT_CONTRACTIONS[lowered] || [lowered];

    const display_index = display_tokens.length;
    const canonical_indices: number[] = [];

    for (const sub_word of expanded) {
      if (canonical_tokens.length >= MAX_TOKENS) {
        break;
      }
      const c_index = canonical_tokens.length;
      canonical_tokens.push({
        index: c_index,
        value: sub_word,
        display_index,
      });
      canonical_indices.push(c_index);
    }

    if (canonical_indices.length > 0) {
      display_tokens.push({
        index: display_index,
        text: word_text,
        canonical_indices,
        start_char,
        end_char,
      });
    }
  }

  return {
    raw_text,
    normalized_text: cleaned_text,
    display_tokens,
    canonical_tokens,
  };
}

/**
 * Computes token-level Levenshtein alignment between target and user input.
 * Fixed tie-breaking priority: diagonal (match/substitution) > target omission > input insertion.
 */
export function align(targetText: string, inputText: string): AlignmentResult {
  const targetNorm = normalizeText(targetText, false);
  const inputNorm = normalizeText(inputText, true);

  const targetTokens = targetNorm.canonical_tokens;
  const inputTokens = inputNorm.canonical_tokens;

  const n = targetTokens.length;
  const m = inputTokens.length;

  if (n === 0) {
    throw new Error('Normalized target contains no valid tokens');
  }

  // If input is empty, every target token is an omission
  if (m === 0) {
    const alignedTokens: AlignedToken[] = targetTokens.map((t) => ({
      operation: 'omission',
      target_token: t.value,
      target_index: t.index,
      target_display_index: t.display_index,
      input_token: null,
      input_index: null,
    }));

    return {
      rules_version: RULES_VERSION,
      score: 0,
      distance: n,
      is_exact: false,
      substitutions: 0,
      omissions: n,
      insertions: 0,
      target_tokens_count: n,
      input_tokens_count: 0,
      aligned_tokens: alignedTokens,
      target_normalized: targetNorm,
      input_normalized: inputNorm,
    };
  }

  // (N+1) x (M+1) DP matrix
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let r = 0; r <= n; r++) {
    dp[r][0] = r;
  }
  for (let c = 0; c <= m; c++) {
    dp[0][c] = c;
  }

  for (let r = 1; r <= n; r++) {
    const tVal = targetTokens[r - 1].value;
    for (let c = 1; c <= m; c++) {
      const iVal = inputTokens[c - 1].value;
      const cost = tVal === iVal ? 0 : 1;

      const diagCost = dp[r - 1][c - 1] + cost;
      const omissionCost = dp[r - 1][c] + 1;
      const insertionCost = dp[r][c - 1] + 1;

      dp[r][c] = Math.min(diagCost, omissionCost, insertionCost);
    }
  }

  // Backtracking with fixed tie-breaking priority:
  // 1. Diagonal (match / substitution)
  // 2. Target omission (up)
  // 3. Input insertion (left)
  const alignedReversed: AlignedToken[] = [];
  let r = n;
  let c = m;

  while (r > 0 || c > 0) {
    if (r > 0 && c > 0) {
      const tTok = targetTokens[r - 1];
      const iTok = inputTokens[c - 1];
      const cost = tTok.value === iTok.value ? 0 : 1;

      // Check 1: diagonal
      if (dp[r][c] === dp[r - 1][c - 1] + cost) {
        const op: AlignmentOp = cost === 0 ? 'match' : 'substitution';
        alignedReversed.push({
          operation: op,
          target_token: tTok.value,
          target_index: tTok.index,
          target_display_index: tTok.display_index,
          input_token: iTok.value,
          input_index: iTok.index,
        });
        r--;
        c--;
        continue;
      }

      // Check 2: target omission
      if (dp[r][c] === dp[r - 1][c] + 1) {
        alignedReversed.push({
          operation: 'omission',
          target_token: tTok.value,
          target_index: tTok.index,
          target_display_index: tTok.display_index,
          input_token: null,
          input_index: null,
        });
        r--;
        continue;
      }

      // Check 3: input insertion
      alignedReversed.push({
        operation: 'insertion',
        target_token: null,
        target_index: null,
        target_display_index: null,
        input_token: iTok.value,
        input_index: iTok.index,
      });
      c--;
      continue;
    }

    if (r > 0) {
      // Only omission possible
      const tTok = targetTokens[r - 1];
      alignedReversed.push({
        operation: 'omission',
        target_token: tTok.value,
        target_index: tTok.index,
        target_display_index: tTok.display_index,
        input_token: null,
        input_index: null,
      });
      r--;
      continue;
    }

    if (c > 0) {
      // Only insertion possible
      const iTok = inputTokens[c - 1];
      alignedReversed.push({
        operation: 'insertion',
        target_token: null,
        target_index: null,
        target_display_index: null,
        input_token: iTok.value,
        input_index: iTok.index,
      });
      c--;
      continue;
    }
  }

  alignedReversed.reverse();
  const alignedTokens = alignedReversed;

  let substitutions = 0;
  let omissions = 0;
  let insertions = 0;

  for (const at of alignedTokens) {
    if (at.operation === 'substitution') substitutions++;
    else if (at.operation === 'omission') omissions++;
    else if (at.operation === 'insertion') insertions++;
  }

  const distance = substitutions + omissions + insertions;
  const score = roundHalfUp(100.0 * Math.max(0.0, 1.0 - distance / n));
  const is_exact = distance === 0;

  return {
    rules_version: RULES_VERSION,
    score,
    distance,
    is_exact,
    substitutions,
    omissions,
    insertions,
    target_tokens_count: n,
    input_tokens_count: m,
    aligned_tokens: alignedTokens,
    target_normalized: targetNorm,
    input_normalized: inputNorm,
  };
}
