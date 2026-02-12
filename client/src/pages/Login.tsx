import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LineChart,
  Lock,
  Mail,
  Mic2,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

type AuthMode = "signin" | "signup";

const getPasswordStrength = (password: string): number => {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 5);
};

const passwordLabels = ["Very weak", "Weak", "Okay", "Good", "Strong", "Excellent"];

export default function Login() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user, isLoading } = useAuth();

  const [mode, setMode] = useState<AuthMode>("signin");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

  useEffect(() => {
    if (!isLoading && user) {
      setLocation("/");
    }
  }, [isLoading, setLocation, user]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResetStatus(null);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (mode === "signup") {
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match");
        }
        if (passwordStrength < 3) {
          throw new Error("Use a stronger password (mix letters, numbers, symbols)");
        }
      }

      const endpoint = mode === "signin" ? "/api/auth/login" : "/api/auth/signup";
      const payload =
        mode === "signin"
          ? { email: normalizedEmail, password }
          : {
              email: normalizedEmail,
              password,
              firstName: firstName.trim() || undefined,
              lastName: lastName.trim() || undefined,
            };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (mode === "signin" && response.status === 202) {
        setMfaRequired(true);
        return;
      }

      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.message || "Authentication failed");
      }

      const currentUser = await response.json();
      queryClient.setQueryData(["/api/auth/user"], currentUser);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  const submitMfa = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/mfa/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: mfaCode }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.message || "MFA verification failed");
      }
      const currentUser = await response.json();
      queryClient.setQueryData(["/api/auth/user"], currentUser);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "MFA verification failed");
    } finally {
      setSubmitting(false);
    }
  };

  const requestPasswordReset = async () => {
    setResetStatus(null);
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your account email first");
      return;
    }
    const response = await fetch("/api/auth/password/request-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: normalizedEmail }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok && response.status !== 204) {
      setError(data?.message || "Could not request reset");
      return;
    }
    if (data?.resetToken) {
      setResetToken(data.resetToken);
      setResetStatus("Reset token generated (dev mode). Use it below.");
    } else {
      setResetStatus("If the email exists, a reset flow was triggered.");
    }
  };

  const completePasswordReset = async () => {
    setResetStatus(null);
    setError(null);
    if (!resetToken || !newPassword) {
      setError("Enter both reset token and new password");
      return;
    }
    const response = await fetch("/api/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token: resetToken.trim(), newPassword }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok && response.status !== 204) {
      setError(data?.message || "Could not reset password");
      return;
    }
    setShowReset(false);
    setResetToken("");
    setNewPassword("");
    setResetStatus("Password updated. You can sign in now.");
  };

  const authTitle = mode === "signin" ? "Sign in to your studio" : "Create your SingBetter account";
  const authSubtitle =
    mode === "signin"
      ? "Jump back into your saved tracks, attempts, and feedback."
      : "Store your practice history and coaching analytics in your own account.";

  if (!isLoading && user) return null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute -left-40 top-0 h-[420px] w-[420px] rounded-full bg-primary/15 blur-[120px]" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-[360px] w-[360px] rounded-full bg-secondary/15 blur-[120px]" />

      <div className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid w-full gap-7 md:grid-cols-[1.08fr,1fr]">
          <section className="relative hidden overflow-hidden rounded-3xl border border-white/10 bg-card/65 p-9 backdrop-blur md:flex md:flex-col md:justify-between">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(38,217,98,0.2),transparent_50%),radial-gradient(circle_at_bottom_left,rgba(13,214,248,0.18),transparent_50%)]" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                AI Vocal Performance Studio
              </div>
              <h1 className="mt-5 text-4xl font-display font-bold leading-tight text-balance">
                Train with precision, track every rep.
              </h1>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
                Build a personal coaching timeline with saved uploads, automated feedback, and progression analytics.
              </p>
            </div>

            <div className="relative mt-9 grid gap-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-background/60 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <p className="font-semibold">Secure account sessions</p>
                    <p className="text-xs text-muted-foreground">Local password auth with DB-backed sessions.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/60 p-4">
                <div className="flex items-start gap-3">
                  <LineChart className="mt-0.5 h-4 w-4 text-secondary" />
                  <div>
                    <p className="font-semibold">Persistent progress history</p>
                    <p className="text-xs text-muted-foreground">Attempts and scores stay saved between restarts.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-card/75 p-6 backdrop-blur sm:p-8">
            <div className="mb-7 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2">
                <Mic2 className="h-5 w-5 text-primary" />
                <span className="font-display text-lg font-bold tracking-tight">SingBetter AI</span>
              </Link>
              <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
                Back home
              </Link>
            </div>

            <div className="mb-6 rounded-2xl border border-white/10 bg-background/60 p-1">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                  }}
                  className={`h-10 rounded-xl text-sm font-medium transition ${
                    mode === "signin"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                  }}
                  className={`h-10 rounded-xl text-sm font-medium transition ${
                    mode === "signup"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  Create account
                </button>
              </div>
            </div>

            <h2 className="text-3xl font-display font-bold tracking-tight">{authTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{authSubtitle}</p>

            {mfaRequired ? (
              <form className="mt-7 space-y-4" onSubmit={submitMfa}>
                <h3 className="text-lg font-semibold">Multi-factor verification</h3>
                <p className="text-sm text-muted-foreground">
                  Enter your 6-digit code (or recovery code) to complete sign in.
                </p>
                <label className="space-y-2">
                  <span className="text-xs text-muted-foreground">MFA code</span>
                  <input
                    type="text"
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value)}
                    className="h-11 w-full rounded-xl border border-white/15 bg-background/70 px-3.5 text-sm outline-none ring-primary focus:ring-2"
                    placeholder="123456"
                  />
                </label>
                {error ? (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {error}
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={submitting}
                  className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-[0_12px_26px_-18px_rgba(34,197,94,0.85)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting ? "Verifying..." : "Verify and continue"}
                </button>
              </form>
            ) : (
            <form className="mt-7 space-y-4" onSubmit={submit}>
              {mode === "signup" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs text-muted-foreground">First name</span>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        className="h-11 w-full rounded-xl border border-white/15 bg-background/70 pl-10 pr-3 text-sm outline-none ring-primary focus:ring-2"
                        placeholder="Mihir"
                        autoComplete="given-name"
                      />
                    </div>
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs text-muted-foreground">Last name</span>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        className="h-11 w-full rounded-xl border border-white/15 bg-background/70 pl-10 pr-3 text-sm outline-none ring-primary focus:ring-2"
                        placeholder="Modi"
                        autoComplete="family-name"
                      />
                    </div>
                  </label>
                </div>
              ) : null}

              <label className="space-y-2">
                <span className="text-xs text-muted-foreground">Email</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-11 w-full rounded-xl border border-white/15 bg-background/70 pl-10 pr-3 text-sm outline-none ring-primary focus:ring-2"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
              </label>

              <label className="space-y-2">
                <span className="text-xs text-muted-foreground">Password</span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-11 w-full rounded-xl border border-white/15 bg-background/70 pl-10 pr-11 text-sm outline-none ring-primary focus:ring-2"
                    placeholder="At least 8 characters"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              {mode === "signup" ? (
                <>
                  <div className="space-y-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${(passwordStrength / 5) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Password strength: {passwordLabels[passwordStrength]}
                    </p>
                  </div>

                  <label className="space-y-2">
                    <span className="text-xs text-muted-foreground">Confirm password</span>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        className="h-11 w-full rounded-xl border border-white/15 bg-background/70 pl-10 pr-11 text-sm outline-none ring-primary focus:ring-2"
                        placeholder="Re-enter your password"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground"
                        aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </label>
                </>
              ) : null}

              {mode === "signin" ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowReset((prev) => !prev)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Forgot password?
                  </button>
                  {showReset ? (
                    <div className="space-y-2 rounded-xl border border-white/10 bg-background/55 p-3">
                      <button
                        type="button"
                        onClick={requestPasswordReset}
                        className="h-9 rounded-lg border border-white/15 px-3 text-xs font-semibold hover:bg-white/5"
                      >
                        Request reset token
                      </button>
                      <input
                        value={resetToken}
                        onChange={(event) => setResetToken(event.target.value)}
                        className="h-10 w-full rounded-lg border border-white/15 bg-background/70 px-3 text-sm"
                        placeholder="Reset token"
                      />
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        className="h-10 w-full rounded-lg border border-white/15 bg-background/70 px-3 text-sm"
                        placeholder="New password"
                      />
                      <button
                        type="button"
                        onClick={completePasswordReset}
                        className="h-9 rounded-lg bg-secondary px-3 text-xs font-semibold text-secondary-foreground"
                      >
                        Set new password
                      </button>
                      {resetStatus ? <p className="text-xs text-muted-foreground">{resetStatus}</p> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-[0_12px_26px_-18px_rgba(34,197,94,0.85)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span>
                  {submitting
                    ? "Please wait..."
                    : mode === "signin"
                      ? "Sign in"
                      : "Create account"}
                </span>
                {!submitting ? <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /> : null}
              </button>

              <p className="text-center text-xs text-muted-foreground">
                By continuing, you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
              </p>
            </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
