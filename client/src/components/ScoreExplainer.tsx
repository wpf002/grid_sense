import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Link } from "wouter";

export function ScoreExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="What is the GridSense score?"
          data-testid="button-score-explainer"
        >
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>What is the GridSense score?</DialogTitle>
          <DialogDescription>
            A 0-100 forward-looking probability that a US county will host a large
            hyperscale/AI data-center announcement in the next 12-18 months.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-semibold mb-1">The four scoring factors</div>
            <ul className="space-y-1.5 text-muted-foreground">
              <li><span className="font-mono text-foreground">Power (35%)</span> — grid headroom, interconnection queue, retiring generation.</li>
              <li><span className="font-mono text-foreground">Land (25%)</span> — buildable acreage, industrial zoning, LLC acquisitions.</li>
              <li><span className="font-mono text-foreground">Water (15%)</span> — cooling capacity, drought risk, permit activity.</li>
              <li><span className="font-mono text-foreground">Policy (25%)</span> — tax incentives, moratoria, permitting velocity.</li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-1">Tiers</div>
            <div className="grid grid-cols-2 gap-2 text-muted-foreground">
              <div><span className="text-red-500 font-mono">Hot ≥ 80</span> — near-term announcement likely</div>
              <div><span className="text-amber-500 font-mono">Warm 65-79</span> — active accumulation</div>
              <div><span className="text-blue-500 font-mono">Emerging 45-64</span> — worth watching</div>
              <div><span className="text-muted-foreground font-mono">Cold &lt; 45</span> — no signal</div>
            </div>
          </div>
          <div className="pt-2 border-t border-border">
            <Link
              href="/methodology"
              className="text-primary text-sm hover:underline"
              onClick={() => setOpen(false)}
            >
              Read the full methodology →
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
