import { Link } from "wouter";

export default function Terms() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-display font-bold">Terms of Service</h1>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Back
          </Link>
        </div>
        <div className="space-y-6 rounded-2xl border border-white/10 bg-card/70 p-6 text-sm leading-6">
          <section>
            <h2 className="mb-2 text-lg font-semibold">Use of Service</h2>
            <p>
              SingBetter is provided for personal practice and coaching insights. You are
              responsible for the content you upload and must have rights to use it.
            </p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold">Accounts and Security</h2>
            <p>
              Keep your login credentials private. You are responsible for activity under your account.
            </p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold">Data and Availability</h2>
            <p>
              We work to keep the app available and your data protected, but availability is not guaranteed.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
