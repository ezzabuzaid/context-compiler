import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ground } from './ground.ts';

// Built from its code point, so a reader sees where the text has one.
const nbsp = String.fromCodePoint(0xa0);

test('a quote that the text does not have, or a quote of only white space, is in no text', () => {
  const text =
    'Access discounts and credits worth up to $45,000 from companies building with Claude.';

  const invented = ground(text, 'Get up to $100,000 in free credits.');
  const blank = ground(text, ` \n${nbsp}\t `);

  assert.equal(invented, null);
  assert.equal(blank, null);
});

test('a quote that writes the case and the white space of the text in its own way is found, and its span gives the words as the text writes them', () => {
  const text = `Programs\n\nMICROSOFT FOR STARTUPS\n\nAccess cutting-edge AI models and up to${nbsp}$150,000   in credits,\nbacked by Microsoft.\n\nApply now`;

  const span = ground(
    text,
    '  Microsoft for Startups Access cutting-edge AI models and up to $150,000 in credits, backed by Microsoft.\n',
  );

  assert.notEqual(span, null);
  assert.equal(
    text.slice(span!.start, span!.end),
    `MICROSOFT FOR STARTUPS\n\nAccess cutting-edge AI models and up to${nbsp}$150,000   in credits,\nbacked by Microsoft.`,
  );
});

test('characters that take two UTF-16 units, before the quote or at its end, or whose lower case is longer, leave its span on the words as the text writes them', () => {
  // An emoji is two UTF-16 units, and the lower case of İ is two characters.
  const text =
    '🚀 İSTANBUL founders 🚀 get up to $25,000 in credits 🚀 for their startup.';

  const span = ground(text, 'Get up to $25,000 in credits 🚀');

  assert.notEqual(span, null);
  assert.equal(
    text.slice(span!.start, span!.end),
    'get up to $25,000 in credits 🚀',
  );
});
