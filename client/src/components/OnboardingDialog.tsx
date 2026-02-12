import { useEffect, useState } from "react";

const storageKey = "singbetter_onboarding_seen_v1";

export default function OnboardingDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const seen = window.localStorage.getItem(storageKey);
    if (!seen) {
      setOpen(true);
    }
  }, []);

  const finish = async () => {
    window.localStorage.setItem(storageKey, "1");
    setOpen(false);
    try {
      await fetch("/api/profile", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingCompleted: true }),
      });
    } catch {
      // best effort
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-card p-6">
        <h2 className="text-2xl font-display font-bold">Welcome to SingBetter</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Quick start: upload a reference track, transcribe lyrics, record your take, and review your coaching history.
        </p>
        <ol className="mt-4 list-inside list-decimal space-y-1 text-sm">
          <li>Go to Live Coaching and upload a song.</li>
          <li>Analyze lyrics and start recording.</li>
          <li>Check Progress for saved scores.</li>
        </ol>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
            onClick={finish}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
