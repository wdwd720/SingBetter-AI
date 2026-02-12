import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";

import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Home from "@/pages/Home";
import SessionMode from "@/pages/SessionMode";
import LiveCoaching from "@/pages/LiveCoaching";
import Results from "@/pages/Results";
import Progress from "@/pages/Progress";
import Practice from "@/pages/Practice";
import Profile from "@/pages/Profile";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";
import Help from "@/pages/Help";
import NotFound from "@/pages/not-found";
import PwaInstallPrompt from "@/components/PwaInstallPrompt";
import DevModeBanner from "@/components/DevModeBanner";
import { useLocale } from "@/hooks/use-locale";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div className="min-h-screen bg-background" />;
  
  if (!user) return <Landing />;

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/api/login" component={Login} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/help" component={Help} />
      <Route path="/" component={() => <ProtectedRoute component={Home} />} />
      <Route path="/practice" component={() => <ProtectedRoute component={Practice} />} />
      <Route path="/live-coaching" component={() => <ProtectedRoute component={LiveCoaching} />} />
      <Route path="/session/live_coach" component={() => <ProtectedRoute component={LiveCoaching} />} />
      <Route path="/session/:mode" component={() => <ProtectedRoute component={SessionMode} />} />
      <Route path="/results/:id" component={() => <ProtectedRoute component={Results} />} />
      <Route path="/progress" component={() => <ProtectedRoute component={Progress} />} />
      <Route path="/profile" component={() => <ProtectedRoute component={Profile} />} />
      
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppShell />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function AppShell() {
  useLocale();

  useEffect(() => {
    let active = true;
    const trackAppLoaded = async () => {
      try {
        const profileRes = await fetch("/api/profile", { credentials: "include" });
        if (!profileRes.ok) return;
        const profile = (await profileRes.json()) as {
          settings?: { consentGivenAt?: string | null };
        };
        if (!active || !profile.settings?.consentGivenAt) return;

        await fetch("/api/analytics/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name: "app_loaded",
            properties: { path: window.location.pathname },
          }),
        });
      } catch {
        // Best-effort analytics.
      }
    };
    void trackAppLoaded();
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <DevModeBanner />
      <Toaster />
      <Router />
      <PwaInstallPrompt />
    </>
  );
}

export default App;
