import { useEffect, useState } from 'react';
import { request, phoneticsAudioUrl } from '../api/client';

interface Unit { id: string; title: string; example: string; instruction: string; focus: string; completed: boolean }
interface Question { id: string; prompt: string; options: { id: string; label: string }[] }

function UnitPractice({ unit, onComplete }: { unit: Unit; onComplete: () => void }) {
  const [question, setQuestion] = useState<Question>();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function begin() {
    setBusy(true); setError('');
    try {
      setQuestion(await request<Question>(`/phonetics/quizzes/${unit.id}`, { method:'POST' }));
      setFeedback('');
    } catch { setError('No se pudo cargar la actividad. Vuelve a intentarlo.'); }
    finally { setBusy(false); }
  }
  async function choose(option: string) {
    if (!question || busy) return;
    setBusy(true); setError('');
    try {
      const result = await request<{correct:boolean; solution:string; explanation:string}>(`/phonetics/quizzes/${question.id}/answer`, {
        method:'POST', body:JSON.stringify({selected_id:option}) });
      setFeedback((result.correct ? 'Correcto. ' : 'Respuesta: ' + result.solution + '. ') + result.explanation);
      if (result.correct) onComplete();
    } catch { setError('No se pudo guardar. Reintenta la misma respuesta.'); }
    finally { setBusy(false); }
  }
  return <article className="space-y-3 mt-3 rounded-panel bg-surface p-4" lang="es">
    <h3 className="text-xl">{unit.id} · {unit.title}</h3><p>{unit.instruction}</p>
    <blockquote lang="en" className="border-l-2 border-accent pl-3 text-lg">{unit.example}</blockquote>
    <audio aria-label="Ejemplo de la unidad" controls preload="none" src={phoneticsAudioUrl('/audio/'+unit.id)} onError={() => setError('Audio no disponible. Puedes seguir con la lectura y la actividad.')} />
    <p className="text-sm text-text-muted">Voz sintética para escuchar las palabras. Ensaya tú los cambios de intención, ritmo o variedad que pide la consigna.</p>
    <button className="secondary-button" disabled={busy} onClick={begin}>{question ? 'Repetir actividad' : 'Comprobar lo aprendido'}</button>
    {question && <><p>{question.prompt}</p><div className="flex flex-wrap gap-2">{question.options.map(opt => <button key={opt.id} className="secondary-button" disabled={busy || !!feedback} onClick={() => choose(opt.id)}>{opt.label}</button>)}</div></>}
    {feedback && <p role="status">{feedback}</p>}{error && <p role="alert">{error}</p>}
  </article>;
}

export function PhoneticsCourse() {
  const [units,setUnits] = useState<Unit[]>([]);
  const [index,setIndex] = useState(0);
  const [error,setError] = useState(false);
  const [retry,setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    request<Unit[]>('/phonetics/course').then(rows => { if (active) setUnits(rows); }).catch(() => { if (active) setError(true); });
    return () => { active=false; };
  },[retry]);
  const unit = units[index];
  if (error) return <button onClick={() => setRetry(n => n+1)}>Reintentar carga del curso</button>;
  if (!unit) return <p role="status">Cargando unidades…</p>;
  return <div className="py-3"><label>Unidad del curso <select className="bg-surface p-2 max-w-full" value={index} onChange={e => setIndex(Number(e.target.value))}>
    {units.map((u,i) => <option key={u.id} value={i}>{u.completed ? '✓ ' : ''}{u.id} · {u.title}</option>)}</select></label>
    <p className="text-xs mt-2">{units.filter(u => u.completed).length} de {units.length} unidades con respuesta correcta</p>
    <UnitPractice key={unit.id} unit={unit} onComplete={() => setUnits(rows => rows.map(u => u.id===unit.id ? {...u,completed:true} : u))}/>
    <div className="flex justify-between mt-3"><button className="quiet-button" disabled={index===0} onClick={() => setIndex(index-1)}>Anterior</button>
      <button className="quiet-button" disabled={index===units.length-1} onClick={() => setIndex(index+1)}>Siguiente unidad</button></div></div>;
}
