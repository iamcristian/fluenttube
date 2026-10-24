import html
import math
import re
from typing import List, Optional
from pydantic import BaseModel, Field
from backend.app.errors import AppException

ABBREVIATIONS = {
    "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.",
    "e.g.", "i.e.", "vs.", "etc.", "st.", "co.", "corp.",
    "inc.", "ltd.", "jan.", "feb.", "mar.", "apr.", "aug.",
    "sept.", "oct.", "nov.", "dec.", "approx.", "dept.",
}

# Strictly non-verbal noise patterns to strip or filter
NON_VERBAL_PATTERN = re.compile(
    r"(\[[^\]]*\]|\([^\)]*\)|♪+|♫+)",
    re.IGNORECASE,
)

TERMINAL_PUNCTUATION_REGEX = re.compile(r'[\.\?!]["\'”’)]?$')
DECIMAL_REGEX = re.compile(r"\b\d+\.\d+$")

class RawFragment(BaseModel):
    start_seconds: float
    end_seconds: float
    text: str

class SegmentDraft(BaseModel):
    position: int
    start_seconds: float
    end_seconds: float
    text: str
    timing_quality: str = "caption"  # "caption" | "word" | "coarse"

def clean_fragment_text(raw_text: str) -> str:
    """Decode HTML entities, strip tags, filter non-verbal markers, and collapse whitespace."""
    if not raw_text:
        return ""

    # Decode HTML entities (e.g. &amp; &#39;)
    text = html.unescape(raw_text)

    # Strip HTML tags like <font>, <c>
    text = re.sub(r"<[^>]+>", " ", text)

    # Remove non-verbal annotations like [Music], (Applause), ♪
    text = NON_VERBAL_PATTERN.sub(" ", text)

    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()

    return text

def is_terminal_sentence_end(text: str) -> bool:
    """
    Check if text ends in terminal punctuation (., ?, !), excluding declared
    abbreviations and decimal numbers per Section 6.4 Rule 7.
    """
    if not text:
        return False

    clean_text = text.strip()
    if not TERMINAL_PUNCTUATION_REGEX.search(clean_text):
        return False

    # Check decimal numbers
    if DECIMAL_REGEX.search(clean_text):
        return False

    # Extract last token without trailing closing quotes
    tokens = clean_text.split()
    if not tokens:
        return False

    last_token = tokens[-1].rstrip('"\'”’)')
    if last_token.lower() in ABBREVIATIONS:
        return False

    return True

def strip_rolling_overlap(prev_text: str, curr_text: str) -> tuple[str, bool]:
    """
    For rolling/cumulative captions, check if the prefix of curr_text matches
    the suffix of prev_text by at least 3 tokens.
    Returns (cleaned_curr_text, had_overlap: bool).
    """
    prev_words = prev_text.split()
    curr_words = curr_text.split()

    max_check = min(len(prev_words), len(curr_words))
    for n in range(max_check, 2, -1):  # at least 3 tokens (Section 6.4 Rule 3)
        if [w.lower() for w in prev_words[-n:]] == [w.lower() for w in curr_words[:n]]:
            remaining_words = curr_words[n:]
            if remaining_words:
                return " ".join(remaining_words), True
            return "", True

    return curr_text, False

