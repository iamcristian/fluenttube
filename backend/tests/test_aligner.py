"""
Tests for Python Normalizer and Aligner against Section 7.4 shared fixtures and edge cases.
"""

import json
from pathlib import Path
import pytest

try:
    from backend.app.services.aligner import (
        align,
        normalize_text,
        round_half_up,
        DisplayToken,
        CanonicalToken,
        AlignedToken,
        AlignmentResult,
        MAX_INPUT_LENGTH,
        MAX_TOKENS,
    )
except ImportError:
    from app.services.aligner import (
        align,
        normalize_text,
        round_half_up,
        DisplayToken,
        CanonicalToken,
        AlignedToken,
        AlignmentResult,
        MAX_INPUT_LENGTH,
        MAX_TOKENS,
    )

FIXTURES_PATH = Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "alignment.json"


def test_shared_fixtures_alignment():
    assert FIXTURES_PATH.exists(), f"Fixtures file not found at {FIXTURES_PATH}"
    with open(FIXTURES_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    cases = data["cases"]
    assert len(cases) >= 12, "Expected at least 12 test cases in shared fixtures"

    for case in cases:
        cid = case["id"]
        target = case["target"]
        user_input = case["input"]

        result = align(target, user_input)

        if "expected_distance" in case:
            assert result.distance == case["expected_distance"], (
                f"Case {cid} failed distance: expected {case['expected_distance']}, got {result.distance}"
            )

        if "expected_score" in case:
            assert result.score == case["expected_score"], (
                f"Case {cid} failed score: expected {case['expected_score']}, got {result.score}"
            )

        if "expected_exact" in case:
            assert result.is_exact == case["expected_exact"], (
                f"Case {cid} failed is_exact: expected {case['expected_exact']}, got {result.is_exact}"
            )

        if "expected_substitutions" in case:
            assert result.substitutions == case["expected_substitutions"], (
                f"Case {cid} failed substitutions: expected {case['expected_substitutions']}, got {result.substitutions}"
            )

        if "expected_omissions" in case:
            assert result.omissions == case["expected_omissions"], (
                f"Case {cid} failed omissions: expected {case['expected_omissions']}, got {result.omissions}"
            )

        if "expected_insertions" in case:
            assert result.insertions == case["expected_insertions"], (
                f"Case {cid} failed insertions: expected {case['expected_insertions']}, got {result.insertions}"
            )

        if "expected_operations" in case:
            actual_ops = [at.operation for at in result.aligned_tokens]
            assert actual_ops == case["expected_operations"], (
                f"Case {cid} failed operations: expected {case['expected_operations']}, got {actual_ops}"
            )


def test_display_to_canonical_mapping():
    norm = normalize_text("I've been here.")
    assert len(norm.display_tokens) == 3
    assert norm.display_tokens[0].text == "I've"
    assert norm.display_tokens[0].canonical_indices == [0, 1]

    assert len(norm.canonical_tokens) == 4
    assert norm.canonical_tokens[0].value == "i"
    assert norm.canonical_tokens[0].display_index == 0
    assert norm.canonical_tokens[1].value == "have"
    assert norm.canonical_tokens[1].display_index == 0
    assert norm.canonical_tokens[2].value == "been"
    assert norm.canonical_tokens[2].display_index == 1
    assert norm.canonical_tokens[3].value == "here"
    assert norm.canonical_tokens[3].display_index == 2


def test_empty_target_raises_error():
    with pytest.raises(ValueError, match="Normalized target contains no valid tokens"):
        align("", "hello")

    with pytest.raises(ValueError, match="Normalized target contains no valid tokens"):
        align("... !?", "hello")


def test_empty_input_graceful():
    res = align("Hello world!", "")
    assert res.distance == 2
    assert res.score == 0
    assert res.is_exact is False
    assert res.omissions == 2
    assert res.insertions == 0
    assert res.substitutions == 0
    assert len(res.aligned_tokens) == 2
    assert all(at.operation == "omission" for at in res.aligned_tokens)


def test_round_half_up_shared_definition():
    assert round_half_up(75.0) == 75
    assert round_half_up(66.6666667) == 67
    assert round_half_up(0.5) == 1
    assert round_half_up(0.499999) == 0
    assert round_half_up(2.5) == 3  # differs from python round(2.5) == 2


def test_input_clamping_length_and_tokens():
    # Long text exceeding 2000 chars
    long_input = "word " * 600
    assert len(long_input) > MAX_INPUT_LENGTH
    res = align("word", long_input)
    assert res.input_tokens_count <= MAX_TOKENS


def test_gonna_wanna_expansion():
    res = align("I'm gonna leave", "i am going to leave")
    assert res.is_exact is True
    assert res.score == 100
    assert res.distance == 0

    res2 = align("I wanna go", "i want to go")
    assert res2.is_exact is True
    assert res2.score == 100
    assert res2.distance == 0
