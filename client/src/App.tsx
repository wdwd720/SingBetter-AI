import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";

import Landing from "@/pages/Landing";
import Home from "@/pages/Home";
import SessionMode from "@/pages/SessionMode";
import Results from "@/pages/Results";
import Progress from "@/pages/Progress";
import Practice from "@/pages/Practice";
import Profile from "@/pages/Profile";
import NotFound from "@/pages/not-found";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div className="min-h-screen bg-background" />;
  
  if (!user) return <Landing />;

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={Home} />} />
      <Route path="/practice" component={() => <ProtectedRoute component={Practice} />} />
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
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
