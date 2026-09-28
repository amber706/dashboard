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
