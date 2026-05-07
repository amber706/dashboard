// Saved Views — durable storage of named filter combos for /bd.
//
// Phase 3 starts in localStorage so we don't need a Supabase migration
// to ship. The shape is namespaced under a single key so a future
// "promote to bd_saved_views table" migration can copy values straight
// across without conflicting with other localStorage keys.
//
// A view captures everything that controls what /bd shows:
//   - window preset (Today / WTD / MTD / Last 24h / 7d / 30d / 90d / YTD / custom)
//   - custom range start/end (only used when preset is "custom")
//   - pipeline group multiselect (DUI / DV / Commercial / AHCCCS)
//   - rep multiselect (BD_Rep picklist values; e.g. "Joey", "Casey")
//
// Versioned so future shape changes can do a one-pass migration on read.

const STORAGE_KEY = "bd_saved_views_v1";

export interface BdSavedView {
  id: string;                          // generated, stable across loads
  name: string;                        // user-supplied label
  createdAt: string;                   // ISO
  preset: string;                      // matches WindowPreset on dashboard
  customStart?: string;                // YYYY-MM-DD
  customEnd?: string;                  // YYYY-MM-DD
  pipelines: string[];                 // PipelineGroup[]
  reps: string[];                      // BD_Rep picklist values
}

interface Stored { version: 1; views: BdSavedView[] }

function read(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, views: [] };
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.views)) return parsed as Stored;
    return { version: 1, views: [] };
  } catch {
    return { version: 1, views: [] };
  }
}

function write(stored: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // localStorage may be unavailable (private mode, quota, etc.) —
    // saved views are best-effort, never block the dashboard.
  }
}

export function loadSavedViews(): BdSavedView[] {
  return read().views.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export function saveView(input: Omit<BdSavedView, "id" | "createdAt">): BdSavedView {
  const stored = read();
  // If the caller picks a name that collides with an existing view, we
  // overwrite — most users expect "Save" on an existing name to update.
  const existing = stored.views.find((v) => v.name.trim().toLowerCase() === input.name.trim().toLowerCase());
  const view: BdSavedView = {
    ...input,
    id: existing?.id ?? cryptoId(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const next = stored.views.filter((v) => v.id !== view.id).concat(view);
  write({ version: 1, views: next });
  return view;
}

export function deleteView(id: string): void {
  const stored = read();
  write({ version: 1, views: stored.views.filter((v) => v.id !== id) });
}

function cryptoId(): string {
  // Cheap UUID-ish string. crypto.randomUUID is widely available; fall
  // back to a timestamp+random pair if not (e.g. ancient Safari).
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* ignored */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
