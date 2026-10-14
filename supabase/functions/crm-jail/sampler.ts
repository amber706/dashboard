// Deterministic sampling for CRM Jail audits.
//
// Seed is `${windowStart}:${zohoUserId}:${module}`, so re-running a week
// redraws the identical records. That reproducibility is what makes a finding
// defensible when a rep disputes it under policy OPS-CRM-001 §7.

/** FNV-1a. Small, fast, and stable across runtimes — the draw must match in Deno and Node. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** xorshift32. Deterministic by design — never use Math.random here. */
function makeRng(seed: string): () => number {
  let s = hashSeed(seed) || 0x2545f491;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/**
 * Seeded Fisher-Yates over a copy, returning the first `n`.
 *
 * Returns everything when the pool is smaller than `n`. The caller scores the
 * unused record columns N/A so they leave the denominator entirely — that is
 * how Kenny's Meetings section scored 3/9 rather than 3/45.
 */
export function sampleRecords<T>(pool: readonly T[], n: number, seed: string): T[] {
  const arr = pool.slice();
  const rng = makeRng(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(n, arr.length));
}

export function sampleSeed(windowStartISO: string, zohoUserId: string, module: string): string {
  return `${windowStartISO}:${zohoUserId}:${module}`;
}

const DAY_MS = 86_400_000;

function daysBefore(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Draw for sections sampled from everything the rep OWNS (BD Companies and
 * Business Contacts) rather than from what they touched in the window.
 *
 * Aaron, 2026-10-14: sample 5 regardless of activity, to see whether the
 * corrections a record draws are made and stay made — so the same record must
 * not come straight back. A record sampled in any of the previous 90 days is
 * held out. When that leaves fewer than `n`, records last sampled 30-90 days
 * ago fill the gap; nothing sampled in the last 30 days is ever redrawn.
 *
 * `history` maps record id -> the window_start it was last sampled in.
 * Samples from the current window are ignored, so re-running a week redraws
 * the identical records. The pool is sorted by id first: Zoho does not
 * guarantee row order, and the draw must not depend on it.
 */
export function sampleRotating<T extends { id?: unknown }>(
  pool: readonly T[],
  n: number,
  seed: string,
  history: ReadonlyMap<string, string>,
  windowStartISO: string,
): T[] {
  const sorted = pool.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const quarterAgo = daysBefore(windowStartISO, 90);
  const monthAgo = daysBefore(windowStartISO, 30);
  const last = (r: T) => {
    const w = history.get(String(r.id));
    return w && w < windowStartISO ? w : null;
  };
  const fresh = sorted.filter((r) => { const w = last(r); return !w || w < quarterAgo; });
  const drawn = sampleRecords(fresh, n, seed);
  if (drawn.length >= n) return drawn;
  const older = sorted.filter((r) => { const w = last(r); return !!w && w >= quarterAgo && w < monthAgo; });
  return [...drawn, ...sampleRecords(older, n - drawn.length, `${seed}:refill`)];
}