def segment_fragments(
    fragments: List[RawFragment],
    max_duration: Optional[float] = None,
) -> List[SegmentDraft]:
    """
    Deterministic segmentation algorithm adhering to Section 6.4.

    Args:
        fragments: List of raw subtitle or ASR fragments.
        max_duration: Optional maximum video duration in seconds for boundary clamping.

    Returns:
        List of SegmentDraft with 0-based positions.

    Raises:
        AppException(422, "NO_USABLE_SEGMENTS") if no valid segments can be produced.
    """
    if not fragments:
        raise AppException(
            code="NO_USABLE_SEGMENTS",
            message="No speech fragments provided for segmentation.",
            status_code=422,
        )

    # Step 1: Validate timestamps and clean text
    valid_fragments: List[RawFragment] = []
    for f in fragments:
        if not math.isfinite(f.start_seconds) or not math.isfinite(f.end_seconds):
            continue
        if f.start_seconds < 0 or f.end_seconds <= f.start_seconds:
            continue

        cleaned_text = clean_fragment_text(f.text)
        if not cleaned_text:
            continue

        valid_fragments.append(
            RawFragment(
                start_seconds=round(f.start_seconds, 3),
                end_seconds=round(f.end_seconds, 3),
                text=cleaned_text,
            )
        )

    if not valid_fragments:
        raise AppException(
            code="NO_USABLE_SEGMENTS",
            message="All subtitle fragments were empty or non-verbal noise.",
            status_code=422,
        )

    # Step 2: Stable sort by start_seconds
    valid_fragments.sort(key=lambda x: (x.start_seconds, x.end_seconds))

    # Step 3: Eliminate exact duplicates (both text and timestamps identical)
    deduped: List[RawFragment] = []
    seen = set()
    for f in valid_fragments:
        key = (f.start_seconds, f.end_seconds, f.text)
        if key not in seen:
            seen.add(key)
            deduped.append(f)

    # Step 4: Check rolling overlaps and build clean stream
    processed_fragments: List[tuple[RawFragment, str]] = []  # (fragment, quality)
    prev_text = ""
    for f in deduped:
        curr_text = f.text
        quality = "caption"

        if prev_text and processed_fragments:
            prev_frag, _ = processed_fragments[-1]
            # If time intervals overlap, check for token overlap
            if f.start_seconds < prev_frag.end_seconds:
                stripped_text, had_overlap = strip_rolling_overlap(prev_text, curr_text)
                if had_overlap:
                    quality = "coarse"
                    if stripped_text:
                        curr_text = stripped_text
                    else:
                        continue  # Entire fragment was duplicated overlap

        processed_fragments.append((
            RawFragment(
                start_seconds=f.start_seconds,
                end_seconds=f.end_seconds,
                text=curr_text,
            ),
            quality,
        ))
        prev_text = curr_text

    if not processed_fragments:
        raise AppException(
            code="NO_USABLE_SEGMENTS",
            message="No usable speech text remained after deduplication.",
            status_code=422,
        )

    # Step 5: Buffer merging algorithm (Section 6.4 Rules 4-9)
    segments: List[SegmentDraft] = []
    buffer_fragments: List[tuple[RawFragment, str]] = []

    def flush_buffer():
        nonlocal buffer_fragments
        if not buffer_fragments:
            return

        b_start = buffer_fragments[0][0].start_seconds
        b_end = max(item[0].end_seconds for item in buffer_fragments)
        b_text = " ".join(item[0].text for item in buffer_fragments)

        # Quality is coarse if any fragment in buffer was marked coarse,
        # or if individual fragment exceeds 10s or 18 words
        words = b_text.split()
        b_quality = "caption"
        if any(item[1] == "coarse" for item in buffer_fragments):
            b_quality = "coarse"
        elif len(words) > 18 or (b_end - b_start) > 10.0:
            b_quality = "coarse"

        # Boundary clamping to max_duration if supplied and valid
        if max_duration and b_end > max_duration:
            b_end = max_duration

        segments.append(
            SegmentDraft(
                position=len(segments),
                start_seconds=round(b_start, 3),
                end_seconds=round(b_end, 3),
                text=b_text,
                timing_quality=b_quality,
            )
        )
        buffer_fragments = []

    for frag, qual in processed_fragments:
        if not buffer_fragments:
            buffer_fragments.append((frag, qual))
            if is_terminal_sentence_end(frag.text):
                flush_buffer()
            continue

        # Current buffer state
        curr_buffer_start = buffer_fragments[0][0].start_seconds
        curr_buffer_end = max(item[0].end_seconds for item in buffer_fragments)
        curr_words_count = sum(len(item[0].text.split()) for item in buffer_fragments)

        # Rule 5: Gap > 1.2s flushes buffer
        gap = round(frag.start_seconds - curr_buffer_end, 3)
        if gap > 1.2:
            flush_buffer()
            buffer_fragments.append((frag, qual))
            if is_terminal_sentence_end(frag.text):
                flush_buffer()
            continue

        # Rule 6: Exceeding 18 words or 10s flushes buffer
        new_words_count = curr_words_count + len(frag.text.split())
        new_duration = round(frag.end_seconds - curr_buffer_start, 3)
        if new_words_count > 18 or new_duration > 10.0:
            flush_buffer()
            buffer_fragments.append((frag, qual))
            if is_terminal_sentence_end(frag.text):
                flush_buffer()
            continue

        # Append to buffer and check Rule 7 terminal punctuation
        buffer_fragments.append((frag, qual))
        if is_terminal_sentence_end(frag.text):
            flush_buffer()

    # Rule 8: Always flush the final buffer
    flush_buffer()

    if not segments:
        raise AppException(
            code="NO_USABLE_SEGMENTS",
            message="Segmentation produced 0 segments.",
            status_code=422,
        )

    # Re-index positions sequentially from 0
    for idx, seg in enumerate(segments):
        seg.position = idx

    return segments

