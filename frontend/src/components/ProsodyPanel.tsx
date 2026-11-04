import { AcousticFeatures, ProsodyResult } from '../api/types';

export function Contour({ features, label }: { features: AcousticFeatures; label: string }) {
  // Shared scale preserves relative pitch range; gaps retain unvoiced regions.
  const points: string[] = [];
  let path = '';
  features.pitch_semitones.forEach((pitch, index) => {
    if (pitch === null) { if (path) points.push(path); path = ''; return; }
    const x = 12 + 476 * features.pitch_times_seconds[index] / features.duration_seconds;
    const y = 70 - Math.max(-18, Math.min(18, pitch)) * 3;
    path += `${path ? ' L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  if (path) points.push(path);
  return <figure className="pitch-contour space-y-2"><figcaption>{label} · {features.duration_seconds.toFixed(2)} s</figcaption>
    <svg viewBox="0 0 500 145" preserveAspectRatio="none" role="img" aria-label={`${label} relative pitch contour`} className="w-full bg-surface rounded">
      <path d="M12 70 H488" stroke="#64748b" strokeDasharray="4 4" />
      {points.map((data, index) => <path key={index} d={data} fill="none" stroke={['Reference','Original'].includes(label) ? '#2dd4bf' : '#fb7185'} strokeWidth="2" />)}
      <text x="14" y="140" fill="#94a3b8" fontSize="10">Time within this take · pitch relative to its median (±18 semitones)</text>
    </svg>
    <p className="text-xs">Pitch range {features.pitch_range_semitones === null ? 'unavailable' : features.pitch_range_semitones.toFixed(1) + ' st'} · voiced frames {Math.round(features.voiced_ratio * 100)}%</p>
    <p className="text-xs">Estimated pauses {features.pauses.length ? features.pauses.map(pause => `${pause.start_seconds.toFixed(2)}–${pause.end_seconds.toFixed(2)} s`).join(', ') : 'none detected'}</p>
  </figure>;
}

export function ProsodyPanel({ result }: { result: ProsodyResult }) {
  return <section aria-label="Prosody comparison" className="rounded-panel border border-border p-4 space-y-4">
    <h3 className="font-semibold">Prosody · experimental</h3>
    <p className="text-sm">Relative pitch and pauses for each take. Time axes follow each recording independently. Compare rises and falls within your comfortable voice range.</p>
    {result.reference && result.recording ? <div className="grid md:grid-cols-2 gap-4"><Contour label="Reference" features={result.reference} /><Contour label="Your recording" features={result.recording} /></div>
      : <p>Acoustic comparison unavailable for this attempt. You can listen and try again.</p>}
    <p className="text-xs text-text-muted">Status {result.status}. These measurements have no calibrated pronunciation grade. Multiple voices, music and pitch tracking errors may affect them.</p>
    {result.warning_codes.includes('LOW_TEXT_COVERAGE') && <p role="status">The words differ too much for a reliable prosody comparison. Practise the same sentence again.</p>}
  </section>;
}
