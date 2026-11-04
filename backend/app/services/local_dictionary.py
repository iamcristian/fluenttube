"""Offline WordNet definitions. No packages, downloads or API calls at runtime."""
from functools import lru_cache
from pathlib import Path
import re
import unicodedata
import zipfile

CORPUS = Path(__file__).resolve().parents[1] / 'resources' / 'wordnet' / 'wordnet.zip'
PARTS = {'noun': 'noun', 'verb': 'verb', 'adj': 'adjective', 'adv': 'adverb'}
SUFFIXES = {
    'noun': [('s', ''), ('ses', 's'), ('xes', 'x'), ('zes', 'z'), ('ches', 'ch'), ('shes', 'sh'), ('men', 'man'), ('ies', 'y')],
    'verb': [('s', ''), ('ies', 'y'), ('es', 'e'), ('es', ''), ('ed', 'e'), ('ed', ''), ('ing', 'e'), ('ing', '')],
    'adj': [('er', ''), ('est', ''), ('er', 'e'), ('est', 'e')],
    'adv': [],
}


@lru_cache(maxsize=1)
def _corpus():
    indexes, data, exceptions = {}, {}, {}
    with zipfile.ZipFile(CORPUS) as archive:
        for pos in PARTS:
            index = {}
            for line in archive.read(f'wordnet/index.{pos}').decode('utf-8').splitlines():
                if not line or line.startswith(' '):
                    continue
                fields = line.split()
                count = int(fields[2])
                index[fields[0]] = [int(offset) for offset in fields[-count:]]
            indexes[pos] = index
            data[pos] = archive.read(f'wordnet/data.{pos}')
            exceptions[pos] = dict((parts[0], parts[1:]) for line in archive.read(f'wordnet/{pos}.exc').decode().splitlines() if (parts := line.split()))
    return indexes, data, exceptions


@lru_cache(maxsize=2048)
def lookup_meanings(word: str) -> list[dict]:
    key = unicodedata.normalize('NFKC', word).strip().lower().replace('’', "'").replace(' ', '_')
    indexes, data, exceptions = _corpus()
    from backend.app.services.function_words import function_word_senses
    senses = function_word_senses(key)
    for pos, label in PARTS.items():
        candidates = [key] if key in indexes[pos] else exceptions[pos].get(key, [])
        if not candidates:
            candidates = list(dict.fromkeys(key[:-len(suffix)] + ending for suffix, ending in SUFFIXES[pos]
                                           if key.endswith(suffix) and key[:-len(suffix)] + ending in indexes[pos]))
        for lemma in candidates:
            for offset in indexes[pos].get(lemma, [])[:3]:
                end = data[pos].find(b'\n', offset)
                gloss = data[pos][offset:end if end >= 0 else None].decode('utf-8').partition('|')[2].strip()
                examples = re.findall(r'"([^"\n]+)"', gloss)
                # Synset examples may use a synonym, not the queried lemma.
                phrase = r'\s+'.join(re.escape(part) for part in lemma.split('_'))
                examples = [example for example in examples if re.search(r'(?<!\w)' + phrase + r'(?!\w)', example, re.IGNORECASE)]
                definition = re.sub(r';?\s*"[^"\n]+"', '', gloss).strip(' ;')
                senses.append({'part_of_speech': label, 'meaning': definition, 'examples': examples, 'lemma': lemma.replace('_', ' ')})
    return senses
