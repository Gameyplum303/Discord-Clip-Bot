import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore, DEFAULTS } from '../src/config-store.js';

test('returns defaults for an unknown server and persists updates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipper-'));
  const file = path.join(dir, 'nested', 'config.json');
  const store = new ConfigStore(file);
  assert.deepEqual(store.get('g1'), DEFAULTS);

  store.update('g1', { triggers: ['clip'], channelId: '123' });
  const reloaded = new ConfigStore(file);
  assert.deepEqual(reloaded.get('g1').triggers, ['clip']);
  assert.equal(reloaded.get('g1').channelId, '123');
  assert.equal(reloaded.get('g1').beforeSec, 10);
  assert.deepEqual(reloaded.get('g2'), DEFAULTS);
});
