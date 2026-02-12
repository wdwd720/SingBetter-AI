import { useEffect, useState } from "react";

type HealthMode = {
  mode?: {
    devMode?: boolean;
  };
};

export default function DevModeBanner() {
  const [isDevMode, setIsDevMode] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/health", { credentials: "include" });
        if (!response.ok) return;
        const payload = (await response.json()) as HealthMode;
        if (active) {
          setIsDevMode(!!payload.mode?.devMode);
        }
      } catch {
        // Ignore health fetch errors for banner rendering.
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  if (!isDevMode) return null;

  return (
    <div className="fixed left-0 right-0 top-0 z-[60] bg-amber-500/90 px-3 py-1 text-center text-xs font-semibold text-black">
      Dev Mode: authentication bypass is enabled
    </div>
  );
}
