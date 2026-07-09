import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Webhook as WebhookIcon, Send, Trash2, Plus, CheckCircle2, Copy } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Webhook = { id: string; url: string; events: string[]; created_at: string; last_ping_at: string | null; last_status: number | null };

const EVENT_OPTIONS = [
  { key: "tier_upgrade", label: "County tier upgrade (emerging → warm → hot)" },
  { key: "score_cross", label: "Landing score crosses your threshold" },
  { key: "new_permit", label: "New permit filed in a watched county" },
  { key: "new_bid", label: "New competitive bid observed" },
  { key: "moratorium_change", label: "County moratorium status changes" },
];

const SAMPLE_PAYLOAD = {
  event: "tier_upgrade",
  timestamp: "2026-07-05T14:30:00Z",
  data: {
    county_fips: "48113",
    county_name: "Dallas",
    state: "TX",
    old_tier: "warm",
    new_tier: "hot",
    landing_probability: 84.2,
    trigger: "score crossed 80 after 3 new permits + Meta shell LLC parcel"
  }
};

export default function Webhooks() {
  const { toast } = useToast();
  const [newUrl, setNewUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["tier_upgrade"]);

  const { data: webhooks, isLoading } = useQuery<Webhook[]>({ queryKey: ["/api/webhooks"] });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/webhooks", { url: newUrl, events: selectedEvents });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      setNewUrl("");
      toast({ title: "Webhook created" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const testMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/webhooks/${id}/test`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      toast({ title: "Test ping delivered", description: "200 OK" });
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/webhooks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      toast({ title: "Webhook removed" });
    },
  });

  const toggleEvent = (ev: string) => {
    setSelectedEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);
  };

  const copyPayload = () => {
    navigator.clipboard.writeText(JSON.stringify(SAMPLE_PAYLOAD, null, 2));
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto" data-testid="page-webhooks">
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <WebhookIcon className="h-5 w-5 text-primary" /> Webhooks
        </h1>
        <p className="text-sm text-muted-foreground">
          Get a POST request the moment a county upgrades tier, a permit is filed in your watchlist, or an operator bids on your market.
        </p>
      </div>

      {/* Create form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Plus className="h-4 w-4" />Add a Webhook Endpoint</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Endpoint URL</label>
            <Input
              placeholder="https://your-api.com/gridsense-hook"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              data-testid="input-webhook-url"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Subscribe to events</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              {EVENT_OPTIONS.map((e) => (
                <label key={e.key} className="flex items-start gap-2 rounded-md border border-border bg-card p-2 cursor-pointer hover-elevate" data-testid={`event-option-${e.key}`}>
                  <Checkbox checked={selectedEvents.includes(e.key)} onCheckedChange={() => toggleEvent(e.key)} className="mt-0.5" />
                  <div className="text-xs">
                    <div className="font-mono">{e.key}</div>
                    <div className="text-muted-foreground text-[11px] mt-0.5">{e.label}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <Button onClick={() => createMut.mutate()} disabled={!newUrl || createMut.isPending} data-testid="button-webhook-create">
            {createMut.isPending ? "Creating..." : "Create webhook"}
          </Button>
        </CardContent>
      </Card>

      {/* Existing webhooks */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Active Endpoints ({webhooks?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <Skeleton className="h-32 m-4" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Last ping</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(webhooks ?? []).map((w) => (
                  <TableRow key={w.id} data-testid={`row-webhook-${w.id}`}>
                    <TableCell className="font-mono text-xs max-w-xs truncate">{w.url}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {w.events.map((e) => (<Badge key={e} variant="outline" className="text-[9px]">{e}</Badge>))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{w.last_ping_at ? new Date(w.last_ping_at).toLocaleString() : "never"}</TableCell>
                    <TableCell>
                      {w.last_status === 200 ? <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 text-[9px]"><CheckCircle2 className="h-2.5 w-2.5 mr-1" />200</Badge>
                       : w.last_status ? <Badge variant="destructive" className="text-[9px]">{w.last_status}</Badge>
                       : <Badge variant="outline" className="text-[9px]">—</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => testMut.mutate(w.id)} disabled={testMut.isPending} data-testid={`button-webhook-test-${w.id}`}>
                        <Send className="h-3 w-3 mr-1" />Test
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => delMut.mutate(w.id)} className="ml-1" data-testid={`button-webhook-delete-${w.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Sample payload */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Sample Payload</span>
            <Button size="sm" variant="ghost" onClick={copyPayload} data-testid="button-copy-payload">
              <Copy className="h-3 w-3 mr-1" />Copy
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto font-mono">
{JSON.stringify(SAMPLE_PAYLOAD, null, 2)}
          </pre>
          <div className="text-[11px] text-muted-foreground mt-2">
            Every payload includes an <code className="font-mono">event</code>, a <code className="font-mono">timestamp</code>, and an <code className="font-mono">data</code> object with the county context.
            All requests are signed with an HMAC-SHA256 header (X-GridSense-Signature) so you can verify authenticity.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
