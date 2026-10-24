"""
Speech Assessment and Scoring Service for FluentTube AI.
Implements Section 10.4 of the specification:
- Exact scoring formulas: word_match_score, timing_similarity_score, overall_score
- Token-level badge grouping per display token (matched, uncertain, substituted, omitted)
- Contraction expansion and shared confidence mapping
- Handling extra word insertions
- Silence and unscorable speech handling without pseudo-grades
- Duration and timing similarity against reference speech or segment window
"""

from __future__ import annotations

import logging
import math
import re
from typing import Any, Dict, List, Optional, Tuple

from backend.app.services.aligner import (
    AlignmentResult,
    NormalizedText,
    align,
    normalize_text,
    round_half_up,
)

logger = logging.getLogger(__name__)

# Minimum confidence threshold for "matched" status (Section 10.4)
CONFIDENCE_THRESHOLD = 0.75
SCORING_VERSION = "1.0"


def calculate_word_match_score(n: int, substitutions: int, omissions: int, insertions: int) -> int:
    """
    word_match_score = round_half_up(100 * max(0, 1 - (S + D + I) / N))
    Insertions penalize the score. All scores clamped to [0, 100].
    """
    if n <= 0:
        return 0
    penalty = (substitutions + omissions + insertions) / float(n)
    raw = 100.0 * max(0.0, 1.0 - penalty)
    score = round_half_up(raw)
    return max(0, min(100, score))


def calculate_timing_similarity_score(
    spoken_duration: float, reference_duration: float
) -> Optional[int]:
    """
    timing_similarity_score = round_half_up(
      100 * max(0, 1 - abs(spoken_duration - reference_duration) / max(reference_duration, 1.5))
    )
    If durations are invalid or <= 0, returns None.
    """
    if spoken_duration is None or reference_duration is None:
        return None
    if spoken_duration <= 0 or reference_duration <= 0:
        return None

    denom = max(reference_duration, 1.5)
    diff = abs(spoken_duration - reference_duration)
    raw = 100.0 * max(0.0, 1.0 - (diff / denom))
    score = round_half_up(raw)
    return max(0, min(100, score))


def calculate_overall_score(
    word_match_score: int, timing_similarity_score: Optional[int]
) -> int:
    """
    If speech recognized and timing valid:
        overall_score = round_half_up(0.70 * word_match_score + 0.30 * timing_similarity_score)
    If transcript present but timing invalid:
        overall_score = word_match_score
    """
    if timing_similarity_score is not None:
        raw = 0.70 * float(word_match_score) + 0.30 * float(timing_similarity_score)
        score = round_half_up(raw)
        return max(0, min(100, score))
    return max(0, min(100, word_match_score))


def _clean_word_token(text: str) -> str:
    """Strip leading/trailing punctuation and whitespace, lowercase."""
    return re.sub(r"^[^\w']+|[^\w']+$", "", text).lower()


