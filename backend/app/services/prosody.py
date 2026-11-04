"""Descriptive, experimental CPU analysis. No pronunciation score is inferred."""
import numpy as np

VERSION = "median-semitones-1"


def analyze_audio(path):
    import parselmouth
    sound = parselmouth.Sound(str(path))
    duration = sound.duration
    if not 0.3 <= duration <= 31:
        raise ValueError("Acoustic analysis requires 0.3–31 seconds")
    # The uploader/reference extractor already normalizes to mono PCM 16 kHz.
    samples = sound.values[0]
    clipping = float(np.mean(np.abs(samples) >= .999))
    pitch = sound.to_pitch(time_step=.01, pitch_floor=50, pitch_ceiling=600)
    hz = pitch.selected_array["frequency"]
    voiced = hz > 0
    contour = np.full(hz.shape, np.nan)
    if np.any(voiced):
        contour[voiced] = 12 * np.log2(hz[voiced] / np.median(hz[voiced]))
    # Activity is energy-based, separate from voiced pitch. Internal gaps remain.
    size = max(1, int(sound.sampling_frequency * .02))
    frames = samples[:len(samples)//size*size].reshape(-1, size)
    rms = np.sqrt(np.mean(frames**2, axis=1))
    threshold = max(.003, float(np.max(rms)) * .1)
    active = np.flatnonzero(rms > threshold)
    pauses = []
    if active.size:
        for left, right in zip(active[:-1], active[1:]):
            if right-left >= 8:
                pauses.append({"start_seconds": round((int(left)+1)*.02, 3),
                               "end_seconds": round(int(right)*.02, 3)})
    usable = np.count_nonzero(voiced) >= 20 and clipping < .01 and active.size >= 10
    return {
        "status": "estimated" if usable else "unscorable", "duration_seconds": round(duration, 3),
        "voiced_ratio": round(float(np.mean(voiced)), 4), "clipped_ratio": round(clipping, 4),
        "rms_dbfs": round(float(20 * np.log10(max(float(np.sqrt(np.mean(samples**2))), 1e-8))), 1),
        "pitch_times_seconds": [round(float(t), 4) for t in pitch.xs()],
        "pitch_semitones": [round(float(x), 4) if np.isfinite(x) else None for x in contour],
        "pitch_range_semitones": round(float(np.percentile(contour[voiced], 90)-np.percentile(contour[voiced], 10)), 3) if usable else None,
        "pauses": pauses, "activity_method": "relative_energy_v1",
        "warning_codes": ([] if usable else ["INSUFFICIENT_ACOUSTIC_SIGNAL"])
            + ["SINGLE_SPEAKER_AND_NOISE_QUALITY_UNVERIFIED", "EXPERIMENTAL_PITCH_TRACKING"],
    }


def compare_audio(reference, recording, word_match, reference_features=None):
    a = reference_features if reference_features is not None else analyze_audio(reference)
    b = analyze_audio(recording)
    return {
        "status": "experimental" if a["status"] == b["status"] == "estimated" else "unscorable",
        "normalization_method": VERSION, "reference": a, "recording": b,
        "pitch_contour_similarity": None, "rhythm_similarity": None, "pause_similarity": None,
        "warning_codes": ["DESCRIPTIVE_ONLY_NOT_CALIBRATED"]
            + (["LOW_TEXT_COVERAGE"] if (word_match or 0) < 70 else []),
    }
