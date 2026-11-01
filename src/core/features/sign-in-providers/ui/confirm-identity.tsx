import { useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";

/** Fresh email proof, asked for in place: the link goes to the owner's own address and the pane stays as it is. */
export function ConfirmIdentity() {
  const [phase, setPhase] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setPhase("sending"); setError(null);
    try {
      await appApi("/auth/step-up", { method: "POST", body: JSON.stringify({ action: "providers:relink", returnTo: "/app/settings#sign-in" }) });
      setPhase("sent");
    } catch {
      setError("The link could not be sent. Try again.");
      setPhase("idle");
    }
  }
  return <section className="data-card tool-step" aria-label="Confirm your identity">
    {phase === "sent"
      ? <p role="status">We emailed you a link. Open it in this browser, then come back to this tab.</p>
      : <>
        <p>Confirm it's you before changing sign-in.</p>
        <div className="form-actions"><Button type="button" variant="secondary" disabled={phase === "sending"} onClick={() => void send()}>{phase === "sending" ? "Sending…" : "Confirm my identity"}</Button></div>
      </>}
    {error && <FormError>{error}</FormError>}
  </section>;
}