def _map_recognized_words_to_canonical_tokens(
    input_norm: NormalizedText, recognized_words: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Maps Whisper word objects (with probability and timestamps) to input canonical tokens.
    For contractions expanded from a single ASR word, reuses that word's reference and confidence.
    """
    dt_count = len(input_norm.display_tokens)
    rw_count = len(recognized_words)

    # Store mapping per input display token
    dt_meta: List[Dict[str, Any]] = []

    if dt_count > 0 and rw_count > 0:
        # Match display tokens to recognized words sequentially
        rw_idx = 0
        for dt_idx, dt in enumerate(input_norm.display_tokens):
            clean_dt = _clean_word_token(dt.text)
            matched_rw = None

            # Try to match the current or next recognized word
            search_limit = min(rw_count, rw_idx + 4)
            for cand_idx in range(rw_idx, search_limit):
                cand_clean = _clean_word_token(recognized_words[cand_idx].get("word", ""))
                if cand_clean == clean_dt or cand_clean in clean_dt or clean_dt in cand_clean:
                    matched_rw = recognized_words[cand_idx]
                    rw_idx = cand_idx + 1
                    break

            # Fallback: if not found, use rw_idx if within bounds
            if matched_rw is None and rw_idx < rw_count:
                matched_rw = recognized_words[rw_idx]
                rw_idx += 1

            if matched_rw:
                dt_meta.append(
                    {
                        "probability": matched_rw.get("probability"),
                        "start": matched_rw.get("start"),
                        "end": matched_rw.get("end"),
                        "word": matched_rw.get("word", "").strip(),
                    }
                )
            else:
                dt_meta.append({"probability": None, "start": None, "end": None, "word": dt.text})
    else:
        for dt in input_norm.display_tokens:
            dt_meta.append({"probability": None, "start": None, "end": None, "word": dt.text})

    # Expand to canonical tokens: each canonical token inherits its parent display token's metadata
    c_meta: List[Dict[str, Any]] = []
    for c_tok in input_norm.canonical_tokens:
        d_idx = c_tok.display_index
        if 0 <= d_idx < len(dt_meta):
            c_meta.append(dt_meta[d_idx])
        else:
            c_meta.append({"probability": None, "start": None, "end": None, "word": c_tok.value})

    return c_meta


def evaluate_token_badges(
    target_norm: NormalizedText,
    input_norm: NormalizedText,
    alignment_result: AlignmentResult,
    recognized_words: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Groups canonical token alignment results into display token assessments with
    Section 10.4 status badges:
    - matched: all canonical tokens matched with probabilities >= 0.75
    - uncertain: all matched but some probability < 0.75 or missing, OR mixed match/omission without substitution
    - substituted: any substitution present
    - omitted: all tokens omitted

    Also returns list of extra word insertions.
    """
    input_token_meta = _map_recognized_words_to_canonical_tokens(input_norm, recognized_words)

    # Index alignment operations by target canonical index
    target_ops: Dict[int, Any] = {}
    insertions: List[Dict[str, Any]] = []

    for at in alignment_result.aligned_tokens:
        if at.target_index is not None:
            target_ops[at.target_index] = at
        elif at.operation == "insertion" and at.input_index is not None:
            meta = (
                input_token_meta[at.input_index]
                if at.input_index < len(input_token_meta)
                else {"probability": None}
            )
            insertions.append(
                {
                    "text": at.input_token or "",
                    "asr_confidence": meta.get("probability"),
                }
            )

    display_evaluations: List[Dict[str, Any]] = []

    for dt in target_norm.display_tokens:
        c_indices = dt.canonical_indices
        ops = [target_ops.get(ci) for ci in c_indices if ci in target_ops]

        op_types = [op.operation for op in ops if op is not None]
        observed_probs: List[float] = []

        for op in ops:
            if op and op.input_index is not None and op.input_index < len(input_token_meta):
                p = input_token_meta[op.input_index].get("probability")
                if p is not None:
                    observed_probs.append(p)

        # Determine display token status
        has_sub = any(t == "substitution" for t in op_types)
        all_match = len(op_types) == len(c_indices) and all(t == "match" for t in op_types)
        all_omit = len(op_types) == len(c_indices) and all(t == "omission" for t in op_types)

        if all_match:
            # Check probabilities >= 0.75
            if len(observed_probs) == len(c_indices) and all(
                p >= CONFIDENCE_THRESHOLD for p in observed_probs
            ):
                status = "matched"
            else:
                status = "uncertain"
        elif has_sub:
            status = "substituted"
        elif all_omit:
            status = "omitted"
        else:
            # Mixed match / omission without substitution
            status = "uncertain"

        asr_confidence = min(observed_probs) if observed_probs else None

        display_evaluations.append(
            {
                "display_index": dt.index,
                "text": dt.text,
                "status": status,
                "asr_confidence": round(asr_confidence, 3) if asr_confidence is not None else None,
                "canonical_tokens": [
                    target_norm.canonical_tokens[ci].value
                    for ci in c_indices
                    if ci < len(target_norm.canonical_tokens)
                ],
            }
        )

    return display_evaluations, insertions


def assess_shadowing(
    reference_text: str,
    reference_speech_seconds: Optional[float],
    segment_window_seconds: float,
    recognized_text: str,
    recognized_words: List[Dict[str, Any]],
    timing_quality: str = "caption",
) -> Dict[str, Any]:
    """
    Authoritative speech assessment implementation per Section 10.4.
    """
    clean_recognized = recognized_text.strip() if recognized_text else ""
    warnings: List[str] = []

    # 1. Target normalization
    target_norm = normalize_text(reference_text, is_input=False)
    n = len(target_norm.canonical_tokens)
    if n == 0:
        logger.warning(f"Target reference '{reference_text}' produced 0 canonical tokens.")
        return {
            "status": "unscorable",
            "word_match_score": None,
            "timing_similarity_score": None,
            "overall_score": None,
            "spoken_duration": None,
            "reference_duration": None,
            "timing_basis": None,
            "alignment": [],
            "insertions": [],
            "warning_codes": ["EMPTY_TARGET"],
            "scoring_version": SCORING_VERSION,
        }

    # 2. Silence / Unscorable Check (Section 10.4)
    # If no speech recognized: status = unscorable, all three scores = null, warnings adds NO_SPEECH
    if not clean_recognized or len(recognized_words) == 0:
        empty_alignment = [
            {
                "display_index": dt.index,
                "text": dt.text,
                "status": "omitted",
                "asr_confidence": None,
                "canonical_tokens": [
                    target_norm.canonical_tokens[ci].value
                    for ci in dt.canonical_indices
                    if ci < len(target_norm.canonical_tokens)
                ],
            }
            for dt in target_norm.display_tokens
        ]
        return {
            "status": "unscorable",
            "word_match_score": None,
            "timing_similarity_score": None,
            "overall_score": None,
            "spoken_duration": None,
            "reference_duration": (
                reference_speech_seconds
                if reference_speech_seconds and reference_speech_seconds > 0
                else (segment_window_seconds if segment_window_seconds > 0 else None)
            ),
            "timing_basis": (
                "active_reference_words"
                if reference_speech_seconds and reference_speech_seconds > 0
                else "segment_window"
            ),
            "alignment": empty_alignment,
            "insertions": [],
            "warning_codes": ["NO_SPEECH"],
            "scoring_version": SCORING_VERSION,
        }

    # 3. Input normalization and alignment
    input_norm = normalize_text(clean_recognized, is_input=True)
    if len(input_norm.canonical_tokens) == 0:
        empty_alignment = [
            {
                "display_index": dt.index,
                "text": dt.text,
                "status": "omitted",
                "asr_confidence": None,
                "canonical_tokens": [
                    target_norm.canonical_tokens[ci].value
                    for ci in dt.canonical_indices
                    if ci < len(target_norm.canonical_tokens)
                ],
            }
            for dt in target_norm.display_tokens
        ]
        return {
            "status": "unscorable",
            "word_match_score": None,
            "timing_similarity_score": None,
            "overall_score": None,
            "spoken_duration": None,
            "reference_duration": None,
            "timing_basis": None,
            "alignment": empty_alignment,
            "insertions": [],
            "warning_codes": ["NO_SPEECH"],
            "scoring_version": SCORING_VERSION,
        }

    alignment_res = align(reference_text, clean_recognized)

    # 4. Word Match Score
    s = alignment_res.substitutions
    d = alignment_res.omissions
    i = alignment_res.insertions
    word_match_score = calculate_word_match_score(n=n, substitutions=s, omissions=d, insertions=i)

    # 5. Display token assessments & insertions
    alignment_evaluations, insertions = evaluate_token_badges(
        target_norm=target_norm,
        input_norm=input_norm,
        alignment_result=alignment_res,
        recognized_words=recognized_words,
    )

    # 6. Spoken duration calculation
    # spoken_duration = last_word_end - first_word_start over valid ASR words. Ignore leading/trailing silence.
    valid_words = [
        w
        for w in recognized_words
        if w.get("start") is not None
        and w.get("end") is not None
        and float(w["end"]) >= float(w["start"])
    ]
    if valid_words:
        first_start = float(valid_words[0]["start"])
        last_end = float(valid_words[-1]["end"])
        spoken_duration = max(0.0, last_end - first_start)
    else:
        spoken_duration = None

    # 7. Reference duration calculation
    if reference_speech_seconds is not None and reference_speech_seconds > 0:
        reference_duration = reference_speech_seconds
        timing_basis = "active_reference_words"
    elif timing_quality == "word" and segment_window_seconds > 0:
        reference_duration = segment_window_seconds
        timing_basis = "active_reference_words"
    elif segment_window_seconds > 0:
        reference_duration = segment_window_seconds
        timing_basis = "segment_window"
        warnings.append("COARSE_REFERENCE_TIMING")
    else:
        reference_duration = None
        timing_basis = None

    # 8. Timing similarity score & Overall score
    if spoken_duration is not None and spoken_duration > 0 and reference_duration is not None and reference_duration > 0:
        timing_similarity_score = calculate_timing_similarity_score(
            spoken_duration=spoken_duration,
            reference_duration=reference_duration,
        )
    else:
        timing_similarity_score = None
        warnings.append("TIMING_UNAVAILABLE")

    overall_score = calculate_overall_score(
        word_match_score=word_match_score,
        timing_similarity_score=timing_similarity_score,
    )

    return {
        "status": "scored",
        "word_match_score": word_match_score,
        "timing_similarity_score": timing_similarity_score,
        "overall_score": overall_score,
        "spoken_duration": round(spoken_duration, 3) if spoken_duration is not None else None,
        "reference_duration": round(reference_duration, 3) if reference_duration is not None else None,
        "timing_basis": timing_basis,
        "alignment": alignment_evaluations,
        "insertions": insertions,
        "warning_codes": warnings,
        "scoring_version": SCORING_VERSION,
    }
