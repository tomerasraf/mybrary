"use client";

import { useState } from "react";

export default function UnlockPage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (res.ok) window.location.href = "/";
      else if (res.status === 429) setError("Too many wrong tries. Wait 10 minutes.");
      else setError("That's not it.");
    } catch {
      setError("Couldn't reach the app. Is it running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="unlock">
      <form onSubmit={unlock}>
        <div className="unlock-bubble" aria-hidden />
        <input
          className="unlock-field"
          placeholder="passcode"
          type="password"
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          aria-label="Passcode"
        />
        <button className="pill" disabled={busy || !passcode}>
          {busy ? "…" : "come in"}
        </button>
        {error && <p className="unlock-error">{error}</p>}
      </form>
    </main>
  );
}
