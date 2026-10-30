import type { Span } from './answer-key.ts';

// The text in lower case with each run of white space as one space. For each
// UTF-16 unit it keeps, the span of the original character, since spans count
// offsets in UTF-16 units.
function folded(text: string) {
  let value = '';
  const spans: Span[] = [];
  for (let index = 0; index < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(index)!);
    const space = /\s/u.test(character);
    if (!space || (value !== '' && !value.endsWith(' '))) {
      const kept = space ? ' ' : character.toLowerCase();
      value += kept;
      for (let unit = 0; unit < kept.length; unit++)
        spans.push({ start: index, end: index + character.length });
    }
    index += character.length;
  }
  return { value, spans };
}

// Where a quote occurs in the text, ignoring case and the kind and number of
// spaces: the page text writes headings in capitals, many pages use
// non-breaking spaces, and a model writes a line break as a space.
export function ground(text: string, quote: string | undefined): Span | null {
  const needle = folded(quote ?? '').value.trim();
  if (needle === '') return null;
  const page = folded(text);
  const at = page.value.indexOf(needle);
  if (at === -1) return null;
  return {
    start: page.spans[at]!.start,
    end: page.spans[at + needle.length - 1]!.end,
  };
}
