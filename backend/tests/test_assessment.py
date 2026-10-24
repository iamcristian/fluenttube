"""
Tests for Speech Assessment Service (backend/app/services/assessment.py).
Validates Section 10.4 of the specification:
- Pure scoring formulas and Section 10.4 golden fixtures:
    * N=4, S=1 -> 75
    * N=4, I=1 -> 75
    * ref=3.0s, spoken=2.4s -> 80
    * word=100, timing=80 -> 94
    * both durations=3.0s -> 100
    * no words recognized -> unscorable, scores=null, warning NO_SPEECH
    * low confidence with exact text -> word=100, badge uncertain
- Extra word insertions and repetition penalties
- Contraction handling with shared confidence
- Missing timestamps handling (TIMING_UNAVAILABLE)
- Coarse reference timing handling (COARSE_REFERENCE_TIMING)
"""

import pytest
from backend.app.services.assessment import (
    assess_shadowing,
    calculate_overall_score,
    calculate_timing_similarity_score,
    calculate_word_match_score,
)


def test_pure_scoring_formulas_fixtures():
    """Verify exact formula fixtures specified in Section 10.4."""
    # Fixture 1: N=4, S=1 -> 75
    assert calculate_word_match_score(n=4, substitutions=1, omissions=0, insertions=0) == 75

    # Fixture 2: N=4, I=1 -> 75 (insertions directly penalize score)
    assert calculate_word_match_score(n=4, substitutions=0, omissions=0, insertions=1) == 75

    # Fixture 3: reference=3.0s, spoken=2.4s -> 80
    assert calculate_timing_similarity_score(spoken_duration=2.4, reference_duration=3.0) == 80

    # Fixture 4: both durations=3.0s -> 100
    assert calculate_timing_similarity_score(spoken_duration=3.0, reference_duration=3.0) == 100

    # Fixture 5: word=100, timing=80 -> 94
    assert calculate_overall_score(word_match_score=100, timing_similarity_score=80) == 94


def test_assess_shadowing_exact_match_high_confidence():
    """Exact speech with high confidence yields 100 word match and 'matched' badges."""
    ref = "We are going to the library."
    spoken = "We are going to the library"
    words = [
        {"word": "We", "start": 0.5, "end": 0.8, "probability": 0.95},
        {"word": "are", "start": 0.8, "end": 1.0, "probability": 0.92},
        {"word": "going", "start": 1.0, "end": 1.4, "probability": 0.88},
        {"word": "to", "start": 1.4, "end": 1.6, "probability": 0.91},
        {"word": "the", "start": 1.6, "end": 1.8, "probability": 0.85},
        {"word": "library", "start": 1.8, "end": 2.5, "probability": 0.94},
    ]

    result = assess_shadowing(
        reference_text=ref,
        reference_speech_seconds=2.0,
        segment_window_seconds=3.0,
        recognized_text=spoken,
        recognized_words=words,
        timing_quality="word",
    )

    assert result["status"] == "scored"
    assert result["word_match_score"] == 100
    assert result["spoken_duration"] == pytest.approx(2.0, 0.01)
    assert result["reference_duration"] == pytest.approx(2.0, 0.01)
    assert result["timing_similarity_score"] == 100
    assert result["overall_score"] == 100
    assert len(result["insertions"]) == 0

    # All target tokens must be 'matched' with confidence >= 0.75
    for token in result["alignment"]:
        assert token["status"] == "matched"
        assert token["asr_confidence"] >= 0.75


def test_assess_shadowing_low_confidence_exact_text_yields_uncertain_badge():
    """Section 10.4: low confidence with exact text -> word=100 but badge 'uncertain'."""
    ref = "The quick brown fox"
    spoken = "The quick brown fox"
    words = [
        {"word": "The", "start": 0.0, "end": 0.3, "probability": 0.90},
        {"word": "quick", "start": 0.3, "end": 0.7, "probability": 0.60},  # < 0.75 !
        {"word": "brown", "start": 0.7, "end": 1.1, "probability": 0.85},
        {"word": "fox", "start": 1.1, "end": 1.5, "probability": 0.92},
    ]

    result = assess_shadowing(
        reference_text=ref,
        reference_speech_seconds=1.5,
        segment_window_seconds=2.0,
        recognized_text=spoken,
        recognized_words=words,
        timing_quality="word",
    )

    assert result["status"] == "scored"
    assert result["word_match_score"] == 100

    statuses = {t["text"]: t["status"] for t in result["alignment"]}
    assert statuses["The"] == "matched"
    assert statuses["quick"] == "uncertain"  # flagged uncertain due to 0.60 confidence
    assert statuses["brown"] == "matched"
    assert statuses["fox"] == "matched"


def test_assess_shadowing_silence_yields_unscorable_without_fake_grades():
    """Section 10.4: no speech recognized -> status=unscorable, all three scores=null, NO_SPEECH."""
    ref = "This is a meaningful test sentence."

    # Empty text and empty words
    result1 = assess_shadowing(
        reference_text=ref,
        reference_speech_seconds=2.5,
        segment_window_seconds=3.0,
        recognized_text="",
        recognized_words=[],
        timing_quality="word",
    )

    assert result1["status"] == "unscorable"
    assert result1["word_match_score"] is None
    assert result1["timing_similarity_score"] is None
    assert result1["overall_score"] is None
    assert "NO_SPEECH" in result1["warning_codes"]

    # Whitespace only
    result2 = assess_shadowing(
        reference_text=ref,
        reference_speech_seconds=2.5,
        segment_window_seconds=3.0,
        recognized_text="   ",
        recognized_words=[],
        timing_quality="word",
    )
    assert result2["status"] == "unscorable"
    assert result2["overall_score"] is None
    assert "NO_SPEECH" in result2["warning_codes"]


