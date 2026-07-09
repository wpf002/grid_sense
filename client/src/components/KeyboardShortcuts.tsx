import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

const shortcuts: Array<{ keys: string[]; label: string; scope: string }> = [
  { keys: ["⌘", "K"], label: "Open command palette / search", scope: "Global" },
  { keys: ["?"], label: "Show this cheat sheet", scope: "Global" },
  { keys: ["g", "d"], label: "Go to Dashboard", scope: "Navigation" },
  { keys: ["g", "c"], label: "Go to Counties", scope: "Navigation" },
  { keys: ["g", "m"], label: "Go to Map", scope: "Navigation" },
  { keys: ["g", "s"], label: "Go to Signals", scope: "Navigation" },
  { keys: ["g", "a"], label: "Go to Alerts", scope: "Navigation" },
  { keys: ["g", "o"], label: "Go to Operators", scope: "Navigation" },
  { keys: ["g", "p"], label: "Go to Portfolio scorer", scope: "Navigation" },
  { keys: ["g", "w"], label: "Go to Watchlist", scope: "Navigation" },
  { keys: ["g", "h"], label: "Go to Heartbeat", scope: "Navigation" },
  { keys: ["Esc"], label: "Close dialog or panel", scope: "General" },
];

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    let pendingTimer: any = null;
    const nav = (path: string) => {
      setLocation(path);
      setPending(null);
    };
    const isTypingTarget = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey) {
        setPending("g");
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => setPending(null), 1200);
        return;
      }
      if (pending === "g") {
        e.preventDefault();
        const k = e.key.toLowerCase();
        if (k === "d") nav("/");
        else if (k === "c") nav("/counties");
        else if (k === "m") nav("/map");
        else if (k === "s") nav("/signals");
        else if (k === "a") nav("/alerts");
        else if (k === "o") nav("/operators");
        else if (k === "p") nav("/portfolio");
        else if (k === "w") nav("/watchlist");
        else if (k === "h") nav("/heartbeat");
        setPending(null);
        if (pendingTimer) clearTimeout(pendingTimer);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (pendingTimer) clearTimeout(pendingTimer);
    };
  }, [pending, setLocation]);

  return (
    <>
      {pending && (
        <div
          className="fixed bottom-4 right-4 z-[500] bg-card border border-border rounded-md px-3 py-2 text-[11px] font-mono text-muted-foreground shadow-lg"
          data-testid="text-pending-key"
        >
          <kbd className="bg-muted px-1.5 py-0.5 rounded font-mono">{pending}</kbd>
          <span className="ml-2">then a page key…</span>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-primary" />
              Keyboard shortcuts
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {["Global", "Navigation", "General"].map((scope) => (
              <div key={scope}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{scope}</div>
                <div className="space-y-1">
                  {shortcuts
                    .filter((s) => s.scope === scope)
                    .map((s) => (
                      <div key={s.label} className="flex items-center justify-between text-sm">
                        <span className="text-foreground/90">{s.label}</span>
                        <span className="flex gap-1">
                          {s.keys.map((k, i) => (
                            <kbd
                              key={i}
                              className="bg-muted border border-border rounded px-1.5 py-0.5 text-[11px] font-mono min-w-5 text-center"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
            <div className="text-[10px] text-muted-foreground pt-2 border-t border-border">
              Tip: press <kbd className="bg-muted px-1 rounded font-mono">g</kbd> then a page key within 1 second to jump.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
