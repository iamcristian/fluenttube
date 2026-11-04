import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

export function SentenceIpa({ segmentId, text }: { segmentId: number; text: string }) {
  const sentenceKey = `${segmentId}:${text}`;
  const [choices, setChoices] = useState<Record<string, Record<number, number>>>({});
  const [opened, setOpened] = useState<{ sentenceKey: string; index: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sentence-ipa', segmentId, text],
    queryFn: () => apiClient.getSentenceIpa(segmentId),
    staleTime: Infinity,
    retry: false,
  });
  const activeIndex = opened?.sentenceKey === sentenceKey ? opened.index : null;
  const activeWord = activeIndex != null ? data?.words[activeIndex] : undefined;
  const selected = choices[sentenceKey] ?? {};
  const close = () => { setOpened(null); triggerRef.current?.focus(); };

  useEffect(() => {
    if (activeIndex == null) return;
    selectRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpened(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpened(null); triggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [activeIndex, sentenceKey]);

  return <div ref={rootRef} className="mt-2 space-y-1" aria-label="British IPA practice guide">
    <p className="text-xs font-semibold text-accent">British IPA · practice guide</p>
    {isLoading && <p className="text-xs text-text-secondary">Preparing pronunciation…</p>}
    {isError && <button className="quiet-button text-xs" onClick={() => refetch()}>Retry pronunciation guide</button>}
    {data && <>
      <p className="text-base leading-relaxed text-accent font-mono break-words" aria-label="Sentence pronunciation">
        /{data.words.map((word, index) => {
          const reading = word.readings[selected[index] ?? 0] ?? word.readings[0];
          const ipa = reading?.replace(/^\/|\/$/g, '');
          return <span key={index}>
            {index > 0 ? ' ' : ''}{word.readings.length > 1 ? <button
              type="button" aria-label={`Choose pronunciation for ${word.text}`}
              aria-expanded={activeIndex === index}
              className="!min-h-0 inline p-0 border-0 bg-transparent text-inherit font-inherit leading-inherit underline decoration-dotted underline-offset-4 hover:decoration-solid"
              title={`${word.text} · choose pronunciation`}
              onClick={event => {
                triggerRef.current = event.currentTarget;
                setOpened(activeIndex === index ? null : { sentenceKey, index });
              }}
            >{ipa}</button> : <span title={word.text}>{ipa ?? `[${word.text}]`}</span>}
          </span>;
        })}/
      </p>
      {activeWord && activeIndex != null && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2" role="group" aria-label="Pronunciation choices">
        <label htmlFor={`ipa-variant-${segmentId}`} className="text-xs text-text-secondary">Pronunciation for “{activeWord.text}”</label>
        <select ref={selectRef} id={`ipa-variant-${segmentId}`} className="bg-background text-accent border border-border rounded px-2 py-1 font-mono" value={selected[activeIndex] ?? 0}
          onChange={event => {
            const choice = Number(event.target.value);
            setChoices(previous => ({ ...previous, [sentenceKey]: { ...previous[sentenceKey], [activeIndex]: choice } }));
            close();
          }}>
          {activeWord.readings.map((ipa, index) => <option key={index} value={index}>{ipa}</option>)}
        </select>
        <button type="button" onClick={close} className="quiet-button text-xs">Done</button>
      </div>}
      {data.words.some(word => !word.readings.length) && <p className="text-xs text-text-secondary">Words in brackets have no available IPA.</p>}
    </>}
  </div>;
}
