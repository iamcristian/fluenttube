"""
Comprehensive tests for Dictation Practice Sessions, Hints, Reveal, and Check endpoints (T12).
"""

import json
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from backend.app.database import get_engine, get_session, init_db
from backend.app.main import app
from backend.app.models import DictationAttempt, PracticeSession, Segment, Video


@pytest.fixture
def test_db(tmp_path):
    test_db_path = tmp_path / "dictation_test.db"
    test_engine = get_engine(f"sqlite:///{test_db_path}")
    init_db(test_engine)

    with Session(test_engine) as db:
        video = Video(
            youtube_id="dict1234567",
            title="Dictation Practice Test",
            channel="English Channel",
            duration_seconds=120.0,
            transcription_source="captions_manual",
            language="en",
        )
        db.add(video)
        db.flush()

        seg1 = Segment(
            video_id=video.id,
            position=0,
            start_seconds=0.0,
            end_seconds=3.0,
            text="I'm ready to learn.",
            timing_quality="caption",
        )
        seg2 = Segment(
            video_id=video.id,
            position=1,
            start_seconds=4.0,
            end_seconds=7.0,
            text="We are at home.",
            timing_quality="caption",
        )
        db.add(seg1)
        db.add(seg2)
        db.commit()

    return test_engine


@pytest.fixture
def client(test_db):
    def override_get_session():
        with Session(test_db) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_create_session_and_idempotency(client):
    # Non-existent segment -> 404
    resp = client.post("/api/segments/9999/sessions", json={})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "RESOURCE_NOT_FOUND"

    # Create new session
    req_id = str(uuid.uuid4())
    resp1 = client.post("/api/segments/1/sessions", json={"client_request_id": req_id})
    assert resp1.status_code == 201
    data1 = resp1.json()
    session_id = data1["id"]
    assert data1["segment_id"] == 1
    assert data1["answer_revealed"] is False
    assert data1["hinted_display_indices"] == []

    # Retry with same client_request_id -> 200 with same session
    resp2 = client.post("/api/segments/1/sessions", json={"client_request_id": req_id})
    assert resp2.status_code == 200
    assert resp2.json()["id"] == session_id

    # Same client_request_id for different segment -> 409 Conflict
    resp3 = client.post("/api/segments/2/sessions", json={"client_request_id": req_id})
    assert resp3.status_code == 409
    assert resp3.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_get_session(client):
    # Create session
    resp = client.post("/api/segments/1/sessions", json={})
    session_id = resp.json()["id"]

    # Read session
    get_resp = client.get(f"/api/sessions/{session_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == session_id
    assert get_resp.json()["segment_id"] == 1

    # Non-existent session -> 404
    bad_resp = client.get(f"/api/sessions/{uuid.uuid4()}")
    assert bad_resp.status_code == 404
    assert bad_resp.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


def test_hints_and_idempotency(client):
    # Segment 1 text: "I'm ready to learn."
    # Display tokens: 0: "I'm", 1: "ready", 2: "to", 3: "learn"
    resp = client.post("/api/segments/1/sessions", json={})
    session_id = resp.json()["id"]

    # Invalid display token index -> 422
    bad_hint = client.post(f"/api/sessions/{session_id}/hint", json={"display_token_index": 99})
    assert bad_hint.status_code == 422
    assert bad_hint.json()["error"]["code"] == "INVALID_INPUT"

    neg_hint = client.post(f"/api/sessions/{session_id}/hint", json={"display_token_index": -1})
    assert neg_hint.status_code == 422

    # Request hint for token 1 ("ready") -> returns initial letter "r"
    h1 = client.post(f"/api/sessions/{session_id}/hint", json={"display_token_index": 1})
    assert h1.status_code == 200
    assert h1.json()["display_token_index"] == 1
    assert h1.json()["hint_letter"] == "r"
    assert h1.json()["hinted_display_indices"] == [1]

    # Duplicate hint request is idempotent and does not duplicate index
    h1_dup = client.post(f"/api/sessions/{session_id}/hint", json={"display_token_index": 1})
    assert h1_dup.status_code == 200
    assert h1_dup.json()["hint_letter"] == "r"
    assert h1_dup.json()["hinted_display_indices"] == [1]

    # Request hint for token 0 ("I'm") -> returns initial letter "I"
    h0 = client.post(f"/api/sessions/{session_id}/hint", json={"display_token_index": 0})
    assert h0.status_code == 200
    assert h0.json()["hint_letter"] == "I"
    assert h0.json()["hinted_display_indices"] == [0, 1]


def test_reveal_does_not_complete_segment(client):
    resp = client.post("/api/segments/1/sessions", json={})
    session_id = resp.json()["id"]

    reveal_resp = client.post(f"/api/sessions/{session_id}/reveal")
    assert reveal_resp.status_code == 200
    data = reveal_resp.json()
    assert data["text"] == "I'm ready to learn."
    assert data["shadowing_unlocked"] is True
    assert data["completed"] is False  # Invariant 4.3.4: reveal does NOT complete segment

    # Verify session state reflects revealed
    s_resp = client.get(f"/api/sessions/{session_id}")
    assert s_resp.json()["answer_revealed"] is True

    # Verify video detail reports segment revealed but NOT completed
    v_resp = client.get("/api/videos/1")
    seg = v_resp.json()["segments"][0]
    assert seg["revealed"] is True
    assert seg["completed"] is False
    assert seg["shadowing_unlocked"] is True


def test_check_authoritative_scoring_and_completion(client):
    # Segment 1: "I'm ready to learn."
    resp = client.post("/api/segments/1/sessions", json={})
    session_id = resp.json()["id"]

    # Inexact attempt: "i ready to study"
    c1 = client.post(f"/api/sessions/{session_id}/check", json={"input_text": "i ready to study"})
    assert c1.status_code == 200
    res1 = c1.json()
    assert res1["is_exact"] is False
    assert res1["completed"] is False
    assert res1["assisted"] is False
    assert res1["score"] < 100
    assert res1["rules_version"] == "normalization-v1"

    # Exact attempt with contraction expansion: "i am ready to learn"
    c2 = client.post(f"/api/sessions/{session_id}/check", json={"input_text": "i am ready to learn"})
    assert c2.status_code == 200
    res2 = c2.json()
    assert res2["is_exact"] is True
    assert res2["score"] == 100
    assert res2["distance"] == 0
    assert res2["completed"] is True
    assert res2["shadowing_unlocked"] is True
    assert res2["assisted"] is False

    # Verify database persistence
    v_resp = client.get("/api/videos/1")
    seg = v_resp.json()["segments"][0]
    assert seg["completed"] is True
    assert seg["shadowing_unlocked"] is True

    # Inexact attempt after completion does NOT revert completion (Invariant 4.3.7)
    c3 = client.post(f"/api/sessions/{session_id}/check", json={"input_text": "wrong text"})
    assert c3.status_code == 200
    assert c3.json()["is_exact"] is False
    assert c3.json()["completed"] is True  # Stays completed!


def test_check_exact_with_hints_marks_assisted(client):
    # Segment 2: "We are at home."
    resp = client.post("/api/segments/2/sessions", json={})
    session_id = resp.json()["id"]

    # Use a hint
    client.post(f"/api/sessions/{session_id}/hint", json={"display_token_index": 0})

    # Exact check
    c = client.post(f"/api/sessions/{session_id}/check", json={"input_text": "We are at home."})
    assert c.status_code == 200
    data = c.json()
    assert data["is_exact"] is True
    assert data["completed"] is True
    assert data["assisted"] is True  # Marked assisted!


def test_copying_text_after_reveal_does_not_complete_session(client):
    # Segment 2: "We are at home." (uncompleted)
    resp = client.post("/api/segments/2/sessions", json={})
    session_id = resp.json()["id"]

    # Reveal the answer first
    client.post(f"/api/sessions/{session_id}/reveal")

    # Now type the exact sentence in this revealed session
    c = client.post(f"/api/sessions/{session_id}/check", json={"input_text": "We are at home."})
    assert c.status_code == 200
    data = c.json()
    assert data["is_exact"] is True
    assert data["score"] == 100
    # Invariant 4.3.5: copying after reveal does NOT mark session completed!
    assert data["completed"] is False
    assert data["shadowing_unlocked"] is True

    # Database also confirms segment is NOT completed
    v_resp = client.get("/api/videos/1")
    seg = v_resp.json()["segments"][1]
    assert seg["completed"] is False
    assert seg["revealed"] is True


def test_new_session_allows_re_attempting_revealed_sentence(client):
    # Segment 2 was revealed previously.
    # User clicks "Try again", creating a fresh session for segment 2
    resp = client.post("/api/segments/2/sessions", json={})
    new_session_id = resp.json()["id"]
    assert resp.json()["answer_revealed"] is False

    # In this new unrevealed session, user types exact answer
    c = client.post(f"/api/sessions/{new_session_id}/check", json={"input_text": "We are at home."})
    assert c.status_code == 200
    data = c.json()
    assert data["is_exact"] is True
    assert data["completed"] is True  # Invariant 4.3.6: new session allows completing!

    # Database confirms segment is completed
    v_resp = client.get("/api/videos/1")
    seg = v_resp.json()["segments"][1]
    assert seg["completed"] is True


def test_check_idempotency_and_conflict(client, test_db):
    resp = client.post("/api/segments/1/sessions", json={})
    session_id = resp.json()["id"]

    check_req_id = str(uuid.uuid4())
    payload = {"input_text": "We are home", "client_request_id": check_req_id}

    # First attempt
    res1 = client.post(f"/api/sessions/{session_id}/check", json=payload)
    assert res1.status_code == 200
    attempt_id = res1.json()["attempt_id"]

    # Network retry with identical payload -> returns same attempt without duplicating rows
    res2 = client.post(f"/api/sessions/{session_id}/check", json=payload)
    assert res2.status_code == 200
    assert res2.json()["attempt_id"] == attempt_id

    # Verify exactly one attempt row exists in DB
    with Session(test_db) as db:
        attempts = db.exec(
            select(DictationAttempt).where(DictationAttempt.client_request_id == check_req_id)
        ).all()
        assert len(attempts) == 1

    # Same client_request_id with different input -> 409 Conflict
    conflict_payload = {"input_text": "Different input", "client_request_id": check_req_id}
    res3 = client.post(f"/api/sessions/{session_id}/check", json=conflict_payload)
    assert res3.status_code == 409
    assert res3.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_oversized_input_rejected(client):
    resp = client.post("/api/segments/1/sessions", json={})
    session_id = resp.json()["id"]

    oversized = "a" * 2001
    res = client.post(f"/api/sessions/{session_id}/check", json={"input_text": oversized})
    assert res.status_code == 422
