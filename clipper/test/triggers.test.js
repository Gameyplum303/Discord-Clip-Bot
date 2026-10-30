import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTrigger, normalizePhrase } from '../src/triggers.js';

const words = (...list) => list.map(([word, start]) => ({ word, start, end: start + 0.3 }));

test('normalizes case, punctuation and accents', () => {
  assert.equal(normalizePhrase('  Clip IT!! '), 'clip it');
  assert.equal(normalizePhrase("Don't"), 'dont');
  assert.equal(normalizePhrase('Café'), 'cafe');
});

test('finds a single word with Whisper punctuation and spacing', () => {
  const hit = findTrigger(words([' Oh', 0.1], [' clip,', 0.5], [' that!', 0.9]), ['clip']);
  assert.deepEqual(hit, { trigger: 'clip', start: 0.5, end: 0.8 });
});

test('finds a multi-word phrase', () => {
  const hit = findTrigger(words([' oh', 0.1], [' my', 0.4], [' god', 0.7]), ['oh my god']);
  assert.equal(hit.start, 0.1);
  assert.equal(hit.trigger, 'oh my god');
});

test('does not match inside a longer word', () => {
  assert.equal(findTrigger(words([' clipboard', 0.1]), ['clip']), null);
});

test('returns the earliest of several triggers', () => {
  const hit = findTrigger(words([' wow', 0.2], [' clip', 1.5]), ['clip', 'wow']);
  assert.equal(hit.trigger, 'wow');
});

test('fuzzy matching is off by default', () => {
  assert.equal(findTrigger(words([' clipp', 0.1]), ['clip']), null);
});

test('fuzzy matching accepts near misses and merged words', () => {
  assert.equal(findTrigger(words([' bookmarc', 0.1]), ['bookmark'], { fuzzy: true }).trigger, 'bookmark');
  const merged = findTrigger(words([' wow', 0.1], [' clipthat', 0.6]), ['clip that'], { fuzzy: true });
  assert.equal(merged.start, 0.6);
  const split = findTrigger(words([' book', 0.2], [' mark', 0.5]), ['bookmark'], { fuzzy: true });
  assert.equal(split.start, 0.2);
});

test('fuzzy matching stays strict for short words and different first letters', () => {
  assert.equal(findTrigger(words([' cap', 0.1]), ['clp'], { fuzzy: true }), null);
  assert.equal(findTrigger(words([' slip', 0.1]), ['clip'], { fuzzy: true }), null);
  assert.equal(findTrigger(words([' clap', 0.1]), ['clip'], { fuzzy: true }).trigger, 'clip');
});
