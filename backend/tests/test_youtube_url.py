import pytest
from backend.app.errors import AppException
from backend.app.services.youtube_service import (
    build_canonical_youtube_url,
    parse_youtube_url,
)

def test_four_valid_youtube_formats():
    """Section 6.2 mandatory: watch, youtu.be, shorts, and embed formats."""
    expected_id = "dQw4w9WgXcQ"
    
    # 1. Standard watch
    assert parse_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == expected_id
    assert parse_youtube_url("https://youtube.com/watch?v=dQw4w9WgXcQ") == expected_id
    assert parse_youtube_url("https://m.youtube.com/watch?v=dQw4w9WgXcQ") == expected_id

    # 2. youtu.be shortlink
    assert parse_youtube_url("https://youtu.be/dQw4w9WgXcQ") == expected_id
    assert parse_youtube_url("https://www.youtu.be/dQw4w9WgXcQ") == expected_id

    # 3. /shorts/
    assert parse_youtube_url("https://www.youtube.com/shorts/dQw4w9WgXcQ") == expected_id

    # 4. /embed/
    assert parse_youtube_url("https://www.youtube.com/embed/dQw4w9WgXcQ") == expected_id

def test_extra_query_parameters_ignored_when_video_exists():
    """Section 6.2 Rule 7: Extra parameters like timestamps and playlist IDs are safely ignored."""
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=RDdQw4w9WgXcQ&index=1"
    assert parse_youtube_url(url) == "dQw4w9WgXcQ"

def test_leading_and_trailing_whitespace_stripped():
    """Section 6.2 Rule 1: Whitespace is stripped."""
    url = "   https://www.youtube.com/watch?v=dQw4w9WgXcQ   \n"
    assert parse_youtube_url(url) == "dQw4w9WgXcQ"

def test_short_and_long_ids_rejected():
    """Section 6.2 Rule 6: Exactly 11 characters required."""
    with pytest.raises(AppException) as exc_short:
        parse_youtube_url("https://youtu.be/short")
    assert exc_short.value.code == "INVALID_YOUTUBE_URL"

    with pytest.raises(AppException) as exc_long:
        parse_youtube_url("https://youtu.be/dQw4w9WgXcQextra")
    assert exc_long.value.code == "INVALID_YOUTUBE_URL"

def test_hostile_domains_rejected():
    """Section 6.2 Rule 4: Substrings and deceptive suffixes are rejected."""
    hostile_urls = [
        "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
        "https://evil-youtube.com/watch?v=dQw4w9WgXcQ",
        "https://fakeyoutube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be.attacker.com/dQw4w9WgXcQ",
    ]
    for url in hostile_urls:
        with pytest.raises(AppException) as exc:
            parse_youtube_url(url)
        assert exc.value.code == "INVALID_YOUTUBE_URL"

def test_credentials_in_url_rejected():
    """Section 6.2 Rule 3: Credentials rejected."""
    with pytest.raises(AppException) as exc:
        parse_youtube_url("https://user:password@www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert exc.value.code == "INVALID_YOUTUBE_URL"

def test_file_and_invalid_schemes_rejected():
    """Section 6.2 Rule 3: Only HTTP/HTTPS allowed."""
    for scheme_url in [
        "file:///C:/videos/test.mp4",
        "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
        "javascript:alert(1)",
    ]:
        with pytest.raises(AppException) as exc:
            parse_youtube_url(scheme_url)
        assert exc.value.code == "INVALID_YOUTUBE_URL"

def test_standalone_playlist_rejected():
    """Section 6.2 Rule 7: Standalone playlist URLs are rejected."""
    with pytest.raises(AppException) as exc_playlist:
        parse_youtube_url("https://www.youtube.com/playlist?list=PL1234567890")
    assert exc_playlist.value.code == "INVALID_YOUTUBE_URL"

    with pytest.raises(AppException) as exc_youtu_playlist:
        parse_youtube_url("https://youtu.be/playlist?list=PL1234567890")
    assert exc_youtu_playlist.value.code == "INVALID_YOUTUBE_URL"

def test_contradictory_v_parameters_rejected():
    """Section 6.2 Rule 6: Conflicting multiple 'v' parameters are rejected."""
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=oHg5SJYRHA0"
    with pytest.raises(AppException) as exc:
        parse_youtube_url(url)
    assert exc.value.code == "INVALID_YOUTUBE_URL"

def test_custom_port_rejected():
    """Section 6.2 Rule 3: Explicit ports other than 80/443 rejected."""
    with pytest.raises(AppException) as exc:
        parse_youtube_url("https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ")
    assert exc.value.code == "INVALID_YOUTUBE_URL"

def test_build_canonical_youtube_url():
    """Section 6.2 Rule 8: Canonical sanitized URL construction."""
    canonical = build_canonical_youtube_url("dQw4w9WgXcQ")
    assert canonical == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
