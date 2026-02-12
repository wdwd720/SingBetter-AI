import { FormEvent, useState } from "react";
import { Link } from "wouter";

export default function Help() {
  const [category, setCategory] = useState("support");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ category, message }),
      });
      if (!response.ok) {
        throw new Error("Could not send feedback");
      }
      setMessage("");
      setStatus("Thanks, your feedback was submitted.");
    } catch {
      setStatus("Feedback could not be submitted right now.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-display font-bold">Help & Support</h1>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Back
          </Link>
        </div>
        <div className="mb-6 rounded-2xl border border-white/10 bg-card/70 p-5">
          <p className="text-sm text-muted-foreground">
            Need help or found a bug? Send a message and we will follow up.
          </p>
        </div>
        <form className="space-y-4 rounded-2xl border border-white/10 bg-card/70 p-5" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-10 w-full rounded-lg border border-white/10 bg-background px-3 text-sm"
            >
              <option value="support">Support</option>
              <option value="bug">Bug</option>
              <option value="feature">Feature</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Message</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              minLength={10}
              required
              className="min-h-32 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm"
              placeholder="Describe your issue or suggestion..."
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {submitting ? "Sending..." : "Send feedback"}
          </button>
          {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
        </form>
      </div>
    </div>
  );
}
