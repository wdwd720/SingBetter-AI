import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { BottomNav } from "@/components/BottomNav";
import { useAuth } from "@/hooks/use-auth";
import { Bell, Download, LogOut, Shield, Trash2 } from "lucide-react";

type ProfileResponse = {
  user: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  } | null;
  settings: {
    role: string;
    locale: string;
    consentVersion: string | null;
    consentGivenAt: string | null;
    onboardingCompletedAt: string | null;
    emailNotifications: boolean;
    inAppNotifications: boolean;
  } | null;
};

type Notification = {
  id: number;
  type: string;
  title: string;
  body?: string | null;
  readAt?: string | null;
  createdAt: string;
};

type VersionResponse = {
  version: string;
};

export default function Profile() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState("");
  const [mfaSetup, setMfaSetup] = useState<{
    secret: string;
    otpauthUrl: string;
    recoveryCodes: string[];
  } | null>(null);
  const [celebrationsEnabled, setCelebrationsEnabled] = useState(true);

  useEffect(() => {
    const current = window.localStorage.getItem("singbetter_celebrations_enabled");
    setCelebrationsEnabled(current !== "0");
  }, []);

  const profileQuery = useQuery<ProfileResponse>({
    queryKey: ["/api/profile"],
    queryFn: async () => {
      const response = await fetch("/api/profile", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load profile");
      return response.json();
    },
  });

  const notificationsQuery = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const response = await fetch("/api/notifications?limit=10", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load notifications");
      return response.json();
    },
  });

  const mfaStatusQuery = useQuery<{ enabled: boolean; recoveryCodesRemaining: number; featureEnabled: boolean }>({
    queryKey: ["/api/auth/mfa/status"],
    queryFn: async () => {
      const response = await fetch("/api/auth/mfa/status", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load MFA status");
      return response.json();
    },
  });

  const versionQuery = useQuery<VersionResponse>({
    queryKey: ["/api/version"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/version", { credentials: "include" });
        if (!response.ok) return { version: "unknown" };
        const data = (await response.json()) as VersionResponse;
        return {
          version:
            typeof data?.version === "string" && data.version.trim().length > 0
              ? data.version.trim()
              : "unknown",
        };
      } catch {
        return { version: "unknown" };
      }
    },
  });

  const displayName = useMemo(() => {
    const first = profileQuery.data?.user?.firstName || "";
    const last = profileQuery.data?.user?.lastName || "";
    return `${first} ${last}`.trim() || user?.email || "User";
  }, [profileQuery.data, user?.email]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      firstName: (form.get("firstName") as string) || undefined,
      lastName: (form.get("lastName") as string) || undefined,
      locale: (form.get("locale") as string) || undefined,
      emailNotifications: form.get("emailNotifications") === "on",
      inAppNotifications: form.get("inAppNotifications") === "on",
    };
    const response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.message || "Could not save profile");
      return;
    }
    setMessage("Profile saved.");
    queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
  };

  const acceptConsent = async () => {
    setError(null);
    const response = await fetch("/api/privacy/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ granted: true, version: "2026-02-11" }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.message || "Could not save consent");
      return;
    }
    setMessage("Consent preferences saved.");
    queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
  };

  const withdrawConsent = async () => {
    setError(null);
    const response = await fetch("/api/privacy/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ granted: false }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.message || "Could not update consent");
      return;
    }
    setMessage("Consent withdrawn. Analytics collection is disabled.");
    queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
  };

  const exportData = async () => {
    setError(null);
    const response = await fetch("/api/privacy/export", {
      credentials: "include",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.message || "Could not export data");
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "singbetter-export.json";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Data export downloaded.");
  };

  const markRead = async (id: number) => {
    await fetch(`/api/notifications/${id}/read`, {
      method: "POST",
      credentials: "include",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  };

  const setupMfa = async () => {
    setError(null);
    const response = await fetch("/api/auth/mfa/setup", {
      method: "POST",
      credentials: "include",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.message || "Could not setup MFA");
      return;
    }
    setMfaSetup(data);
  };

  const verifyMfa = async () => {
    setError(null);
    const response = await fetch("/api/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token: mfaToken }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.message || "Could not verify MFA");
      return;
    }
    setMfaToken("");
    setMfaSetup(null);
    setMessage("MFA enabled.");
    queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa/status"] });
  };

  const disableMfa = async () => {
    setError(null);
    const response = await fetch("/api/auth/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token: mfaToken }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setError(data?.message || "Could not disable MFA");
      return;
    }
    setMfaToken("");
    setMessage("MFA disabled.");
    queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa/status"] });
  };

  const deleteAccount = async () => {
    const ok = window.confirm("Delete your account and all data? This cannot be undone.");
    if (!ok) return;
    setError(null);
    const response = await fetch("/api/privacy/delete-account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    if (!response.ok && response.status !== 204) {
      const data = await response.json().catch(() => null);
      setError(data?.message || "Could not delete account");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    window.location.href = "/";
  };

  const profile = profileQuery.data;
  const consentTimestamp = profile?.settings?.consentGivenAt
    ? new Date(profile.settings.consentGivenAt).toLocaleString()
    : null;
  const consentGranted = Boolean(profile?.settings?.consentGivenAt);

  const toggleCelebrations = (enabled: boolean) => {
    setCelebrationsEnabled(enabled);
    window.localStorage.setItem("singbetter_celebrations_enabled", enabled ? "1" : "0");
    setMessage(enabled ? "Celebration toasts enabled." : "Celebration toasts disabled.");
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-6 py-9">
        <h1 className="text-3xl font-display font-bold tracking-tight">Profile</h1>
      </header>

      <main className="space-y-7 px-6">
        <div className="rounded-3xl border border-white/10 bg-card/80 p-6 shadow-[0_18px_30px_-24px_rgba(0,0,0,0.95)]">
          <div className="mb-4 flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/15 text-lg font-bold">
              {(displayName || "U").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">{displayName}</h2>
              <p className="text-sm text-muted-foreground">{profile?.user?.email || user?.email}</p>
            </div>
          </div>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={saveProfile}>
            <input
              name="firstName"
              defaultValue={profile?.user?.firstName || ""}
              className="h-11 rounded-xl border border-white/15 bg-background/70 px-3.5 text-sm"
              placeholder="First name"
            />
            <input
              name="lastName"
              defaultValue={profile?.user?.lastName || ""}
              className="h-11 rounded-xl border border-white/15 bg-background/70 px-3.5 text-sm"
              placeholder="Last name"
            />
            <select
              name="locale"
              defaultValue={profile?.settings?.locale || "en"}
              className="h-11 rounded-xl border border-white/15 bg-background/70 px-3.5 text-sm"
            >
              <option value="en">English</option>
              <option value="es">Espanol</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="emailNotifications"
                defaultChecked={profile?.settings?.emailNotifications ?? true}
              />
              Email notifications
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="inAppNotifications"
                defaultChecked={profile?.settings?.inAppNotifications ?? true}
              />
              In-app notifications
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[0_12px_24px_-16px_rgba(34,197,94,0.85)]"
              >
                Save profile
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-3xl border border-white/10 bg-card/80 p-6">
          <div className="mb-3 text-sm font-semibold tracking-wide">Experience</div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={celebrationsEnabled}
              onChange={(event) => toggleCelebrations(event.target.checked)}
            />
            Show celebration toasts (streaks and high scores)
          </label>
        </div>

        <div className="rounded-3xl border border-white/10 bg-card/80 p-6">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4" />
            <h3 className="text-lg font-semibold tracking-tight">Security & Privacy</h3>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Consent status: {consentGranted ? `Granted (${consentTimestamp})` : "Not granted"}
          </p>
          <div className="space-y-2">
            <button onClick={acceptConsent} className="h-10 rounded-xl border border-white/15 px-3.5 text-sm hover:bg-white/5">
              Accept latest privacy consent
            </button>
            <button
              onClick={withdrawConsent}
              className="ml-2 h-10 rounded-xl border border-white/15 px-3.5 text-sm hover:bg-white/5"
            >
              Withdraw analytics consent
            </button>
            <button onClick={exportData} className="ml-2 h-10 rounded-xl border border-white/15 px-3.5 text-sm hover:bg-white/5">
              <Download className="mr-1 inline h-4 w-4" />
              Export my data
            </button>
            <button onClick={deleteAccount} className="ml-2 h-10 rounded-xl border border-red-500/30 px-3.5 text-sm text-red-300 hover:bg-red-500/10">
              <Trash2 className="mr-1 inline h-4 w-4" />
              Delete account
            </button>
          </div>
          <div className="mt-4 rounded-xl border border-white/10 bg-background/55 p-4">
            <p className="mb-2 text-xs text-muted-foreground">
              MFA status: {mfaStatusQuery.data?.enabled ? "Enabled" : "Disabled"}
            </p>
            {!mfaStatusQuery.data?.enabled ? (
              <button onClick={setupMfa} className="h-10 rounded-xl border border-white/15 px-3.5 text-sm hover:bg-white/5">
                Setup MFA
              </button>
            ) : null}
            {mfaSetup ? (
              <div className="mt-3 space-y-2 text-xs">
                <p>Secret: {mfaSetup.secret}</p>
                <p className="break-all">OTP URI: {mfaSetup.otpauthUrl}</p>
                <p>Recovery codes: {mfaSetup.recoveryCodes.join(", ")}</p>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={mfaToken}
                onChange={(event) => setMfaToken(event.target.value)}
                className="h-10 rounded-xl border border-white/15 bg-background/70 px-3.5 text-sm"
                placeholder="MFA code"
              />
              <button onClick={verifyMfa} className="h-10 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-[0_12px_24px_-16px_rgba(34,197,94,0.85)]">
                Verify MFA
              </button>
              <button onClick={disableMfa} className="h-10 rounded-xl border border-white/15 px-3.5 text-xs hover:bg-white/5">
                Disable MFA
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-card/80 p-6">
          <div className="mb-3 flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <h3 className="text-lg font-semibold tracking-tight">Notifications</h3>
          </div>
          {notificationsQuery.data?.length ? (
            <div className="space-y-2">
              {notificationsQuery.data.map((item) => (
                <button
                  key={item.id}
                  className="block w-full rounded-xl border border-white/10 p-3.5 text-left transition-colors hover:bg-white/5"
                  onClick={() => markRead(item.id)}
                >
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.body || item.type}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <Link href="/help" className="hover:text-foreground">Help</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <button onClick={() => logout()} className="inline-flex items-center gap-1 hover:text-foreground">
            <LogOut className="h-4 w-4" /> Sign Out
          </button>
        </div>

        {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <p className="text-xs text-muted-foreground">
          Version: {versionQuery.data?.version ?? "unknown"}
        </p>
      </main>
      <BottomNav />
    </div>
  );
}
