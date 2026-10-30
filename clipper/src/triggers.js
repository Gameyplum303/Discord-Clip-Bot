// Trigger phrase normalisation and matching against Whisper word timestamps.

export function normalizeTokens(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function normalizePhrase(text) {
  return normalizeTokens(text).join(' ');
}

// words: [{ word, start, end }] from the STT worker (seconds).
// triggers: normalised phrases, e.g. ["clip", "oh my god"].
// Returns the earliest hit as { trigger, start, end } or null.
export function findTrigger(words, triggers) {
  const tokens = [];
  for (const w of words) {
    for (const t of normalizeTokens(w.word)) tokens.push({ t, start: w.start, end: w.end });
  }

  let best = null;
  for (const trigger of triggers) {
    const parts = trigger.split(' ');
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      if (!parts.every((p, j) => tokens[i + j].t === p)) continue;
      if (!best || tokens[i].start < best.start) {
        best = { trigger, start: tokens[i].start, end: tokens[i + parts.length - 1].end };
      }
      break;
    }
  }
  return best;
}
