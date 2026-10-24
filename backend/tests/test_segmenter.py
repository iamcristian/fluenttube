import json
from pathlib import Path
import pytest
from backend.app.errors import AppException
from backend.app.services.segmenter import (
    RawFragment,
    clean_fragment_text,
    is_terminal_sentence_end,
    segment_fragments,
)

FIXTURES_PATH = Path(__file__).resolve().parent.parent.parent / "shared" / "fixtures" / "segmentation.json"

def test_acceptance_criteria_three_fragments_produce_two_segments():
    """Section 6.4 Minimum Fixture: 3 fragments yield exactly 2 segments."""
    raw = [
        RawFragment(start_seconds=0.0, end_seconds=1.2, text="I have"),
        RawFragment(start_seconds=1.2, end_seconds=3.0, text="a question."),
        RawFragment(start_seconds=5.0, end_seconds=6.0, text="Can you help?"),
    ]
    segments = segment_fragments(raw)
    assert len(segments) == 2
    assert segments[0].position == 0
    assert segments[0].start_seconds == 0.0
    assert segments[0].end_seconds == 3.0
    assert segments[0].text == "I have a question."
    assert segments[0].timing_quality == "caption"

    assert segments[1].position == 1
    assert segments[1].start_seconds == 5.0
    assert segments[1].end_seconds == 6.0
    assert segments[1].text == "Can you help?"
    assert segments[1].timing_quality == "caption"

def test_segmentation_fixtures_from_json():
    """Verify all test cases defined in shared/fixtures/segmentation.json."""
    assert FIXTURES_PATH.exists(), f"Missing fixture file at {FIXTURES_PATH}"
    data = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))

    for case in data["cases"]:
        raw_fragments = [RawFragment(**item) for item in case["input"]]
        result = segment_fragments(raw_fragments)
        expected = case["expected"]

        assert len(result) == len(expected), f"Case '{case['name']}' produced {len(result)} segments, expected {len(expected)}"
        for res_seg, exp_dict in zip(result, expected):
            assert res_seg.position == exp_dict["position"], f"Case '{case['name']}' position mismatch"
            assert res_seg.start_seconds == exp_dict["start_seconds"], f"Case '{case['name']}' start mismatch"
            assert res_seg.end_seconds == exp_dict["end_seconds"], f"Case '{case['name']}' end mismatch"
            assert res_seg.text == exp_dict["text"], f"Case '{case['name']}' text mismatch"
            assert res_seg.timing_quality == exp_dict["timing_quality"], f"Case '{case['name']}' quality mismatch"

def test_boundary_gap_threshold_1_2s():
    """Section 6.4 Rule 5: Gap <= 1.2s merges; gap > 1.2s flushes."""
    # Gap exactly 1.2s: 3.2 - 2.0 = 1.2s -> merged
    raw_merged = [
        RawFragment(start_seconds=0.0, end_seconds=2.0, text="First part"),
        RawFragment(start_seconds=3.2, end_seconds=5.0, text="second part."),
    ]
    segs_merged = segment_fragments(raw_merged)
    assert len(segs_merged) == 1
    assert segs_merged[0].text == "First part second part."

    # Gap 1.25s > 1.2s -> flushed
    raw_split = [
        RawFragment(start_seconds=0.0, end_seconds=2.0, text="First part"),
        RawFragment(start_seconds=3.25, end_seconds=5.0, text="second part."),
    ]
    segs_split = segment_fragments(raw_split)
    assert len(segs_split) == 2
    assert segs_split[0].text == "First part"
    assert segs_split[1].text == "second part."

def test_size_thresholds_words_and_duration():
    """Section 6.4 Rule 6: Flushing when exceeding 18 words or 10 seconds."""
    # 10 words + 9 words = 19 words (> 18 words) -> flushes
    raw_words = [
        RawFragment(start_seconds=0.0, end_seconds=2.0, text="one two three four five six seven eight nine ten"),
        RawFragment(start_seconds=2.2, end_seconds=4.0, text="eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen"),
    ]
    segs_words = segment_fragments(raw_words)
    assert len(segs_words) == 2

    # Combined duration > 10.0s -> flushes
    raw_duration = [
        RawFragment(start_seconds=0.0, end_seconds=6.0, text="Start of long phrase"),
        RawFragment(start_seconds=6.5, end_seconds=11.0, text="which extends past 10 seconds"),
    ]
    segs_duration = segment_fragments(raw_duration)
    assert len(segs_duration) == 2

