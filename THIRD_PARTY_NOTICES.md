# Bundled offline dictionaries

These datasets ship as local data files in `backend/app/resources/`. They are not hosted APIs. No network request or runtime download is needed for IPA or definitions. Their licenses apply to the datasets; no ownership of the source data is claimed.

- **Britfone 3.0.1**, Jose Llarena: https://github.com/JoseLlarena/Britfone. British English RP/Standard Southern British pronunciations, MIT license. Original CSV, README and license included in `britfone/`; revision and SHA-256 in `source.json`.
- **ipa-dict, English UK / Received Pronunciation**, open-dict-data, derived from leoboiko/ipacards: https://github.com/open-dict-data/ipa-dict and https://github.com/leoboiko/ipacards. English UK data retains GPL-3.0; the surrounding ipa-dict repository is MIT. Original tab-separated source, README, GPL-3.0 and MIT texts included in `ipa_dict_uk/`; revision and SHA-256 in `source.json`. These files are unmodified and remain available in source form for redistribution under their licenses.
- **Princeton WordNet 3.0**, copyright 2006 Princeton University: https://wordnet.princeton.edu/. Redistributed under the WordNet 3.0 license, included in `wordnet/LICENSE.txt` and inside the original `wordnet.zip`. Source archive URL and SHA-256 in `wordnet/source.json`. The application parses the original data locally; NLTK is not a runtime dependency.

The IPA dictionaries cover 67,333 distinct spellings in the bundled revisions. WordNet covers 147,306 distinct indexed spellings including compounds. Neither resource covers every proper name, inflection or phrase. Sentence guides show the first reading by default and let the learner select alternatives, without inferring which homograph is intended. Stress markers in Britfone and this UK dataset attach to the stressed vowel. IPA is broad dictionary pronunciation, not an analysis of the recording.

WordNet provides English definitions, parts of speech and examples where its entries contain examples. The optional AI tutor supplies separate contextual explanations/translations; optional Edge TTS supplies online synthetic audio. These optional services are not used to resolve local dictionary entries.
