import { useId } from 'react';

type Point = [number, number];
type Place = 'bilabial' | 'labiodental' | 'dental' | 'alveolar' | 'postalveolar' | 'palatal' | 'velar' | 'glottal' | 'labiovelar';
type Manner = 'stop' | 'fricative' | 'affricate' | 'nasal' | 'lateral' | 'approximant';
export type Diagram =
  | { kind: 'vowel'; points: Point[]; lips: string }
  | { kind: 'consonant'; place: Place; manner: Manner; voiced: boolean }
  | { kind: 'notation'; focus: number; syllables: string[] };

const places: Record<Place, [number, number, string]> = {
  bilabial: [46, 115, 'Ambos labios'], labiodental: [69, 111, 'Incisivos y labio inferior'],
  dental: [78, 106, 'Lengua e incisivos'], alveolar: [103, 87, 'Cresta alveolar'],
  postalveolar: [126, 75, 'Detrás de los alvéolos'], palatal: [161, 62, 'Paladar duro'],
  velar: [219, 76, 'Velo del paladar'], glottal: [244, 172, 'Glotis'],
  labiovelar: [222, 79, 'Dorso y labios'],
};
const manners: Record<Manner, string> = {
  stop: 'Cierre → liberación', fricative: 'Rendija · fricción continua', affricate: 'Cierre → fricción',
  nasal: 'Cierre oral · salida nasal', lateral: 'Centro cerrado · salida lateral', approximant: 'Paso estrecho sin fricción',
};
const lipLabels: Record<string, string> = { round: 'Redondeados', spread: 'Extendidos', relaxed: 'Relajados', 'to-round': 'Se redondean', 'round-open': 'Pierden redondeamiento' };

