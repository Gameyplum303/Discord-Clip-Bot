import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClipLibrary } from '../src/clip-library.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clips-'));

function makeLibrary() {
  const root = tmp();
  return { root, lib: new ClipLibrary({ dir: path.join(root, 'clips'), indexPath: path.join(root, 'data', 'clips.json') }) };
}

test('adds, lists newest first, reads and persists clips', () => {
  const { root, lib } = makeLibrary();
  lib.add({ id: lib.newId(), guildId: 'g', createdAt: 1 }, Buffer.from('one'));
  const b = lib.add({ id: lib.newId(), guildId: 'g', createdAt: 2 }, Buffer.from('two'));
  lib.add({ id: lib.newId(), guildId: 'other', createdAt: 3 }, Buffer.from('x'));
  assert.deepEqual(lib.list('g').map((c) => c.createdAt), [2, 1]);
  assert.equal(lib.read(b).toString(), 'two');

  const reloaded = new ClipLibrary({ dir: path.join(root, 'clips'), indexPath: path.join(root, 'data', 'clips.json') });
  assert.equal(reloaded.list('g').length, 2);
  assert.equal(reloaded.get('other', b.id), null, 'clips are scoped to their server');
});

test('enforces max clips and max age, deleting only indexed files', () => {
  const { root, lib } = makeLibrary();
  const day = 24 * 60 * 60 * 1000;
  const now = 100 * day;
  for (let i = 0; i < 5; i++) lib.add({ id: lib.newId(), guildId: 'g', createdAt: now - i * day }, Buffer.from(String(i)));
  fs.writeFileSync(path.join(root, 'clips', 'not-ours.mp3'), 'keep');

  assert.deepEqual(lib.enforceLimits('g', { maxClips: 0, maxDays: 0 }, now), []);
  assert.equal(lib.enforceLimits('g', { maxDays: 2 }, now).length, 2); // 3 and 4 days old
  assert.equal(lib.enforceLimits('g', { maxClips: 1 }, now).length, 2);
  assert.equal(lib.list('g').length, 1);
  assert.deepEqual(fs.readdirSync(path.join(root, 'clips')).sort(), [lib.list('g')[0].file, 'not-ours.mp3'].sort());
});

test('refuses paths outside the clips folder', () => {
  const { lib } = makeLibrary();
  assert.throws(() => lib.filePath('../data/clips.json'));
  assert.throws(() => lib.filePath('/etc/passwd'));
  assert.equal(ClipLibrary.isValidId('deadbeef'), true);
  assert.equal(ClipLibrary.isValidId('../x'), false);
});

test('replacing audio swaps the file and removes the old one', () => {
  const { root, lib } = makeLibrary();
  const clip = lib.add({ id: lib.newId(), guildId: 'g' }, Buffer.from('long'));
  const oldFile = clip.file;
  lib.replaceAudio(clip, Buffer.from('short'), 5);
  assert.equal(lib.read(clip).toString(), 'short');
  assert.equal(clip.durationSec, 5);
  assert.equal(fs.existsSync(path.join(root, 'clips', oldFile)), false);
  lib.remove(clip);
  assert.equal(lib.list('g').length, 0);
});