def test_assess_shadowing_repeated_words_and_insertions():
    """Section 10.4: repeated words and insertions penalize word match score and are surfaced."""
    ref = "Drive the car."  # N = 3 tokens ("drive", "the", "car")
    # Spoken has repetition: "Drive the the car please" -> 2 insertions ("the", "please")
    spoken = "Drive the the car please"
    words = [
        {"word": "Drive", "start": 0.0, "end": 0.4, "probability": 0.90},
        {"word": "the", "start": 0.4, "end": 0.6, "probability": 0.88},
        {"word": "the", "start": 0.6, "end": 0.8, "probability": 0.85},
        {"word": "car", "start": 0.8, "end": 1.2, "probability": 0.91},
        {"word": "please", "start": 1.2, "end": 1.6, "probability": 0.87},
    ]

    result = assess_shadowing(
        reference_text=ref,
        reference_speech_seconds=1.2,
        segment_window_seconds=1.5,
        recognized_text=spoken,
        recognized_words=words,
        timing_quality="word",
    )

    assert result["status"] == "scored"
    # N=3, S=0, D=0, I=2 -> 100 * (1 - 2/3) = 33.3 -> 33
    assert result["word_match_score"] == 33
    assert len(result["insertions"]) == 2
    inserted_texts = [ins["text"] for ins in result["insertions"]]
    assert "the" in inserted_texts
    assert "please" in inserted_texts


def test_assess_shadowing_contractions_handling():
    """Section 10.4: contractions expanded from single ASR word reuse reference and confidence."""
    ref = "I'm sure you're right."  # N = 5 canonical ("i", "am", "sure", "you", "are", "right" -> wait: i, am, sure, you, are, right = 6)
    spoken = "I am sure you are right"
    words = [
        {"word": "I", "start": 0.0, "end": 0.2, "probability": 0.95},
        {"word": "am", "start": 0.2, "end": 0.4, "probability": 0.94},
        {"word": "sure", "start": 0.4, "end": 0.8, "probability": 0.92},
        {"word": "you", "start": 0.8, "end": 1.0, "probability": 0.89},
        {"word": "are", "start": 1.0, "end": 1.2, "probability": 0.91},
        {"word": "right", "start": 1.2, "end": 1.6, "probability": 0.93},
    ]

    result = assess_shadowing(
        reference_text=ref,
        reference_speech_seconds=1.6,
        segment_window_seconds=2.0,
        recognized_text=spoken,
        recognized_words=words,
        timing_quality="word",
    )

    assert result["status"] == "scored"
    assert result["word_match_score"] == 100
    statuses = {t["text"]: t["status"] for t in result["alignment"]}
    assert statuses["I'm"] == "matched"
    assert statuses["you're"] == "matched"


def test_assess_shadowing_missing_timestamps_adds_timing_unavailable():
    """Section 10.4: If valid timestamps or speech are lacking, timing_similarity_score=null and warning TIMING_UNAVAILABLE."""
    ref = "Short sentence."
    spoken = "Short sentence"
    # Words without timestamps (start/end is None)
    words = [
        {"word": "Short", "start": None, "end": None, "probability": 0.9},
        {"word": "sentence", "start": None, "end": None, "probability": 0.9},
    ]

    result = assess_shadowing(
        reference_text=ref,
        reference_speech_seconds=2.0,
        segment_window_seconds=2.5,
        recognized_text=spoken,
        recognized_words=words,
        timing_quality="word",
    )

    assert result["status"] == "scored"
    assert result["word_match_score"] == 100
    assert result["timing_similarity_score"] is None
    # overall_score falls back to word_match_score
    assert result["overall_score"] == 100
    assert "TIMING_UNAVAILABLE" in result["warning_codes"]


def test_assess_shadowing_coarse_reference_timing_warning():
    """Section 10.4: If reference only has captions, use segment window with COARSE_REFERENCE_TIMING warning."""
    ref = "Sentence from caption."
    spoken = "Sentence from caption"
    words = [
        {"word": "Sentence", "start": 0.2, "end": 0.7, "probability": 0.9},
        {"word": "from", "start": 0.7, "end": 0.9, "probability": 0.9},
        {"word": "caption", "start": 0.9, "end": 1.5, "probability": 0.9},
    ]

    result = assess_shadowing(
        reference_text=ref,
        reference_speech_seconds=None,  # No word-level reference
        segment_window_seconds=2.0,
        recognized_text=spoken,
        recognized_words=words,
        timing_quality="caption",
    )

    assert result["status"] == "scored"
    assert result["timing_basis"] == "segment_window"
    assert "COARSE_REFERENCE_TIMING" in result["warning_codes"]
    assert result["timing_similarity_score"] is not None
