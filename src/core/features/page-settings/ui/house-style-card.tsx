import { useEffect, useState } from "react";

import type { HouseStyleView } from "../../house-style";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";

export type HouseStyleResponse = { houseStyle: HouseStyleView };

/** The house style's own state, as Settings names it: making, ready, failed or unavailable, each with its reason. */
export function houseStyleState(view: HouseStyleView): { state: "making" | "ready" | "failed" | "unavailable" | "none"; reason: string | null } {
  const record = view.record;
  if (!view.connected) return record?.made
    ? { state: "ready", reason: "Lamp can't make it again: this install isn't connected to Workers AI." }
    : { state: "unavailable", reason: "Lamp makes house styles with Workers AI, which this install isn't connected to yet." };
  if (record?.state === "making") return { state: "making", reason: null };
  if (record?.state === "failed") return { state: "failed", reason: record.reason };
  if (record?.state === "refused") return { state: "unavailable", reason: record.reason };
  return record?.made ? { state: "ready", reason: null } : { state: "none", reason: null };
}

const stateWords = { making: "Being made", ready: "Ready", failed: "Couldn't be made", unavailable: "Unavailable", none: "Not made yet" } as const;

/** The house style's picture, object, palette and when and how it was made, with Make again. */
export function HouseStyleCard({ view, chosen, onChanged }: { view: HouseStyleView; chosen: boolean; onChanged: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const made = view.record?.made ?? null;
  const { state, reason } = houseStyleState(view);
  useEffect(() => { if (state !== "making") setAsking(false); }, [state]);

  async function makeAgain() {
    setAsking(true); setMessage(null);
    try {
      await appApi<HouseStyleResponse>("/api/app/house-style/make-again", { method: "POST" });
      onChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Lamp couldn't make it again.");
      setAsking(false);
    }
  }

  const palette = made ? [["Ink", made.palette.ink], ["Soft ink", made.palette.inkSoft], ["Stone", made.palette.stone], ["Paper", made.palette.paper], ...(made.palette.accent ? [["Accent", made.palette.accent]] : [])] : [];
  return <div className="template-house" data-state={state}>
    <p className="template-house-title">House style</p>
    {made ? <figure className="template-house-picture" style={{ background: made.palette.stone }}><img src={`/api/app/house-style/picture?v=${encodeURIComponent(made.picture.key)}`} alt={`Your page's picture: ${made.subject.object}`} width={made.picture.width} height={made.picture.height} /></figure> : null}
    <dl className="template-house-facts">
      <div><dt>State</dt><dd>{stateWords[state]}{reason ? <span className="template-house-reason">{reason}</span> : null}</dd></div>
      {made ? <>
        <div><dt>Object</dt><dd>{made.subject.object}<span className="template-house-reason">{made.subject.why}</span></dd></div>
        <div><dt>Palette</dt><dd><ul className="template-house-palette">{palette.map(([name, hex]) => <li key={name}><i style={{ background: hex }} aria-hidden="true" />{name} {hex}</li>)}</ul></dd></div>
        <div><dt>Made</dt><dd>{new Date(made.madeAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} with {made.modelName}</dd></div>
      </> : null}
    </dl>
    {chosen && view.connected ? <div className="template-house-actions">
      <Button type="button" variant="secondary" onClick={makeAgain} disabled={asking || state === "making"}>{state === "making" ? "Making…" : "Make again"}</Button>
      <small>{view.picturesLeft} picture{view.picturesLeft === 1 ? "" : "s"} left today.{made ? " Your page keeps its house style until a new one is ready." : ""}</small>
    </div> : null}
    {message ? <p className="save-message" role="alert">{message}</p> : null}
  </div>;
}
