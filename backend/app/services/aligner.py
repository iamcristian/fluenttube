"""
Shared Normalizer and Aligner for FluentTube AI (Python implementation).
Implements Section 7 of the specification:
- Unicode NFKC normalization
- Typographic apostrophe normalization
- Tokenization with internal apostrophes, hyphens as delimiters
- Explicit contraction expansion dictionary
- Token-level Levenshtein distance with fixed tie-breaking: diagonal > omission > insertion
- Unified round_half_up: floor(x + 0.5)
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

# Load shared normalization rules
RULES_FILE = Path(__file__).resolve().parents[3] / "shared" / "normalization-rules.json"

DEFAULT_CONTRACTIONS: dict[str, list[str]] = {
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
}

if RULES_FILE.exists():
    try:
        with open(RULES_FILE, "r", encoding="utf-8") as f:
            _rules_data = json.load(f)
            RULES_VERSION: int = _rules_data.get("rules_version", 1)
            MAX_INPUT_LENGTH: int = _rules_data.get("max_input_length", 2000)
            MAX_TOKENS: int = _rules_data.get("max_tokens", 256)
            CONTRACTIONS: dict[str, list[str]] = _rules_data.get("contractions", DEFAULT_CONTRACTIONS)
    except Exception:
        RULES_VERSION = 1
        MAX_INPUT_LENGTH = 2000
        MAX_TOKENS = 256
        CONTRACTIONS = DEFAULT_CONTRACTIONS
else:
    RULES_VERSION = 1
    MAX_INPUT_LENGTH = 2000
    MAX_TOKENS = 256
    CONTRACTIONS = DEFAULT_CONTRACTIONS

# Words: sequence of letters/digits with internal apostrophes
# Hyphens and exterior punctuation serve as delimiters
WORD_PATTERN = re.compile(r"[^\W_]+(?:'[^\W_]+)*")


@dataclass(frozen=True)
class DisplayToken:
    index: int
    text: str
    canonical_indices: list[int]
    start_char: int
    end_char: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class CanonicalToken:
    index: int
    value: str
    display_index: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class NormalizedText:
    raw_text: str
    normalized_text: str
    display_tokens: list[DisplayToken]
    canonical_tokens: list[CanonicalToken]

    def to_dict(self) -> dict[str, Any]:
        return {
            "raw_text": self.raw_text,
            "normalized_text": self.normalized_text,
            "display_tokens": [dt.to_dict() for dt in self.display_tokens],
            "canonical_tokens": [ct.to_dict() for ct in self.canonical_tokens],
        }


@dataclass(frozen=True)
class AlignedToken:
    operation: str  # "match" | "substitution" | "omission" | "insertion"
    target_token: Optional[str]
    target_index: Optional[int]
    target_display_index: Optional[int]
    input_token: Optional[str]
    input_index: Optional[int]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class AlignmentResult:
    rules_version: int
    score: int
    distance: int
    is_exact: bool
    substitutions: int
    omissions: int
    insertions: int
    target_tokens_count: int
    input_tokens_count: int
    aligned_tokens: list[AlignedToken]
    target_normalized: NormalizedText
    input_normalized: NormalizedText

    def to_dict(self) -> dict[str, Any]:
        return {
            "rules_version": self.rules_version,
            "score": self.score,
            "distance": self.distance,
            "is_exact": self.is_exact,
            "substitutions": self.substitutions,
            "omissions": self.omissions,
            "insertions": self.insertions,
            "target_tokens_count": self.target_tokens_count,
            "input_tokens_count": self.input_tokens_count,
            "aligned_tokens": [at.to_dict() for at in self.aligned_tokens],
            "target_normalized": self.target_normalized.to_dict(),
            "input_normalized": self.input_normalized.to_dict(),
        }


def round_half_up(x: float) -> int:
    """Unified round-half-up for non-negative numbers: floor(x + 0.5)."""
    return math.floor(x + 0.5)


def normalize_apostrophes(text: str) -> str:
    """Normalize typographic single quotes and accents to standard ASCII apostrophe."""
    return (
        text.replace("’", "'")
        .replace("‘", "'")
        .replace("ʻ", "'")
        .replace("ʼ", "'")
        .replace("`", "'")
        .replace("\x92", "'")
        .replace("\x91", "'")
    )


def normalize_text(text: str, is_input: bool = False) -> NormalizedText:
    """
    Executes Section 7.1 Pipeline v1:
    1. Unicode NFKC normalization
    2. Normalize typographic apostrophes to ASCII '
    3. Extract words (sequences of letters/digits with internal apostrophes; hyphens delimit)
    4. Retain original text for display, convert to lowercase for comparison
    5. Expand whole tokens via explicit dictionary
    10. Clamp input to 2000 chars and 256 tokens
    """
    if text is None:
        text = ""

    raw_text = text
    if is_input and len(text) > MAX_INPUT_LENGTH:
        text = text[:MAX_INPUT_LENGTH]

    # Step 1: NFKC
    nfkc_text = unicodedata.normalize("NFKC", text)

    # Step 2: Apostrophes
    cleaned_text = normalize_apostrophes(nfkc_text)

    # Step 3, 4, 5: Token extraction and expansion
    display_tokens: list[DisplayToken] = []
    canonical_tokens: list[CanonicalToken] = []

    for match in WORD_PATTERN.finditer(cleaned_text):
        if len(canonical_tokens) >= MAX_TOKENS:
            break

        word_text = match.group(0)
        start_char = match.start()
        end_char = match.end()

        lowered = word_text.lower()
        if lowered in CONTRACTIONS:
            expanded = CONTRACTIONS[lowered]
        else:
            expanded = [lowered]

        display_index = len(display_tokens)
        canonical_indices: list[int] = []

        for sub_word in expanded:
            if len(canonical_tokens) >= MAX_TOKENS:
                break
            c_index = len(canonical_tokens)
            canonical_tokens.append(
                CanonicalToken(
                    index=c_index,
                    value=sub_word,
                    display_index=display_index,
                )
            )
            canonical_indices.append(c_index)

        if canonical_indices:
            display_tokens.append(
                DisplayToken(
                    index=display_index,
                    text=word_text,
                    canonical_indices=canonical_indices,
                    start_char=start_char,
                    end_char=end_char,
                )
            )

    return NormalizedText(
        raw_text=raw_text,
        normalized_text=cleaned_text,
        display_tokens=display_tokens,
        canonical_tokens=canonical_tokens,
    )


def align(target_text: str, input_text: str) -> AlignmentResult:
    """
    Computes token-level Levenshtein alignment between target and user input.
    Tie-breaking priority: diagonal (match/substitution) > target omission > input insertion.
    """
    target_norm = normalize_text(target_text, is_input=False)
    input_norm = normalize_text(input_text, is_input=True)

    target_tokens = target_norm.canonical_tokens
    input_tokens = input_norm.canonical_tokens

    n = len(target_tokens)
    m = len(input_tokens)

    if n == 0:
        raise ValueError("Normalized target contains no valid tokens")

    # If input is empty, every target token is an omission
    if m == 0:
        aligned: list[AlignedToken] = []
        for t in target_tokens:
            aligned.append(
                AlignedToken(
                    operation="omission",
                    target_token=t.value,
                    target_index=t.index,
                    target_display_index=t.display_index,
                    input_token=None,
                    input_index=None,
                )
            )
        return AlignmentResult(
            rules_version=RULES_VERSION,
            score=0,
            distance=n,
            is_exact=False,
            substitutions=0,
            omissions=n,
            insertions=0,
            target_tokens_count=n,
            input_tokens_count=0,
            aligned_tokens=aligned,
            target_normalized=target_norm,
            input_normalized=input_norm,
        )

    # Build (N+1) x (M+1) DP matrix
    # dp[r][c] = edit distance
    dp: list[list[int]] = [[0] * (m + 1) for _ in range(n + 1)]

    for r in range(n + 1):
        dp[r][0] = r
    for c in range(m + 1):
        dp[0][c] = c

    for r in range(1, n + 1):
        t_val = target_tokens[r - 1].value
        for c in range(1, m + 1):
            i_val = input_tokens[c - 1].value
            cost = 0 if t_val == i_val else 1

            diag_cost = dp[r - 1][c - 1] + cost
            omission_cost = dp[r - 1][c] + 1
            insertion_cost = dp[r][c - 1] + 1

            dp[r][c] = min(diag_cost, omission_cost, insertion_cost)

    # Backtracking with fixed tie-breaking priority:
    # 1. Diagonal (match / substitution)
    # 2. Target omission (up)
    # 3. Input insertion (left)
    aligned_reversed: list[AlignedToken] = []
    r = n
    c = m

    while r > 0 or c > 0:
        if r > 0 and c > 0:
            t_tok = target_tokens[r - 1]
            i_tok = input_tokens[c - 1]
            cost = 0 if t_tok.value == i_tok.value else 1

            # Check 1: diagonal
            if dp[r][c] == dp[r - 1][c - 1] + cost:
                op = "match" if cost == 0 else "substitution"
                aligned_reversed.append(
                    AlignedToken(
                        operation=op,
                        target_token=t_tok.value,
                        target_index=t_tok.index,
                        target_display_index=t_tok.display_index,
                        input_token=i_tok.value,
                        input_index=i_tok.index,
                    )
                )
                r -= 1
                c -= 1
                continue

            # Check 2: target omission
            if dp[r][c] == dp[r - 1][c] + 1:
                aligned_reversed.append(
                    AlignedToken(
                        operation="omission",
                        target_token=t_tok.value,
                        target_index=t_tok.index,
                        target_display_index=t_tok.display_index,
                        input_token=None,
                        input_index=None,
                    )
                )
                r -= 1
                continue

            # Check 3: input insertion
            aligned_reversed.append(
                AlignedToken(
                    operation="insertion",
                    target_token=None,
                    target_index=None,
                    target_display_index=None,
                    input_token=i_tok.value,
                    input_index=i_tok.index,
                )
            )
            c -= 1
            continue

        if r > 0:
            # Only omission possible
            t_tok = target_tokens[r - 1]
            aligned_reversed.append(
                AlignedToken(
                    operation="omission",
                    target_token=t_tok.value,
                    target_index=t_tok.index,
                    target_display_index=t_tok.display_index,
                    input_token=None,
                    input_index=None,
                )
            )
            r -= 1
            continue

        if c > 0:
            # Only insertion possible
            i_tok = input_tokens[c - 1]
            aligned_reversed.append(
                AlignedToken(
                    operation="insertion",
                    target_token=None,
                    target_index=None,
                    target_display_index=None,
                    input_token=i_tok.value,
                    input_index=i_tok.index,
                )
            )
            c -= 1
            continue

    aligned_reversed.reverse()
    aligned_tokens = aligned_reversed

    substitutions = sum(1 for at in aligned_tokens if at.operation == "substitution")
    omissions = sum(1 for at in aligned_tokens if at.operation == "omission")
    insertions = sum(1 for at in aligned_tokens if at.operation == "insertion")
    distance = substitutions + omissions + insertions

    score = round_half_up(100.0 * max(0.0, 1.0 - distance / n))
    is_exact = distance == 0

    return AlignmentResult(
        rules_version=RULES_VERSION,
        score=score,
        distance=distance,
        is_exact=is_exact,
        substitutions=substitutions,
        omissions=omissions,
        insertions=insertions,
        target_tokens_count=n,
        input_tokens_count=m,
        aligned_tokens=aligned_tokens,
        target_normalized=target_norm,
        input_normalized=input_norm,
    )
