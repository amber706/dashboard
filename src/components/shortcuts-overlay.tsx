import { useShortcutsOverlay } from "@/lib/use-keyboard-shortcuts";
import { X, Keyboard } from "lucide-react";

export function ShortcutsOverlay() {
  const { isOpen, setIsOpen, shortcuts } = useShortcutsOverlay();

  if (!isOpen) return null;

  const categories = shortcuts.reduce<Record<string, typeof shortcuts>>((acc, s) => {
    if (!acc[s.category]) acc[s.category] = [];
    acc[s.category].push(s);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIsOpen(false)} role="dialog" aria-label="Keyboard shortcuts">
      <div className="bg-background border rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">Keyboard Shortcuts</h2>
          </div>
          <button onClick={() => setIsOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-5">
          {Object.entries(categories).map(([category, catShortcuts]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{category}</h3>
              <div className="space-y-1.5">
                {catShortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-sm text-muted-foreground">{s.description}</span>
                    <kbd className="px-2 py-0.5 bg-muted border rounded text-xs font-mono">
                      {[s.ctrl && "Ctrl", s.shift && "Shift", s.alt && "Alt", s.key.toUpperCase()].filter(Boolean).join(" + ")}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">Toggle this overlay</span>
              <kbd className="px-2 py-0.5 bg-muted border rounded text-xs font-mono">?</kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
