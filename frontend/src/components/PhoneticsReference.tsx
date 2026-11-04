import { useState } from 'react';

const checks = [
  { question:'¿Qué señala ˈ en /bəˈnɑːnə/?', choices:['La sílaba siguiente lleva el acento principal','La vocal anterior es larga'], correct:0, lesson:'primary', tip:'La marca va antes de la sílaba acentuada: NA en banana.' },
  { question:'Al pasar de fan a van, ¿qué cambia principalmente?', choices:['El punto de contacto','La vibración laríngea'], correct:1, lesson:'v', tip:'Mantén los incisivos cerca del labio inferior y añade voz para /v/.' },
  { question:'¿Qué ocurre dentro de la vocal de light?', choices:['Se desliza hacia una posición más alta y anterior','La lengua permanece en la misma posición'], correct:0, lesson:'price', tip:'El movimiento de /aɪ/ ocurre dentro de una sola sílaba.' },
];

export function PhoneticsReference({disabled,onPractice}:{disabled:boolean;onPractice:(id:string)=>void}) {
  const [answers,setAnswers] = useState<Record<number,number>>({});
  return <details className="rounded-panel border border-border p-4" lang="es"><summary className="cursor-pointer font-semibold">Guía de consulta y diagnóstico inicial</summary>
    <div className="mt-4 space-y-4 text-sm">
      <section><h3>E1 · Cómo leer la tabla</h3><p>Las barras indican fonemas: /ʃ/ es el primer sonido de ship. Los corchetes muestran cómo se realiza un sonido: [pʰ] incluye el soplo de pin. ˈ y ˌ van antes de la sílaba acentuada; ː va después de la vocal larga.</p></section>
      <section><h3>E2 · Encuentra un punto de partida</h3><p>Estas tres preguntas orientan tu práctica de conceptos; no evalúan tu voz.</p>
        {checks.map((c,i)=><div key={c.lesson} className="mt-3"><p>{c.question}</p><div className="flex flex-wrap gap-2 my-1">{c.choices.map((s,j)=><button key={s} className="secondary-button" aria-pressed={answers[i]===j} onClick={()=>setAnswers(a=>({...a,[i]:j}))}>{s}</button>)}</div>
          {answers[i]!==undefined && <p role="status">{answers[i]===c.correct ? 'Correcto. ' : 'Fíjate en esto: '}{c.tip} <button className="quiet-button" disabled={disabled} onClick={()=>onPractice(c.lesson)}>Abrir ficha</button></p>}</div>)}</section>
      <section><h3>E3 · Si hablas español</h3><p>Si oyes lo mismo en ship y sheep, alterna las dos fichas y escucha el cambio de calidad. Si añades una vocal antes de stop, ensaya primero /s/ y enlázala con /t/. Elige solo la dificultad que reconozcas en tu propia voz.</p></section>
      <section><h3>E4 · Contrastes y variantes</h3><p>La tabla toma como referencia el inglés del sur de Gran Bretaña. NEAR, SQUARE y CURE pueden variar entre hablantes; una transcripción tradicional no obliga a todos a producir el mismo deslizamiento. Consulta también el <a className="underline" href="https://www.internationalphoneticassociation.org/content/ipa-chart" target="_blank" rel="noreferrer">cuadro de la Asociación Fonética Internacional</a> para situar los símbolos.</p></section>
      <section><h3>E5 · Ortografía y sonido</h3><p>La secuencia ea se oye de formas distintas en sea y head. A la inversa, see y sea se pronuncian igual en esta variedad. Consulta la palabra completa antes de generalizar una regla.</p></section>
      <section><h3>E6 · Glosario · edición 1</h3><dl><dt>Par mínimo</dt><dd>Dos palabras que se distinguen por un solo fonema, como fan y van.</dd><dt>Sonoridad</dt><dd>Vibración de los pliegues vocales durante una articulación.</dd><dt>Acento léxico</dt><dd>Prominencia relativa de una sílaba dentro de una palabra.</dd><dt>Entonación</dt><dd>Movimiento de la altura de la voz a lo largo de un enunciado.</dd></dl></section>
    </div></details>;
}
