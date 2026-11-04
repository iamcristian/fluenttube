import { createContext } from 'react';

export interface WordReading { word: string; ipa: string }
export const OpenWordAtlas = createContext<((reading: WordReading) => void) | null>(null);

// Match whole chart entries first: /dʒ/, /iː/ and /aɪ/ are single choices.
// Keep unfamiliar symbols visible instead of substituting a different sound.
export function splitReading(ipa: string, inventory: string[]) {
  const symbols = [...inventory].sort((a,b) => b.length-a.length);
  let rest = ipa.normalize('NFC').replace(/^\/|\/$/g,'').replace(/g/g,'ɡ');
  const tokens: string[] = [];
  while (rest) {
    const token = symbols.find(s => s && rest.startsWith(s)) ?? Array.from(rest)[0];
    tokens.push(token);
    rest = rest.slice(token.length);
  }
  return tokens;
}
