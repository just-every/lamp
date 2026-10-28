import { agentActionLines } from "../incidents/agent-action";
import { renderUpdateHtml } from "../../shared/update-links";
import type { PublicIncident } from "./record-markup";

/** Published reports are literal paragraphs with the same safe HTTPS links as updates. */
export function reportMarkup(report: PublicIncident["report"]) {
  if (!report) return "";
  const fields = [["Summary", report.summary], ["Timeline", report.timeline], ["Cause", report.cause], ["Remediation", report.remediation], ...agentActionLines(report.agentAction).map(line => { const i=line.indexOf(":"); return [line.slice(0,i), line.slice(i+2)]; })];
  const sections = fields.filter(([, value]) => value!.trim()).map(([label, value]) => {
    const paragraphs = value!.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split(/\n[\t ]*\n/u)
      .filter(paragraph => paragraph.trim()).map(paragraph => `<p>${renderUpdateHtml(paragraph).replaceAll("\n", "<br>")}</p>`).join("");
    return `<div><dt>${label}</dt><dd>${paragraphs}</dd></div>`;
  }).join("");
  return sections ? `<section class="report"><p class="eyebrow">Post-incident report</p><h2>What happened and what we changed</h2><dl>${sections}</dl></section>` : "";
}