function VowelView({ model, ipa, progress }: { model: Extract<Diagram, {kind:'vowel'}>; ipa: string; progress: number }) {
  const project = ([front, open]: Point): Point => [44 + 64 * open + (178 - 64 * open) * front, 51 + 104 * open];
  const [start, end] = model.points.map(project);
  const p = end ? [start[0] + (end[0]-start[0])*progress, start[1]+(end[1]-start[1])*progress] : start;
  const round = model.lips === 'round' ? 1 : model.lips === 'to-round' ? progress : model.lips === 'round-open' ? 1-progress : 0;
  const lipWidth = 35 - 18*round;
  const aperture = 4 + 9*model.points[0][1] + round*4;
  const arrow = useId();
  // In this sagittal inset the incisors face left (front) and the pharynx right.
  const [a, b = a] = model.points;
  const front = a[0] + (b[0]-a[0])*progress;
  const height = a[1] + (b[1]-a[1])*progress;
  const crestX = 109 + 71*front;
  const crestY = 66 + 38*height;
  return <svg viewBox="0 0 370 365" role="img" aria-label={`Mapa vocálico de /${ipa}/. ${lipLabels[model.lips]}.`}>
    <defs><marker id={arrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L8 4L0 8" fill="var(--color-accent)"/></marker></defs>
    <text x="15" y="20" className="plate-kicker">CORTE LATERAL · FRENTE A LA IZQUIERDA</text>
    <path d="M49 93 Q53 54 93 39 Q149 21 188 39 Q214 47 224 66 Q248 80 246 147 L231 147 Q237 102 212 80 Q196 58 169 52 Q126 45 97 61 L73 83 L64 94Z" fill="#41535d" stroke="#a4b3b7"/>
    <path d="M61 87 L75 82 L72 98 L64 101Z" fill="#e5e1cb"/>
    <path d={`M56 ${108+height*11} Q84 ${139+height*12} 145 142 Q195 144 218 152 L203 161 Q101 158 66 138Z`} fill="#926e70" stroke="#c59a94"/>
    <path d={`M76 121 Q91 120 ${crestX-25} ${crestY+20} Q${crestX} ${crestY-12} ${crestX+27} ${crestY+13} Q210 105 223 142 L210 149 Q172 128 133 139 Q96 143 76 121Z`} fill="#b77d80" stroke="#f1b3ad" strokeWidth="1.6"/>
    <circle cx={crestX} cy={crestY+3} r="4" fill="var(--color-accent)"/><path d={`M${crestX+4} ${crestY+3} H250`} stroke="var(--color-accent)" strokeDasharray="3 3"/>
    <text x="254" y={crestY+6} className="plate-label">Dorso lingual</text>
    <g transform="translate(0 162)">
    <text x="15" y="20" className="plate-kicker">MAPA VOCÁLICO</text>
    <path d="M44 51H222V155H108Z" fill="var(--color-bg-surface)" stroke="#65808b"/>
    <path d="M65 86H222 M87 120H222 M133 51L165 155" stroke="#425760" strokeDasharray="3 4"/>
    <g className="plate-label"><text x="35" y="42">Anterior</text><text x="194" y="42">Posterior</text><text x="16" y="68">Alta</text><text x="61" y="159">Baja</text></g>
    {end && <><path d={`M${start} L${end}`} stroke="var(--color-accent)" strokeWidth="3" markerEnd={`url(#${arrow})`}/><circle cx={start[0]} cy={start[1]} r="4" fill="#a8c1c8"/></>}
    <circle cx={p[0]} cy={p[1]} r="7" fill="var(--color-accent)" stroke="#101c24" strokeWidth="2"/>
    <path d="M243 35V164" stroke="#354851"/><text x="260" y="42" className="plate-label">Labios · frente</text>
    <path d={`M${307-lipWidth-6} 98 Q286 80 300 84 Q306 88 312 84 Q330 80 ${307+lipWidth+6} 98 Q311 128 ${307-lipWidth-6} 98Z`} fill="#ac7273" stroke="#efb3a7"/>
    <ellipse cx="307" cy="99" rx={lipWidth} ry={aperture} fill="#19232a" stroke="#e9b2a5"/>
    <text x="306" y="149" textAnchor="middle" className="plate-label">{lipLabels[model.lips]}</text>
    <text x="15" y="190" className="plate-label">{end ? 'La flecha une los objetivos dentro de una sílaba.' : 'El punto indica una posición vocálica aproximada.'}</text>
    </g>
  </svg>;
}

function ConsonantView({ model, progress }: { model: Extract<Diagram,{kind:'consonant'}>; progress: number }) {
  const {place, manner, voiced} = model;
  const [x,y,label] = places[place];
  const nasal = manner === 'nasal';
  const closed = nasal || manner === 'stop' || manner === 'lateral' || manner === 'affricate';
  const release = (manner === 'stop' || manner === 'affricate') && progress > .55 ? 10 : 0;
  const gap = (closed ? 0 : manner === 'fricative' ? 4 : 10) + release;
  const tipTarget = ['dental','alveolar','postalveolar'].includes(place);
  const backTarget = ['palatal','velar','labiovelar'].includes(place);
  const tongue = backTarget
    ? `M84 138 Q103 145 133 113 C151 92 ${x-12} ${y+gap} ${x} ${y+gap} Q258 91 250 159 L234 177 Q198 135 160 149 Q111 161 84 138Z`
    : tipTarget ? `M${x} ${y+gap} Q${x+15} ${y+gap+2} 146 111 Q199 81 234 115 Q252 138 247 169 L231 177 Q205 140 164 149 Q113 161 ${x} ${y+gap}Z`
    : 'M85 137 Q119 128 148 117 Q200 84 231 117 Q248 137 245 168 L231 177 Q205 143 163 150 Q112 156 85 137Z';
  const lowerLip = place === 'labiodental' ? [69,113] : place === 'bilabial' ? [46,115+release] : place === 'labiovelar' ? [37,127] : [49,134];
  return <svg viewBox="0 0 370 224" role="img" aria-label={`${label}. ${manners[manner]}. ${voiced ? 'Sonora' : 'Sorda'}.`}>
    <text x="15" y="19" className="plate-kicker">CORTE LATERAL · FRENTE A LA IZQUIERDA</text>
    <path d="M39 94 Q47 85 52 69 Q72 33 134 32 Q206 26 234 56 L254 83 Q275 122 267 184 L246 184 Q253 139 237 105 Q235 84 220 77 Q194 63 163 62 Q130 66 104 87 Q90 87 79 97 L73 102 L57 103 Q45 105 46 115 Q33 114 39 106Z" fill="#41535d" stroke="#9cacb0" strokeWidth="1.5"/>
    <path d="M54 78 Q89 42 158 43 Q218 40 239 75 Q217 60 166 54 Q108 51 74 78Z" fill="#1e343f" stroke="#82959a"/>
    <path d="M62 98L79 96L76 112L68 113Z M76 137L81 122L89 121L88 139Z" fill="#e5e1cb" stroke="#c2bdaa"/>
    <path d={`M${lowerLip} Q62 124 77 139 Q105 151 155 159 Q200 158 226 183 L213 198 Q180 174 133 176 Q81 170 56 150 Q34 147 ${lowerLip}Z`} fill="#946e71" stroke="#daa29b" strokeWidth="1.5"/>
    <path d={tongue} fill="#b77d80" stroke="#f1b3ad" strokeWidth="1.5"/>
    <path d="M221 77Q237 79 238 95" fill="none" stroke="#c49b96" strokeWidth="7" strokeLinecap="round" transform={nasal ? 'rotate(20 221 77)' : undefined}/>
    {nasal && <path d="M245 146Q261 84 228 66Q167 26 64 75L53 79" fill="none" stroke="#78dccd" strokeWidth="3" strokeDasharray="5 3"/>}
    {place === 'labiovelar' && <circle cx="43" cy="120" r="11" fill="none" stroke="var(--color-accent)" strokeDasharray="3 2"/>}
    <circle cx={x} cy={y} r="9" fill="none" stroke="var(--color-accent)" strokeWidth="2"/>
    <path d={`M${x} ${y-10} L${x+15} ${y-24} H270`} fill="none" stroke="#72b8ae" strokeWidth="1"/>
    <path d="M277 38V185" stroke="#354851"/><text x="288" y="54" className="plate-label">Laringe</text>
    <path d={voiced ? 'M287 83h5l4-11 5 22 5-22 5 22 5-22 5 22 5-22 5 22 4-11h15' : 'M287 83h68'} fill="none" stroke="#efbe75" strokeWidth="2.5"/>
    <text x="288" y="108" className="plate-label">{voiced ? 'Sonora' : 'Sorda'}</text>
    <text x="288" y="143" className="plate-label">Paso de aire</text><text x="288" y="163" className="plate-label">{nasal ? 'Nasal' : manner === 'lateral' ? 'Lateral' : 'Oral'}</text>
    <text x="15" y="215" className="plate-label">{label} · {manners[manner]}</text>
  </svg>;
}

export function ArticulationPlate({model, ipa, progress}: {model: Diagram; ipa: string; progress: number}) {
  return <figure className="articulation-plate">
    <figcaption><span>PHONETICS ATLAS</span><strong>{ipa}</strong></figcaption>
    {model.kind === 'vowel' ? <VowelView model={model} ipa={ipa} progress={progress}/>
      : model.kind === 'consonant' ? <ConsonantView model={model} progress={progress}/>
      : <div className="notation-plate" aria-label="Transcripción por sílabas">{model.syllables.map((s,i) =>
        <div key={i} className={i===model.focus ? 'notation-focus' : ''}><small>SÍLABA {i+1}</small><b>{s.split(ipa).map((part,n) => <span key={n}>{n>0 && <mark>{ipa}</mark>}{part}</span>)}</b></div>)}</div>}
  </figure>;
}
