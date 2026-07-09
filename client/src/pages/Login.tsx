import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Lock, UserPlus, LogOut, Mail, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Me {
  user: { id: number; email: string } | null;
}

export default function Login() {
  const { toast } = useToast();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { data: me } = useQuery<Me>({ queryKey: ["/api/auth/me"] });
  const { data: providers } = useQuery<{ google: boolean }>({ queryKey: ["/api/auth/providers"] });

  const authMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/auth/${mode}`, { email, password });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: mode === "login" ? "Signed in" : "Account created" });
      setEmail("");
      setPassword("");
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Failed", description: err.message ?? String(err) });
    },
  });

  const demoMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/auth/demo", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Welcome to the GridSense demo", description: "Your watchlist is pre-populated with today's hot counties." });
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Demo failed", description: err.message ?? String(err) }),
  });

  const logoutMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/auth/logout", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }),
  });

  if (me?.user) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" /> Signed In
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              You are signed in as{" "}
              <span className="font-mono font-semibold">{me.user.email}</span>.
            </div>
            <div className="text-xs text-muted-foreground">
              Your watchlist and alert subscriptions on this account are
              persisted server-side. Sign out to switch accounts.
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              data-testid="button-logout"
            >
              <LogOut className="h-3.5 w-3.5 mr-1.5" /> Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="text-base inline-flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            {mode === "login" ? "Sign In" : "Create Account"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            className="w-full"
            variant="default"
            onClick={() => demoMutation.mutate()}
            disabled={demoMutation.isPending}
            data-testid="button-demo"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Try instant demo (no signup)
          </Button>
          {providers?.google && (
            <Button asChild className="w-full" variant="outline" data-testid="button-google-sso">
              <a href="/api/auth/google">
                <Mail className="h-3.5 w-3.5 mr-1.5" />
                Continue with Google
              </a>
            </Button>
          )}
          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center"><span className="bg-card px-2 text-[10px] uppercase tracking-wider text-muted-foreground">or</span></div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              data-testid="input-email"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "8+ characters" : ""}
              data-testid="input-password"
            />
          </div>
          <Button
            className="w-full"
            onClick={() => authMutation.mutate()}
            disabled={!email || !password || authMutation.isPending}
            data-testid="button-submit"
          >
            {mode === "login" ? (
              <>
                <Lock className="h-3.5 w-3.5 mr-1.5" /> Sign in
              </>
            ) : (
              <>
                <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Create account
              </>
            )}
          </Button>
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="w-full text-xs text-muted-foreground hover:text-foreground"
            data-testid="button-toggle-mode"
          >
            {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
          </button>
          <p className="text-xs text-muted-foreground pt-2 border-t">
            Accounts persist your per-user watchlist and email alerts. Data is
            stored locally in this deployment's SQLite database; passwords are
            hashed with bcrypt.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
