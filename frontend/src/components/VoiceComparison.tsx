import { useEffect, useRef, useState } from 'react';
import type { UseRecorderReturn } from '../hooks/useRecorder';
import type { ProsodyResult } from '../api/types';
import { request, phoneticsAudioUrl } from '../api/client';
import { ProsodyPanel } from './ProsodyPanel';
import { MicrophoneControls } from './MicrophoneControls';

type Result = ProsodyResult & {recording: NonNullable<ProsodyResult['recording']> & {rms_dbfs:number}};
export function VoiceComparison({recorder,lessonId,word}:{recorder:UseRecorderReturn;lessonId:string;word:string}) {
  const [result,setResult] = useState<Result>();
  const [pending,setPending] = useState(false);
  const [error,setError] = useState('');
  const version = useRef(0);
  useEffect(()=>{version.current++;setResult(undefined);setPending(false);setError('');return ()=>{version.current++;};},[recorder.audioBlob,lessonId]);
  async function analyze() {
    if (!recorder.audioBlob || pending) return;
    const token = version.current;
    setPending(true);setError('');
    const body = new FormData();
    body.append('audio_file',recorder.audioBlob,'recording.webm');
    try { const value = await request<Result>('/phonetics/voice/'+lessonId,{method:'POST',body});
      if (token===version.current) setResult(value);
    } catch(e) {if(token===version.current)setError(e instanceof Error ? e.message : 'No se pudo analizar. Vuelve a intentarlo.');}
    finally {if(token===version.current)setPending(false);}
  }
  return <section className="space-y-3" aria-label="Prueba de voz" lang="es">
    <h3 className="text-xl">Prueba tu micrófono y compara tu voz</h3>
    <p>Di “{word}” una vez, dejando un pequeño silencio antes y después. Comprueba el nivel al grabar y escucha tu toma antes de compararla.</p>
    <MicrophoneControls recorder={recorder}/>
    <button className="primary-button" disabled={pending || ['requesting_permission','stopping'].includes(recorder.state)} onClick={recorder.isRecording ? recorder.stopRecording : recorder.startRecording}>
      {recorder.isRecording ? 'Detener grabación' : recorder.audioUrl ? 'Grabar otra toma' : 'Grabar mi voz'}</button>
    {recorder.errorMessage && <p role="alert">{recorder.errorMessage}</p>}
    {recorder.audioUrl && <><div className="space-y-2"><label className="block">Ejemplo británico · voz sintética<audio aria-label="Ejemplo para comparar" controls src={phoneticsAudioUrl('/audio/'+lessonId)} className="w-full"/></label><label className="block">Tu grabación<audio aria-label="Tu grabación" controls src={recorder.audioUrl} className="w-full"/></label></div>
      <button className="secondary-button" disabled={pending || recorder.isRecording} onClick={analyze}>{pending ? 'Analizando…' : 'Analizar y comparar con el ejemplo'}</button></>}
    {error && <p role="alert">{error}</p>}
    {result && <><p role="status">{result.recording.rms_dbfs < -45 ? 'La toma tiene un nivel muy bajo. Acerca el micrófono o selecciona otra entrada y repite.' : (result.recording.clipped_ratio || 0) >= .01 ? 'La señal está saturada. Reduce el volumen de entrada o aleja el micrófono.' : result.status==='unscorable' ? 'No se detectó suficiente voz estable. Escucha la toma, comprueba la entrada y repite.' : 'Comparación lista. Escucha ambas tomas y revisa las curvas.'}</p>
      <p className="text-sm">Nivel de tu toma: {result.recording.rms_dbfs} dBFS. Referencia: voz británica sintética, la misma del ejemplo de la ficha.</p>
      <ProsodyPanel result={result}/>
    </>}
    <p className="text-xs text-text-muted">Compara duración, altura relativa y señal de voz. La corrección de un fonema concreto aún requiere evaluación fonética validada. La toma se procesa en este equipo y no se conserva en el historial del laboratorio.</p>
  </section>;
}
