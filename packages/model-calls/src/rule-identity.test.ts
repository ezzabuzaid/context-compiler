import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ruleIdentity } from './rule-identity.ts';

test('the identity of a rule is its model id and the SHA-256 of the JSON of what it sends, or the first digits of that hash', () => {
  const sent = { system: 's', schema: { type: 'object' } };

  const full = ruleIdentity('gpt-6-luna', sent);
  const short = ruleIdentity('typesafe/jev-1.14', sent, { digits: 16 });

  // sha256 of {"system":"s","schema":{"type":"object"}}, from Node's
  // createHash at the time of writing.
  assert.equal(
    full,
    'gpt-6-luna:46ac6d9d0f0a00322b5f2812a95a3122021a106fd039537811192cb0b99848db',
  );
  assert.equal(short, 'typesafe/jev-1.14:46ac6d9d0f0a0032');
});
