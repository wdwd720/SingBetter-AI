import { Link } from "wouter";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-display font-bold">Privacy Policy</h1>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Back
          </Link>
        </div>
        <div className="space-y-6 rounded-2xl border border-white/10 bg-card/70 p-6 text-sm leading-6">
          <section>
            <h2 className="mb-2 text-lg font-semibold">Data Collected</h2>
            <p>
              We store account details, practice sessions, uploaded files, and coaching history needed to provide the service.
            </p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold">How Data Is Used</h2>
            <p>
              Data is used to deliver coaching features, analytics, account management, and support operations.
            </p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold">Your Controls</h2>
            <p>
              You can request access/export and account deletion from the profile privacy section.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
