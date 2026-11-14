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
      else setError("Wrong passcode. Try again.");
    } catch {
      setError("Couldn't reach TimeFlow.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: "14vh" }}>
      <form className="stack" style={{ gap: 18 }} onSubmit={unlock}>
        <h1>Welcome home</h1>
        <input
          className="field"
          placeholder="Passcode"
          type="password"
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          aria-label="Passcode"
        />
        <button className="light" style={{ alignSelf: "flex-start" }} disabled={busy || !passcode}>
          {busy ? "Checking…" : "Come in"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
