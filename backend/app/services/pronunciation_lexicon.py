"""Bundled British pronunciation dictionaries with explicit source metadata.

Britfone and ipa-dict UK entries are dictionary data. The small original seed is
used only for uncovered teaching words and keeps its pending-review label.
Unknown words never reuse unverified IPA from the legacy cache.
"""
import unicodedata
import csv
import re
from pathlib import Path
from functools import lru_cache

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


@lru_cache(maxsize=1)
def _ipa_dict_uk():
    path = Path(__file__).resolve().parents[1] / 'resources' / 'ipa_dict_uk' / 'en_UK.txt'
    readings = {}
    with path.open(encoding='utf-8') as file:
        for line in file:
            word, separator, raw = line.strip().partition('\t')
            if separator:
                options = re.findall(r'/([^/]+)/', raw)
                if options:
                    readings[word.lower()] = list(dict.fromkeys(options))
    return readings


@lru_cache(maxsize=1)
def _britfone():
    readings = {}
    path = Path(__file__).resolve().parents[1] / 'resources' / 'britfone' / 'britfone.main.3.0.1.csv'
    with path.open(encoding='utf-8-sig', newline='') as file:
        for row in csv.reader(file):
            if len(row) != 2:
                continue
            word = re.sub(r'\(\d+\)$', '', row[0]).replace('_', ' ').lower()
            ipa = ''.join(row[1].split())
            options = readings.setdefault(word, [])
            if ipa and ipa not in options:
                options.append(ipa)
    return readings


def resolve_pronunciation(word: str) -> dict:
    word = unicodedata.normalize('NFKC', word).strip().lower().replace('’', "'").replace('‐', '-').replace('‑', '-')
    readings = _britfone().get(word)
    source = 'Britfone 3.0.1 (local)'
    version = 'britfone-3.0.1-1062be14'
    if not readings:
        readings = _ipa_dict_uk().get(word)
        source = 'ipa-dict UK / RP (local)'
        version = 'ipa-dict-uk-v1'
    dictionary = bool(readings)
    options = [f"/{ipa}/" for ipa in (readings or READINGS.get(word, []))]
    notes = []
    if len(options) > 1:
        notes.append('Multiple readings: select using meaning and context.')
    if dictionary:
        notes.append('British English (RP/Standard Southern British). Stress marks precede the stressed vowel in this source; accents vary.')
    elif options:
        notes.append('Broad southern non-rhotic transcription; independent review pending.')
    return {
        'phonetic_uk': options[0] if len(options) == 1 else None,
        'ipa_options': options,
        'ipa_quality': 'dictionary' if dictionary else 'editorial_pending_review' if options else 'unavailable',
        'ipa_source': source if dictionary else 'fluenttube-original-gb-seed' if options else None,
        'ipa_version': version if dictionary else VERSION,
        'ipa_notes': notes,
    }
