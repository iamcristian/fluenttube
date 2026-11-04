"""Small original broad-IPA seed, with explicit editorial status.

Transcriptions describe the southern non-rhotic teaching profile. They are
editorial proposals pending independent phonetic review, not dictionary data.
Unknown words remain unavailable even if a legacy cache contains a transcription.
"""
import unicodedata

VERSION = "gb-seed-2"
READINGS = {
    "car": ["kɑː"], "bird": ["bɜːd"], "lot": ["lɒt"],
    "thought": ["θɔːt"], "water": ["ˈwɔːtə"], "tomato": ["təˈmɑːtəʊ"],
    "schedule": ["ˈʃedjuːl", "ˈskedʒuːl"], "read": ["riːd", "red"],
    "record": ["ˈrekɔːd", "rɪˈkɔːd"], "lead": ["liːd", "led"],
    "present": ["ˈprezənt", "prɪˈzent"], "ship": ["ʃɪp"],
    "sheep": ["ʃiːp"], "world": ["wɜːld"], "hello": ["həˈləʊ"],
    "can't": ["kɑːnt"],
    "bed": ["bed"], "bad": ["bæd"], "cart": ["kɑːt"], "cot": ["kɒt"],
    "caught": ["kɔːt"], "full": ["fʊl"], "fool": ["fuːl"], "cut": ["kʌt"],
    "about": ["əˈbaʊt"], "late": ["leɪt"], "light": ["laɪt"], "boy": ["bɔɪ"],
    "coat": ["kəʊt"], "cow": ["kaʊ"], "near": ["nɪə", "nɪː"],
    "square": ["skweə", "skwɛː"], "cure": ["kjʊə", "kjɔː"],
    "pin": ["pɪn"], "bin": ["bɪn"], "tin": ["tɪn"], "din": ["dɪn"],
    "goat": ["ɡəʊt"], "fan": ["fæn"], "van": ["væn"], "thin": ["θɪn"],
    "then": ["ðen"], "sip": ["sɪp"], "zip": ["zɪp"], "vision": ["ˈvɪʒən"],
    "hat": ["hæt"], "cheap": ["tʃiːp"], "jeep": ["dʒiːp"], "sum": ["sʌm"],
    "sun": ["sʌn"], "sung": ["sʌŋ"], "right": ["raɪt"], "yes": ["jes"],
    "wet": ["wet"], "banana": ["bəˈnɑːnə"], "information": ["ˌɪnfəˈmeɪʃən"],
}


def resolve_pronunciation(word: str) -> dict:
    word = unicodedata.normalize("NFC", word).strip().lower().replace("’", "'")
    options = [f"/{ipa}/" for ipa in READINGS.get(word, [])]
    return {
        "phonetic_uk": options[0] if len(options) == 1 else None,
        "ipa_options": options,
        "ipa_quality": "editorial_pending_review" if options else "unavailable",
        "ipa_source": "fluenttube-original-gb-seed" if options else None,
        "ipa_version": VERSION,
        "ipa_notes": (["Pronunciation varies by speaker and accent."] if word in {"near", "square", "cure", "schedule"}
                      else ["Multiple readings: select using meaning and context."] if len(options) > 1 else [])
        + (["Broad southern non-rhotic transcription; independent review pending."] if options else []),
    }
