import type { PublishingDraft } from "../repository";

function revealSource(ref: string) {
  const item = document.getElementById(`brief-${ref}`);
  item?.closest("details.incident-brief")?.setAttribute("open", "");
  item?.querySelector("details")?.setAttribute("open", "");
}

/** Agent provenance is private composer context, separate from public update
 * wording. An operator reviews the draft and chooses whether to publish. */
export function PreparedDraft({ preparation }: { preparation: PublishingDraft["agentPreparation"] }) {
  if (!preparation) return null;
  return <section id="prepared-draft" className="context-section" aria-label="Lamp-prepared draft">
    <h3>Prepared by Lamp</h3>
    <p>Review this private draft before publishing. Your committed next-update time has not changed.</p>
    {preparation.noEvidenceChange ? <p>No new evidence has been recorded since the last published update.</p> : <>
      <p>Evidence recorded since the last published update:</p>
      <ul>{preparation.evidence.map(item => <li key={item.ref} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.text} <a href={`#brief-${item.ref}`} onClick={() => revealSource(item.ref)}>[{item.ref}]</a></li>)}</ul>
    </>}
    <p className="field-sources">Sources: {preparation.citations.map((ref, index) => <span key={ref}>{index ? ", " : ""}<a href={`#brief-${ref}`} onClick={() => revealSource(ref)}>[{ref}]</a></span>)}</p>
  </section>;
}