def test_single_long_fragment_coarse_exception():
    """Section 6.4 Rule 9: An individual fragment > 10s or > 18 words is retained as coarse."""
    raw = [
        RawFragment(
            start_seconds=0.0,
            end_seconds=12.5,
            text="This is an unusually long continuous utterance that exceeds ten seconds without any internal pauses.",
        )
    ]
    segs = segment_fragments(raw)
    assert len(segs) == 1
    assert segs[0].timing_quality == "coarse"
    assert segs[0].start_seconds == 0.0
    assert segs[0].end_seconds == 12.5

def test_abbreviations_and_decimals_do_not_split():
    """Section 6.4 Rule 7: Abbreviated titles and decimals do not terminate sentences."""
    assert is_terminal_sentence_end("Hello world.") is True
    assert is_terminal_sentence_end("Can you see?") is True
    assert is_terminal_sentence_end('He shouted "No!"') is True

    # Abbreviations
    assert is_terminal_sentence_end("I saw Dr.") is False
    assert is_terminal_sentence_end("This is e.g.") is False
    assert is_terminal_sentence_end("Meet Mr.") is False

    # Decimals
    assert is_terminal_sentence_end("The value is 3.14") is False

def test_rolling_captions_overlap_deduplication():
    """Section 6.4 Rule 3: Strip suffix/prefix token overlap of at least 3 tokens."""
    raw = [
        RawFragment(start_seconds=0.0, end_seconds=3.0, text="we are learning English today"),
        # Rolling caption repeats "English today" (2 tokens) vs "learning English today" (3 tokens)
        RawFragment(start_seconds=2.0, end_seconds=5.0, text="learning English today with FluentTube."),
    ]
    segs = segment_fragments(raw)
    assert len(segs) == 1
    assert "we are learning English today with FluentTube." in segs[0].text
    assert segs[0].timing_quality == "coarse"

def test_repeated_phrases_at_different_times_preserved():
    """Section 6.4 Rule 2: Do not deduplicate phrases repeated at different times."""
    raw = [
        RawFragment(start_seconds=1.0, end_seconds=2.5, text="Thank you very much."),
        RawFragment(start_seconds=20.0, end_seconds=21.5, text="Thank you very much."),
    ]
    segs = segment_fragments(raw)
    assert len(segs) == 2
    assert segs[0].start_seconds == 1.0
    assert segs[1].start_seconds == 20.0

def test_non_verbal_noise_filtering():
    """Section 6.4: Strictly non-verbal noise like [Music] or (Applause) is stripped/filtered."""
    raw = [
        RawFragment(start_seconds=0.0, end_seconds=2.0, text="[Music]"),
        RawFragment(start_seconds=2.5, end_seconds=4.0, text="Welcome everyone! [Applause]"),
        RawFragment(start_seconds=4.5, end_seconds=6.0, text="♪♫"),
    ]
    segs = segment_fragments(raw)
    assert len(segs) == 1
    assert segs[0].text == "Welcome everyone!"

def test_invalid_timestamps_discarded_and_empty_rejected():
    """Section 6.4 Rule 1: Non-finite or negative timestamps discarded."""
    raw_invalid = [
        RawFragment(start_seconds=-1.0, end_seconds=2.0, text="Negative start"),
        RawFragment(start_seconds=5.0, end_seconds=4.0, text="End before start"),
        RawFragment(start_seconds=float("nan"), end_seconds=3.0, text="NaN timestamp"),
        RawFragment(start_seconds=0.0, end_seconds=2.0, text="Valid utterance."),
    ]
    segs = segment_fragments(raw_invalid)
    assert len(segs) == 1
    assert segs[0].text == "Valid utterance."

    # Empty list raises 422
    with pytest.raises(AppException) as exc:
        segment_fragments([])
    assert exc.value.code == "NO_USABLE_SEGMENTS"
