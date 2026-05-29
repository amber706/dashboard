// SavedViewsControl — dropdown + "Save current" button that pairs with the
// FilterBar. Stores named FilterContract presets per (user, page_key).
//
// UX:
//   - When no saves exist, only "Save current view…" shows.
//   - When saves exist, picking one applies its filters and replaces the
//     current selection. A small × next to each entry deletes it (with
//     a confirm).
//   - "Save current view…" prompts for a name; saving with an existing
//     name overwrites (server-side upsert).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Bookmark, Save, X, ChevronDown } from "lucide-react";
import {
  useSavedViews,
} from "@/features/op-reporting/hooks/useSavedViews";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

interface SavedViewsControlProps {
  pageKey: string;
  filters: FilterContract;
  onApply: (filters: FilterContract) => void;
}

export function SavedViewsControl({ pageKey, filters, onApply }: SavedViewsControlProps) {
  const { list, upsert, remove } = useSavedViews(pageKey);
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await upsert.mutateAsync({ name: trimmed, filters });
      setName("");
      setSaveOpen(false);
    } catch {
      // mutation surfaces error via list query refetch; toast wiring can come later
    }
  };

  return (
    <div className="flex items-center gap-1">
      {/* List + apply */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2">
            <Bookmark className="h-3.5 w-3.5" />
            <span className="text-sm">Saved views</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-2">
          <div className="px-2 pb-2 border-b text-xs font-medium text-muted-foreground">
            Your saved views
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {list.isLoading ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">Loading…</div>
            ) : !list.data || list.data.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                No saved views yet. Use "Save current…" below.
              </div>
            ) : (
              list.data.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted group"
                >
                  <button
                    className="text-left text-sm flex-1 truncate"
                    onClick={() => {
                      onApply(v.filters);
                      setOpen(false);
                    }}
                  >
                    {v.name}
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 -mr-1 rounded hover:bg-destructive/10"
                    title="Delete saved view"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete saved view "${v.name}"?`)) {
                        remove.mutate(v.id);
                      }
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="border-t pt-2 px-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs h-8"
              onClick={() => {
                setOpen(false);
                setSaveOpen(true);
              }}
            >
              <Save className="h-3 w-3" />
              Save current view…
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Save dialog */}
      <Popover open={saveOpen} onOpenChange={setSaveOpen}>
        <PopoverTrigger asChild>
          <span className="sr-only" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3 space-y-2">
          <div className="text-xs font-medium">Name this view</div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. AHCCCS deep dive"
            className="h-8 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
              if (e.key === "Escape") setSaveOpen(false);
            }}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!name.trim() || upsert.isPending}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
