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
// fuzzy: also accept near misses, e.g. Whisper writing "clipp" or "clip that" as "clipthat".
// Returns the earliest hit as { trigger, start, end } or null.
export function findTrigger(words, triggers, { fuzzy = false } = {}) {
  const tokens = [];
  for (const w of words) {
    for (const t of normalizeTokens(w.word)) tokens.push({ t, start: w.start, end: w.end });
  }

  let best = null;
  const consider = (trigger, i, n) => {
    if (!best || tokens[i].start < best.start) {
      best = { trigger, start: tokens[i].start, end: tokens[i + n - 1].end };
    }
  };

  for (const trigger of triggers) {
    const parts = trigger.split(' ');
    let found = false;
    for (let i = 0; i + parts.length <= tokens.length && !found; i++) {
      if (parts.every((p, j) => tokens[i + j].t === p)) {
        consider(trigger, i, parts.length);
        found = true;
      }
    }
    if (found || !fuzzy) continue;

    const target = parts.join('');
    const allowed = maxEdits(target.length);
    if (!allowed) continue;
    // Try runs of tokens around the phrase's own word count, so split or merged words still match.
    for (let i = 0; i < tokens.length && !found; i++) {
      for (let n = Math.max(1, parts.length - 1); n <= parts.length + 1 && i + n <= tokens.length; n++) {
        const candidate = tokens.slice(i, i + n).map((t) => t.t).join('');
        if (candidate[0] !== target[0]) continue;
        if (editDistance(candidate, target, allowed) <= allowed) {
          consider(trigger, i, n);
          found = true;
          break;
        }
      }
    }
  }
  return best;
}

// Short triggers must match exactly; longer ones may be off by a letter or two.
function maxEdits(length) {
  if (length <= 3) return 0;
  if (length <= 7) return 1;
  return 2;
}

// Levenshtein distance, giving up early once it exceeds `limit`.
export function editDistance(a, b, limit = Infinity) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}
