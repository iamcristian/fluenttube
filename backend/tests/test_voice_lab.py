import io
import wave
import numpy as np
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.routers import phonetics
from backend.app.services import audio_service


def wav_bytes(silent=False):
    signal = np.zeros(16000) if silent else .1 * np.sin(2*np.pi*180*np.arange(16000)/16000)
    file = io.BytesIO()
    with wave.open(file, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes((signal*32767).astype("<i2").tobytes())
    return file.getvalue()


def test_voice_comparison_real_audio_and_cleanup(tmp_path, monkeypatch):
    ref = tmp_path / "example.wav"
    ref.write_bytes(wav_bytes())
    scratch = tmp_path / "scratch"
    monkeypatch.setattr(audio_service, "TEMP_DIR", scratch)
    async def example(word):
        assert word == "sheep"
        return ref
    monkeypatch.setattr(phonetics, "get_or_create_british_audio", example)
    client = TestClient(app)
    for silent in (False, True):
        response = client.post("/api/phonetics/voice/fleece", files={"audio_file":("voice.wav",wav_bytes(silent),"audio/wav")})
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["status"] == ("unscorable" if silent else "experimental")
        assert data["recording"]["rms_dbfs"] < -100 if silent else data["recording"]["voiced_ratio"] > .5
        assert data["reference_source"] == "synthetic-en-GB-RyanNeural"
        assert not list(scratch.iterdir())
    assert ref.exists()
    response = client.post("/api/phonetics/voice/fleece",files={"audio_file":("bad.wav",b"garbage","audio/wav")})
    assert response.status_code == 415
    assert not list(scratch.iterdir())
    assert client.post("/api/phonetics/voice/missing",files={"audio_file":("voice.wav",wav_bytes(),"audio/wav")}).status_code == 404


def test_original_waveform_uses_only_selected_interval_and_removes_temp_file(tmp_path, monkeypatch):
    from sqlmodel import Session
    from backend.app.database import get_engine, init_db, get_session
    from backend.app.models import Video, Segment, LocalVideoMedia
    from backend.app.services import local_video
    engine = get_engine(f"sqlite:///{tmp_path / 'reference.db'}")
    init_db(engine)
    source = tmp_path / "source.wav"
    source.write_bytes(wav_bytes())
    scratch = tmp_path / "scratch"
    monkeypatch.setattr(audio_service, "TEMP_DIR", scratch)
    monkeypatch.setattr(local_video, "local_media_path", lambda relative: source)
    with Session(engine) as session:
        video = Video(source_key="test",title="test",duration_seconds=1,transcription_source="local_asr")
        session.add(video)
        session.flush()
        segment = Segment(video_id=video.id,position=0,start_seconds=.2,end_seconds=.8,text="hello",timing_quality="word")
        session.add(segment)
        session.add(LocalVideoMedia(video_id=video.id,file_relative_path="source.wav"))
        session.commit()
        session.refresh(segment)
        segment_id = segment.id
    def sessions():
        with Session(engine) as session:
            yield session
    app.dependency_overrides[get_session] = sessions
    try:
        response = TestClient(app).get(f"/api/segments/{segment_id}/reference-audio")
        assert response.status_code == 200
        with wave.open(io.BytesIO(response.content)) as w:
            assert abs(w.getnframes()/w.getframerate() - .6) < .02
        assert not list(scratch.iterdir())
        assert TestClient(app).get("/api/segments/999/reference-audio").status_code == 404
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
