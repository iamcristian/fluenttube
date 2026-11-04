import type { UseRecorderReturn } from '../hooks/useRecorder';
import { RefreshCw } from 'lucide-react';

export function MicrophoneControls({recorder,compact=false}:{recorder:UseRecorderReturn;compact?:boolean}) {
  const busy = ['recording','stopping','requesting_permission'].includes(recorder.state);
  return <div className={compact ? 'microphone-compact rounded border border-border p-2 text-xs' : 'space-y-2 rounded border border-border p-3 text-sm'} lang="es">
    <label className="block">Micrófono
      <select className="block w-full bg-surface p-2 mt-1" value={recorder.deviceId || ''} disabled={busy} onChange={e=>recorder.setDeviceId(e.target.value)}>
        <option value="">Predeterminado del sistema</option>
        {(recorder.devices || []).map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label || 'Micrófono '+(i+1)}</option>)}
      </select></label>
    <button className="quiet-button" title="Actualizar micrófonos" aria-label="Actualizar micrófonos" disabled={busy} onClick={()=>void recorder.refreshDevices()}>{compact ? <RefreshCw size={14}/> : 'Actualizar micrófonos'}</button>
    {!compact && <p className="text-xs text-text-muted">{recorder.activeMicrophone ? 'Última entrada utilizada: '+recorder.activeMicrophone : 'Al grabar, permite el acceso para ver los nombres de los dispositivos.'}</p>}
    {recorder.isRecording && <><label className="block">Nivel de entrada <meter aria-label="Nivel de entrada del micrófono" min="0" max="1" value={recorder.inputLevel || 0} className="w-full"/></label>
      <p role="status">Grabando · {recorder.durationSeconds.toFixed(1)} s · {(recorder.inputLevel || 0) > .02 ? 'Señal detectada' : 'Nivel bajo: habla cerca del micrófono y comprueba la entrada elegida.'}</p></>}
  </div>;
}
