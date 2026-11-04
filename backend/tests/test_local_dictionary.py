from backend.app.services.local_dictionary import lookup_meanings
from backend.app.services.pronunciation_lexicon import resolve_pronunciation, _britfone, _ipa_dict_uk


def test_local_resources_cover_common_and_less_common_words():
    assert len(set(_britfone()) | set(_ipa_dict_uk())) > 65000
    for word in ('approach', 'simplistic', 'water', 'information'):
        assert resolve_pronunciation(word)['ipa_options']
        assert lookup_meanings(word)
    assert lookup_meanings('simplistic')[0]['part_of_speech'] == 'adjective'
    assert lookup_meanings('simplistic')[0]['examples']


def test_inflected_words_and_phrases_use_real_wordnet_entries():
    assert any(sense['lemma'] == 'approach' for sense in lookup_meanings('approaching'))
    assert any(sense['lemma'] == 'child' for sense in lookup_meanings('children'))
    assert lookup_meanings('give up')
    assert not lookup_meanings('zxqvunknownword')


def test_behind_starts_with_preposition_and_examples_use_the_queried_word():
    senses = lookup_meanings('behind')
    assert senses[0]['part_of_speech'] == 'preposition'
    assert any('memes' in example for example in senses[0]['examples'])
    assert all('behind' in example.lower() for sense in senses for example in sense['examples'])
    assert any(sense['part_of_speech'] == 'noun' for sense in senses)
    approach = lookup_meanings('approach')
    assert all('approach' in example.lower() for sense in approach for example in sense['examples'])
