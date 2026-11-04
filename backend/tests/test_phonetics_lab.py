from fastapi.testclient import TestClient
import json
from backend.app.services.pronunciation_lexicon import resolve_pronunciation
from sqlmodel import Session, select
from backend.app.main import app
from backend.app.database import get_session, get_engine, init_db
from backend.app.models import PhoneticsChallenge, PhoneticsReview


def test_quiz_answer_is_hidden_and_review_persists(tmp_path):
    engine = get_engine(f"sqlite:///{tmp_path / 'review.db'}")
    init_db(engine)
    def session_override():
        with Session(engine) as session:
            yield session
    app.dependency_overrides[get_session] = session_override
    try:
        client = TestClient(app)
        catalog = client.get('/api/phonetics/catalog').json()
        lessons = {lesson['id']: lesson for lesson in catalog['lessons']}
        assert len(lessons) == len(catalog['catalog']) == 47
        assert len({json.dumps(row['diagram'], sort_keys=True) for row in lessons.values()}) == 47
        for item in catalog['catalog']:
            lesson = lessons[item['lesson_id']]
            assert item['ipa'] == lesson['ipa']
            assert lesson['contrast_id'] in lessons
            assert lesson['guide_es'] and lesson['diagram']
            assert resolve_pronunciation(lesson['word'])['ipa_options']
            assert client.post('/api/phonetics/quizzes/' + lesson['id']).status_code == 200
        challenge = client.post('/api/phonetics/quizzes/kit').json()
        assert set(challenge) == {'id', 'options'}
        with Session(engine) as session:
            target = session.get(PhoneticsChallenge, challenge['id']).target_id
        url = f"/api/phonetics/quizzes/{challenge['id']}/answer"
        assert client.post(url, json={'selected_id': target}).json()['correct']
        assert client.post(url, json={'selected_id': target}).status_code == 200
        other = 'kit' if target == 'fleece' else 'fleece'
        assert client.post(url, json={'selected_id': other}).status_code == 409
        init_db(engine)
        review = next(row for row in client.get('/api/phonetics/reviews').json()['items'] if row['lesson_id'] == 'kit')
        assert review['attempts'] == review['correct'] == 1
        assert not review['due']
        with Session(engine) as session:
            assert len(session.exec(select(PhoneticsReview)).all()) == 1
        assert client.post('/api/phonetics/quizzes/missing').status_code == 404
        units = client.get('/api/phonetics/course').json()
        assert len(units) == len({u['id'] for u in units}) == 60
        assert all('solution' not in u and u['instruction'] for u in units)
        quiz = client.post('/api/phonetics/quizzes/D60').json()
        choice = next(o['id'] for o in quiz['options'] if o['label'] == 'Que el oyente entienda el número')
        outcome = client.post(f"/api/phonetics/quizzes/{quiz['id']}/answer", json={'selected_id': choice})
        assert outcome.json()['correct'] and outcome.json()['explanation']
        assert client.get('/api/phonetics/course').json()[-1]['completed']
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