def segment_asr_result(
    asr_result: dict,
    max_duration: Optional[float] = None,
) -> List[SegmentDraft]:
    """
    Deterministic segmentation of Whisper ASR results adhering to Section 6.4:
    - Enforces boundaries at actual word edges when word timestamps are available (Rule 10).
    - Applies time gap > 1.2s threshold (Rule 5).
    - Clamps segment lengths to max 18 words or 10.0s (Rule 6).
    - Splits on terminal punctuation (., ?, !) while preserving abbreviations and decimals (Rule 7).
    - Clamps to video max_duration if provided.
    - Yields timing_quality="word" when word boundaries are utilized.
    """
    words = asr_result.get("words", [])
    if words:
        # Step 1: Clean and validate words
        valid_words = []
        for w in words:
            raw_w = w.get("word", "")
            cleaned = clean_fragment_text(raw_w)
            if not cleaned:
                continue
            start = float(w.get("start", 0.0))
            end = float(w.get("end", 0.0))
            if start < 0 or end <= start or not math.isfinite(start) or not math.isfinite(end):
                continue
            valid_words.append({
                "word": cleaned,
                "start": round(start, 3),
                "end": round(end, 3),
            })

        if valid_words:
            # Step 2: Buffer words into practice segments
            segments: List[SegmentDraft] = []
            word_buffer: List[dict] = []

            def flush_word_buffer():
                nonlocal word_buffer
                if not word_buffer:
                    return

                b_start = word_buffer[0]["start"]
                b_end = word_buffer[-1]["end"]
                b_text = " ".join(item["word"] for item in word_buffer)

                if max_duration and b_end > max_duration:
                    b_end = max_duration

                segments.append(
                    SegmentDraft(
                        position=len(segments),
                        start_seconds=round(b_start, 3),
                        end_seconds=round(b_end, 3),
                        text=b_text,
                        timing_quality="word",
                    )
                )
                word_buffer = []

            for item in valid_words:
                if not word_buffer:
                    word_buffer.append(item)
                    if is_terminal_sentence_end(item["word"]):
                        flush_word_buffer()
                    continue

                curr_start = item["start"]
                curr_end = item["end"]
                buf_start = word_buffer[0]["start"]
                prev_end = word_buffer[-1]["end"]

                # Rule 5: Gap > 1.2s
                if round(curr_start - prev_end, 3) > 1.2:
                    flush_word_buffer()
                    word_buffer.append(item)
                    if is_terminal_sentence_end(item["word"]):
                        flush_word_buffer()
                    continue

                # Rule 6: >18 words or >10s
                new_len = len(word_buffer) + 1
                new_dur = round(curr_end - buf_start, 3)
                if new_len > 18 or new_dur > 10.0:
                    flush_word_buffer()
                    word_buffer.append(item)
                    if is_terminal_sentence_end(item["word"]):
                        flush_word_buffer()
                    continue

                # Append and check terminal punctuation
                word_buffer.append(item)
                if is_terminal_sentence_end(item["word"]):
                    flush_word_buffer()

            flush_word_buffer()

            if segments:
                for idx, seg in enumerate(segments):
                    seg.position = idx
                return segments

    # Fallback to segments if words not available or empty
    raw_segs = asr_result.get("segments", [])
    raw_fragments = [
        RawFragment(
            start_seconds=float(s.get("start", 0.0)),
            end_seconds=float(s.get("end", 0.0)),
            text=str(s.get("text", "")),
        )
        for s in raw_segs
    ]

    if not raw_fragments:
        full_text = asr_result.get("text", "").strip()
        if full_text:
            raw_fragments = [
                RawFragment(
                    start_seconds=0.0,
                    end_seconds=float(asr_result.get("duration", 1.0)),
                    text=full_text,
                )
            ]

    return segment_fragments(raw_fragments, max_duration=max_duration)
