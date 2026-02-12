import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  if (!deferredPrompt || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(90vw,320px)] rounded-2xl border border-white/10 bg-card/90 p-4 shadow-xl backdrop-blur">
      <p className="text-sm font-medium">Install SingBetter AI</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Add this app to your home screen for a faster launch experience.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          className="h-9 flex-1 rounded-lg bg-primary text-xs font-semibold text-primary-foreground"
          onClick={async () => {
            await deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            setDeferredPrompt(null);
          }}
        >
          Install
        </button>
        <button
          className="h-9 rounded-lg border border-white/10 px-3 text-xs text-muted-foreground"
          onClick={() => setDismissed(true)}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
