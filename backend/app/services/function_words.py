"""Original learner definitions for common function words omitted by WordNet."""

_ENTRIES = {
    'behind': ('preposition', 'At the back of something, or responsible for the cause, origin or support of something.', ['The garden is behind the house.', 'Who is behind all these memes?']),
    'in': ('preposition', 'Inside a place, space or period of time.', ['The keys are in my bag.']),
    'on': ('preposition', 'Touching a surface, or relating to a particular day or subject.', ['The book is on the table.']),
    'at': ('preposition', 'Used to identify a particular place, point or time.', ['Meet me at the station.']),
    'of': ('preposition', 'Shows a relationship, belonging, a part or a quantity.', ['This is a picture of my family.']),
    'to': ('preposition', 'Shows movement towards a place, a recipient or a limit.', ['We walked to the park.']),
    'for': ('preposition', 'Shows a purpose, recipient, reason or duration.', ['This present is for you.']),
    'with': ('preposition', 'Together with someone, or using or having something.', ['She came with her brother.']),
    'without': ('preposition', 'Not having or using something, or not accompanied by someone.', ['I drink tea without sugar.']),
    'from': ('preposition', 'Shows the starting point, origin or source.', ['The letter is from my sister.']),
    'by': ('preposition', 'Shows the person doing something, a method, a nearby position or a deadline.', ['The poem was written by a friend.']),
    'about': ('preposition', 'Concerning a subject.', ['We talked about the film.']),
    'into': ('preposition', 'Towards the inside of something, or changing to a new state.', ['She walked into the room.']),
    'between': ('preposition', 'In the space separating things, or connecting people or things.', ['The shop is between the bank and the library.']),
    'under': ('preposition', 'Below something, or affected by a condition or control.', ['The cat is under the bed.']),
    'over': ('preposition', 'Above, across or covering something.', ['We walked over the bridge.']),
    'the': ('article', 'Identifies a specific person or thing already known or made clear by the context.', ['Please close the door.']),
    'a': ('article', 'Introduces one non-specific person or thing before a consonant sound.', ['She bought a book.']),
    'an': ('article', 'Introduces one non-specific person or thing before a vowel sound.', ['He ate an apple.']),
}


def function_word_senses(word: str) -> list[dict]:
    entry = _ENTRIES.get(word)
    if not entry:
        return []
    pos, meaning, examples = entry
    return [{'part_of_speech': pos, 'meaning': meaning, 'examples': examples.copy(), 'lemma': word}]
