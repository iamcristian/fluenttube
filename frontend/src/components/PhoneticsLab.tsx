import { useEffect, useRef, useState } from 'react';
import { request, phoneticsAudioUrl } from '../api/client';
import { useRecorder } from '../hooks/useRecorder';

import { PhoneticsCourse } from './PhoneticsCourse';
import { VoiceComparison } from './VoiceComparison';
import { splitReading, type WordReading } from './phoneticsNavigation';
import { PhoneticsReference } from './PhoneticsReference';
import { ArticulationPlate, type Diagram } from './ArticulationPlate';

interface Lesson {
  id: string; ipa: string; word: string; name: string; guide_es: string;
  contrast_id: string; contrast_word: string; diagram: Diagram;
}
interface Catalog {
  lessons: Lesson[];
  catalog: { ipa: string; category: string; lesson_id: string | null }[];
}
interface Review { lesson_id: string; attempts: number; correct: number; due: boolean; due_at: string }
interface Challenge { prompt?: string; id: string; options: { id: string; ipa: string }[] }

export function PhoneticsLab({ onClose, reading }: { onClose: () => void; reading?: WordReading }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selected, setSelected] = useState('kit');
  const [courseOpen, setCourseOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [answer, setAnswer] = useState<{ correct: boolean; answer_ipa: string; word: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [heard, setHeard] = useState(false);
  const [position, setPosition] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const quizAudio = useRef<HTMLAudioElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const generation = useRef(0);
  const recorder = useRecorder({ onBeforeStart: () => dialog.current?.querySelectorAll('audio').forEach(player => player.pause()) });
  const busyRecording = recorder.isRecording || recorder.state === 'requesting_permission' || recorder.state === 'stopping';
  const lesson = catalog?.lessons.find(item => item.id === selected);
  const notationQuiz = lesson?.diagram.kind === 'notation' || ['near','square','cure'].includes(selected);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReducedMotion(media.matches);
    motion(); media.addEventListener('change', motion);
    return () => { document.body.style.overflow = overflow; media.removeEventListener('change', motion); previous?.focus(); };
  }, []);

  useEffect(() => {
    let active = true;
    setError('');
    Promise.all([request<Catalog>('/phonetics/catalog'), request<{ items: Review[] }>('/phonetics/reviews')])
      .then(([content, progress]) => { if (active) { if (content.lessons.some(item => !item.diagram)) { setError('Restart the local FluentTube backend to load the updated sound atlas.'); return; } setCatalog(content); setReviews(progress.items); } })
      .catch(() => { if (active) setError('Could not load the lab. Check the local server and retry.'); });
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    generation.current += 1;
    setChallenge(null); setAnswer(null); setHeard(false); setPending(false); setPosition(0);
    recorder.resetRecording();
    const player = audio.current;
    return () => { generation.current += 1; player?.pause(); quizAudio.current?.pause(); };
  }, [selected]); // Recording is deliberately scoped to the selected lesson.

  async function startQuiz() {
    const token = generation.current;
    setPending(true); setError(''); setAnswer(null); setChallenge(null); setHeard(false);
    try {
      const next = await request<Challenge>(`/phonetics/quizzes/${selected}`, { method: 'POST' });
      if (generation.current === token) setChallenge(next);
    } catch { if (generation.current === token) setError('Exercise unavailable. Try again.'); }
    finally { if (generation.current === token) setPending(false); }
  }

  async function submitAnswer(id: string) {
    if (!challenge || pending) return;
    const token = generation.current;
    setPending(true); setError('');
    try {
      const result = await request<NonNullable<typeof answer>>(`/phonetics/quizzes/${challenge.id}/answer`,
        { method: 'POST', body: JSON.stringify({ selected_id: id }) });
      if (generation.current !== token) return;
      setAnswer(result);
      const progress = await request<{ items: Review[] }>('/phonetics/reviews');
      if (generation.current === token) setReviews(progress.items);
    } catch { if (generation.current === token) setError('Could not save your answer. Retry the same choice.'); }
    finally { if (generation.current === token) setPending(false); }
  }

  const article = useRef<HTMLElement>(null);
  const chartSearch = useRef<HTMLInputElement>(null);
  function selectLesson(id: string) {
    setSelected(id);
    requestAnimationFrame(() => article.current?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  }
  return <section ref={dialog} role="dialog" aria-modal="true" aria-label="Phonetics Lab" tabIndex={-1}
    className="fixed inset-0 z-50 overflow-auto bg-background text-text-primary p-4 sm:p-8"
    onPlayCapture={event => dialog.current?.querySelectorAll('audio').forEach(player => { if (player !== event.target) player.pause(); else if (busyRecording) player.pause(); })}
    onKeyDown={event => {
      if (event.key === 'Escape' && !busyRecording) onClose();
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,summary,a[href],audio,[tabindex="0"]') || []).filter(el => el.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4"><div><p className="eyebrow">LISTEN · NOTICE · REPEAT</p><h1 className="text-3xl font-semibold">Phonetics Lab</h1></div>
        <button className="secondary-button" disabled={busyRecording} onClick={onClose}>Return to study</button></header>
      <p className="text-sm text-text-secondary">Southern British teaching reference. 44 sound guides and three notation guides. Editorial content and articulation drawings await independent review. Regional pronunciations vary.</p>
      {error && <div role="alert"><p>{error}</p><button className="quiet-button" onClick={() => setRetry(value => value + 1)}>Retry loading</button></div>}
      {!catalog && !error && <p role="status">Loading lessons…</p>}
      {catalog && reading && <section className="rounded-panel border border-border p-4"><h2 className="font-semibold">{reading.word} · {reading.ipa}</h2><p>Elige un símbolo de esta lectura para practicarlo.</p><div className="flex gap-2 flex-wrap mt-2">{splitReading(reading.ipa,catalog.catalog.map(i => i.ipa)).map((part,i) => {
        const id = catalog.catalog.find(item => item.ipa === part)?.lesson_id;
        return id ? <button className="secondary-button" key={i} disabled={busyRecording} onClick={() => selectLesson(id)}>{part}</button> : <span key={i}>{part}</span>;
      })}</div></section>}
      {catalog && <PhoneticsReference disabled={busyRecording} onPractice={selectLesson}/>}
      <section className="rounded-panel border border-border p-4"><button className="secondary-button" disabled={busyRecording} aria-expanded={courseOpen} onClick={() => { audio.current?.pause(); quizAudio.current?.pause(); setCourseOpen(!courseOpen); }}>Curso guiado · 60 unidades</button>
        {courseOpen && <PhoneticsCourse/>}</section>
      <nav aria-label="Review queue" className="rounded-panel border border-border p-4"><h2 className="font-semibold">Review today</h2>
        <p className="text-xs text-text-muted">Perception practice · {reviews.filter(row => row.attempts > 0).length} sounds practised</p>
        <div className="flex flex-wrap gap-2 mt-2">{reviews.filter(row => row.due && row.attempts > 0).map(row => <button disabled={busyRecording} key={row.lesson_id} className="secondary-button" onClick={() => selectLesson(row.lesson_id)}>
          /{catalog?.lessons.find(item => item.id === row.lesson_id)?.ipa}/ · {row.attempts ? 'Due' : 'New'}</button>)}
          {reviews.length > 0 && !reviews.some(row => row.due && row.attempts > 0) && <p>No scheduled reviews due. Choose a symbol below to practise.</p>}</div></nav>
      <label className="block">Search IPA or example<input ref={chartSearch} className="block w-full bg-surface border border-border rounded p-2 mt-1" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {['Vowels', 'Diphthongs', 'Consonants', 'Stress & symbols'].map(category => <div key={category}><h2 className="font-semibold mb-2">{category}</h2><div className="flex flex-wrap gap-2">
        {catalog?.catalog.filter(item => item.category === category && `${item.ipa} ${catalog.lessons.find(row => row.id === item.lesson_id)?.word || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(item =>
          <button key={item.ipa} disabled={!item.lesson_id || busyRecording} aria-pressed={item.lesson_id === selected} className="secondary-button disabled:opacity-40" title={item.lesson_id ? 'Open lesson' : 'Reference symbol; lesson not yet authored'} onClick={() => item.lesson_id && selectLesson(item.lesson_id)}>{item.ipa}</button>)}</div></div>)}
      {lesson && <article ref={article} key={selected} aria-label={`Lesson ${lesson.ipa}`} className="grid md:grid-cols-2 gap-6 border border-border rounded-panel p-5">
        <div className="space-y-4"><button className="quiet-button" onClick={()=>{chartSearch.current?.focus({preventScroll:true});chartSearch.current?.scrollIntoView({block:'start'});}}>← Volver a la tabla</button><h2 className="text-2xl font-semibold">{lesson.diagram.kind === 'notation' ? lesson.ipa : '/' + lesson.ipa + '/'} · {lesson.word}</h2><p>{lesson.name}</p><p lang="es">{lesson.guide_es}</p>
          <ArticulationPlate model={lesson.diagram} ipa={lesson.ipa} progress={reducedMotion ? 0 : position}/>
          <p className="text-xs text-text-muted">{lesson.diagram.kind === 'notation' ? 'Lee la marca resaltada junto con el ejemplo.' : 'Esquema orientativo de la articulación. La voz de ejemplo puede variar.'} {reducedMotion ? 'Static pose enabled for reduced motion.' : ''}</p>
          <audio key={selected} ref={audio} controls preload="metadata" onTimeUpdate={event => { const el = event.currentTarget; if (el.duration && !reducedMotion) setPosition(el.currentTime / el.duration); }} className="w-full" src={phoneticsAudioUrl(`/audio/${selected}`)} onError={() => setError('British audio unavailable. Connect and reload audio.')} />
          <div className="flex gap-2 flex-wrap"><button className="quiet-button" onClick={() => { if (audio.current) { audio.current.load(); audio.current.play().catch(() => setError('Audio unavailable. Try again.')); } }}>Reload audio</button>
            <label>Speed <select className="bg-surface" defaultValue="1" onChange={event => { if (audio.current) audio.current.playbackRate = Number(event.target.value); }}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option></select></label>
            <label><input type="checkbox" onChange={event => { if (audio.current) audio.current.loop = event.target.checked; }} /> Loop</label></div>
          <p className="text-xs text-text-muted">Synthetic British voice · Edge TTS · first play needs internet, then cached locally. Example words, not isolated phoneme recordings.</p>
        </div>
        <div className="space-y-4">
          <VoiceComparison recorder={recorder} lessonId={selected} word={lesson.word}/>
          <details className="border border-border rounded p-3"><summary className="cursor-pointer">Práctica de oído opcional · {lesson.ipa} / {catalog?.lessons.find(l=>l.id===lesson.contrast_id)?.ipa}</summary>
          <h3 className="text-xl mt-3">{notationQuiz ? 'Read the notation' : 'Can you hear the contrast?'}</h3><p>{notationQuiz ? 'Choose the symbol that matches the description.' : 'El audio elige al azar una de las dos palabras del contraste. Puede ser el otro sonido, aunque esta ficha esté abierta. Cada ronda vuelve a elegir entre las mismas dos palabras y puede repetir.'}</p>
          <button disabled={pending || busyRecording} className="primary-button" onClick={startQuiz}>{challenge ? 'New exercise' : notationQuiz ? 'Start notation exercise' : 'Start listening exercise'}</button>
          {challenge && <div className="space-y-3">{challenge.prompt ? <p>{challenge.prompt}</p> : <audio ref={quizAudio} key={challenge.id} controls preload="none" className="w-full" src={phoneticsAudioUrl(`/quizzes/${challenge.id}/audio`)} onEnded={() => setHeard(true)} onError={() => setError('Exercise audio unavailable. Retry playback before answering.')} />}
            <div className="flex gap-3">{challenge.options.map(option => <button key={option.id} disabled={(!heard && !challenge.prompt) || pending || Boolean(answer)} className="secondary-button" onClick={() => submitAnswer(option.id)}>/{option.ipa}/</button>)}</div>
            {!heard && !challenge.prompt && <p className="text-xs text-text-muted">Listen to the full clip to unlock the choices.</p>}
            {answer && <p role="status">{answer.correct ? 'Correct.' : challenge.prompt ? 'Check the highlighted notation.' : 'Listen again.'} {challenge.prompt ? 'Symbol' : 'You heard'} {answer.answer_ipa} in “{answer.word}”. Saved for review.</p>}
          </div>}
          {reviews.filter(row => row.lesson_id === selected && row.attempts > 0).map(row => <p key={row.lesson_id} className="text-sm">{row.correct}/{row.attempts} listening answers correct. Next review {new Date(row.due_at).toLocaleDateString()}.</p>)}
          </details>
        </div>
      </article>}
    </div>
  </section>;
}
