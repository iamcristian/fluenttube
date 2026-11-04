import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause } from 'lucide-react';
import type { AcousticFeatures } from '../api/types';
import { Contour } from './ProsodyPanel';
import { apiClient } from '../api/client';

export function OriginalWaveform({segmentId,features,paused,disabled,onPlay,onFallback}:{segmentId:number;features?:AcousticFeatures;paused:boolean;disabled:boolean;onPlay:()=>void;onFallback?:()=>void}) {
  const container=useRef<HTMLDivElement>(null);
  const player=useRef<WaveSurfer>();
  const [playing,setPlaying]=useState(false);
  const [error,setError]=useState(false);
  const [ready,setReady]=useState(false);
  // Build the URL through the same configured API base as every media request.
  useEffect(()=>{
    let active=true;
    let ws:WaveSurfer|undefined;
    setError(false);setReady(false);setPlaying(false);
    if (!container.current) return;
    try {
      ws=WaveSurfer.create({container:container.current,url:apiClient.getReferenceAudioUrl(segmentId),waveColor:'#64748b',progressColor:'#2dd4bf',cursorColor:'#f8fafc',barWidth:2,barGap:1,barRadius:2,height:32});
      player.current=ws;
      ws.on('ready',()=>{if(active)setReady(true);});
      ws.on('error',()=>{if(active)setError(true);});
      ws.on('play',()=>{if(active){setPlaying(true);onPlay();}});
      ws.on('pause',()=>{if(active)setPlaying(false);});
      ws.on('finish',()=>{if(active)setPlaying(false);});
    } catch {if(active)setError(true);}
    return ()=>{active=false;ws?.destroy();player.current=undefined;};
  },[segmentId]); // Audio identity is the sentence, never the student's take.
  useEffect(()=>{if(paused)player.current?.pause?.();},[paused]);
  return <section aria-label="Original audio diagram" className="p-3 rounded bg-background/80 border border-border/70 space-y-2">
    <div className="flex items-center justify-between"><span className="text-xs font-semibold">Original · audio del vídeo</span>
      <button className="p-1 rounded border border-border text-accent" aria-label={playing?'Pause original waveform':'Play original waveform'} disabled={disabled||(!ready&&!error)} onClick={()=>{if(error){onFallback?.();return;}void Promise.resolve(player.current?.playPause()).catch(()=>setError(true));}}>
        {playing?<Pause size={16}/>:<Play size={16}/>}</button></div>
    <div ref={container} className="min-h-[32px]"/>
    {!ready&&!error&&<p className="text-xs text-text-muted">Preparando el audio original…</p>}
    {error&&<p role="status" className="text-xs">No se pudo dibujar el original. Puedes escucharlo desde el vídeo.</p>}
    {features&&<Contour features={features} label="Original"/>}
  </section>;
}
