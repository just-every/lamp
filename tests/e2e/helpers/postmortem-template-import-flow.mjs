import assert from "node:assert/strict";

const publishedText = "CONTINUITY-PUBLISHED-REPORT";
const privateText = "CONTINUITY-PRIVATE-REPORT";
const templateText = "CONTINUITY-PRIVATE-TEMPLATE";
const largeDetails = `${"Full wording survives import. ".repeat(40)}END-OF-OVERSIZED-WORDING`;
const reportTail = `${"Detailed recovery evidence. ".repeat(800)}END-OF-FULL-REPORT`;
const publication = "2026-01-23T12:00:00.000Z";

/** Synthetic network-edge records, kept within the existing Statuspage cases. */
export function continuityFiles(original, { oversized = false } = {}) {
  const files = original.map(file => ({ ...file, text: file.text.replaceAll("i000000000", "continuityi").replaceAll("c000000000", "continuityc").replaceAll("s000000000", "continuitys").replaceAll("subscriber", "continuitysubscriber").replaceAll("https://stspg.io/", "https://stspg.io/continuity-") }));
  const file = files.find(file => file.name === "incidents.json");
  const incidents = JSON.parse(file.text);
  incidents[0].impact = "critical";
  incidents[0].postmortem_body = `# ${publishedText}\n\nFirst paragraph with **every word** &amp; an &eacute; entity.\n\n- First list item\n- Second list item\n\n[Review recovery](https://example.com/recovery)\n\n![Recovery chart](https://images.example.com/never-fetch.png)\n\n<p>HTML paragraph <a href="https://example.com/html">HTML link wording</a>.</p><h2>Final heading</h2><ol><li>Final list wording</li></ol>\n\n${reportTail}`;
  incidents[0].postmortem_published_at = publication;
  incidents[0].postmortem_notify_subscribers = true;
  incidents[1].postmortem_body = `<p>${privateText}</p><p>Private cause and remediation.</p>`;
  incidents[1].postmortem_published_at = null;
  file.text = JSON.stringify(incidents);
  const components = JSON.parse(files.find(file => file.name === "components.json").text);
  const group = { id: "continuityfolder", name: "Customer communication" };
  files.push({ name: "incident-template-groups.json", text: JSON.stringify([group]) });
  files.push({ name: "incident-templates.json", text: JSON.stringify([0, 1, 2].map(index => ({
    id: `continuitytemplate${index}`, name: `Continuity template ${index + 1}`, title: `Private imported title ${index + 1}`,
    body: `${templateText} ${index + 1}\n\n${oversized && index === 2 ? largeDetails : `Follow-up details ${index + 1}.`}`,
    group_id: group.id, group, update_status: ["investigating", "identified", "monitoring"][index], should_send_notifications: index === 0,
    components: [{ id: components[index % components.length].id, status: ["degraded_performance", "partial_outage", "major_outage"][index] }],
  }))) });
  return files;
}

export function assertContinuityCounts(report) {
  assert.equal(report.counts.postmortem.read, 2);
  assert.equal(report.counts.postmortem.imported, 1);
  assert.equal(report.counts.postmortem["kept-private"], 1);
  assert.equal(report.counts.postmortem.rejected, 0);
  assert.equal(report.counts.template.read, 3);
  assert.equal(report.counts.template.imported + report.counts.template.changed, 3);
}

export async function postmortemTemplateImportFlow({ api, request, importAll, moveIn, original, publicOrigin, preserveEdits = false, fetcher = globalThis.fetch }) {
  const fetch = fetcher;
  const files = continuityFiles(original, { oversized: preserveEdits });
  const templatesBefore = (await api("/api/app/incident-templates")).body.templates.length;
  const preview = await moveIn.preview({ files });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assertContinuityCounts(preview.body.report);
  if (!preserveEdits) assert.equal(preview.body.report.counts.template.imported, 3);
  if (preserveEdits) assert.ok(preview.body.report.items.some(item => item.name === "Continuity template 3" && /details.*shorten|shorten.*details/iu.test(item.reason)));
  assert.equal((await api("/api/app/incident-templates")).body.templates.length, templatesBefore, "dry run writes no templates");
  // A refused child report must not discard its valid incident.
  const invalid = files.map(file => ({ ...file }));
  const incidentFile = invalid.find(file => file.name === "incidents.json");
  const invalidRows = JSON.parse(incidentFile.text); invalidRows[0].postmortem_published_at = "invalid"; incidentFile.text = JSON.stringify(invalidRows);
  const refused = await moveIn.preview({ files: invalid });
  assert.equal(refused.status, 200, JSON.stringify(refused.body));
  assert.equal(refused.body.report.counts.postmortem.rejected, 1);
  assert.equal(refused.body.report.counts.incident.rejected, 0);
  const { result } = await importAll(files);
  assertContinuityCounts(result.report);
  const incidents = (await api("/api/app/incidents")).body.incidents;
  const redirect = await fetch(`${publicOrigin}/incidents/continuityi1`, { redirect: "manual" });
  const draftRedirect = await fetch(`${publicOrigin}/incidents/continuityi2`, { redirect: "manual" });
  assert.equal(redirect.status, 301);
  assert.equal(draftRedirect.status, 301);
  const permalink = redirect.headers.get("Location");
  const published = incidents.find(row => `/incidents/${row.reference}` === permalink);
  const draftIncident = incidents.find(row => `/incidents/${row.reference}` === draftRedirect.headers.get("Location"));
  const readReport = async id => (await api(`/api/app/incidents/${id}/report`)).body.report;
  const report = await readReport(published.id);
  assert.equal(report.publishedAt, publication);
  for (const word of [publishedText, "every word", "é entity", "First list item", "Second list item", "Review recovery", "https://example.com/recovery", "Recovery chart", "https://images.example.com/never-fetch.png", "HTML paragraph", "HTML link wording", "https://example.com/html", "Final heading", "Final list wording", reportTail]) assert.ok(report.summary.includes(word), word);
  assert.deepEqual([report.timeline, report.cause, report.remediation], ["", "", ""]);
  assert.equal((await readReport(draftIncident.id)).publishedAt, null);
  assert.ok((await readReport(draftIncident.id)).summary.includes(privateText));
  const templates = (await api("/api/app/incident-templates")).body.templates.filter(row => row.name.startsWith("Continuity template"));
  assert.equal(templates.length, 3);
  const first = templates.find(row => row.name === "Continuity template 1");
  assert.equal(first.folder, "Customer communication");
  assert.equal(first.title, "Private imported title 1");
  assert.equal(first.shouldSendNotifications, true);
  assert.equal(first.nextUpdateOffsetMinutes, null);
  assert.equal(first.components[0].state, "Degraded performance");
  assert.equal(first.customerImpact, `${templateText} 1`);
  // Source severity stays separate from the explicit partial-outage claims.
  assert.equal(published.impactOverride, "critical");
  const html = await (await fetch(`${publicOrigin}${permalink}`)).text();
  assert.ok(html.includes(publishedText), "published postmortem is in the script-free HTML");
  assert.doesNotMatch(html, /<img[^>]+never-fetch/iu);
  for (const path of ["/api/v2/incidents.json", "/api/public/v1/incidents"]) {
    const response = await fetch(`${publicOrigin}${path}`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(publishedText), `${path} carries the published report`);
  }
  for (const path of ["/", permalink, `/incidents/${draftIncident.reference}`, "/history/", "/feed.atom", "/feed.rss", "/api/v2/summary.json", "/api/v2/incidents.json", "/api/v2/incidents/unresolved.json", "/api/v2/incidents/resolved.json", "/api/public/v1/incidents", "/api/public/status"]) {
    const body = await (await fetch(`${publicOrigin}${path}`)).text();
    assert.equal(body.includes(privateText), false, `${path} keeps the draft report private`);
    assert.equal(body.includes(templateText), false, `${path} keeps templates private`);
  }
  const unchanged = await moveIn.preview({ files });
  assert.equal(unchanged.body.report.state, "already imported");
  const repeated = await moveIn.apply(unchanged.body);
  assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
  assert.equal((await api("/api/app/incident-templates")).body.templates.length, templatesBefore + 3);
  const applied = await request(`/api/app/incidents/${published.id}/templates/${first.id}/apply`, { method: "POST", headers: { "If-Match": `-:${published.updates.length}` }, json: {} });
  assert.equal(applied.status, 200, await applied.clone().text());
  const filled = await applied.json();
  assert.equal(filled.draft.customerImpact, first.customerImpact);
  assert.equal(filled.draft.details, first.details);
  assert.equal(filled.draft.nextUpdateAt, null);
  assert.ok(filled.draft.componentChanges.some(change => change.componentId === first.components[0].componentId && change.state === first.components[0].state));
  assert.equal((await api(`/api/app/incidents/${published.id}`)).body.incident.updates.length, published.updates.length, "applying an imported template publishes nothing");
  if (preserveEdits) {
    const overflow = templates.find(row => row.name === "Continuity template 3");
    assert.equal(overflow.details, largeDetails, "whole oversized wording survives");
    assert.ok(overflow.fieldsToShorten.includes("details"));
    const blocked = await request(`/api/app/incidents/${draftIncident.id}/templates/${overflow.id}/apply`, { method: "POST", headers: { "If-Match": `-:${draftIncident.updates.length}` }, json: {} });
    assert.equal(blocked.status, 409, await blocked.clone().text());
    const saved = await request(`/api/app/incident-templates/${overflow.id}`, { method: "PUT", json: { details: "Shortened by the operator." } });
    assert.equal(saved.status, 200, await saved.clone().text());
    const shortened = await request(`/api/app/incidents/${draftIncident.id}/templates/${overflow.id}/apply`, { method: "POST", headers: { "If-Match": `-:${draftIncident.updates.length}` }, json: {} });
    assert.equal(shortened.status, 200, await shortened.clone().text());
    assert.equal((await shortened.json()).draft.details, "Shortened by the operator.");
    const reportSaved = await request(`/api/app/incidents/${draftIncident.id}/report`, { method: "PUT", json: { summary: `${privateText} edited here`, timeline: "Reviewed timeline", cause: "Reviewed cause", remediation: "Reviewed actions" } });
    assert.equal(reportSaved.status, 200, await reportSaved.clone().text());
  }
  const undone = await moveIn.undo(result.door);
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(undone.body.job.state, "undone");
  assert.equal((await api("/api/app/incident-templates")).body.templates.length, templatesBefore + Number(preserveEdits));
  assert.equal(await readReport(published.id), null, "untouched report is removed with its incident");
  assert.equal((await readReport(draftIncident.id))?.summary ?? null, preserveEdits ? `${privateText} edited here` : null);
  if (preserveEdits) {
    const kept = (await api("/api/app/incident-templates")).body.templates.find(row => row.name === "Continuity template 3");
    assert.equal(kept.details, "Shortened by the operator.");
    const componentIds = new Set((await api("/api/app/components")).body.components.map(row => row.id));
    assert.ok(kept.components.every(component => componentIds.has(component.componentId)), "retained templates keep the components they need");
    for (const kind of ["incident", "template", "component"]) assert.ok(undone.body.undo.dispositions.some(row => row.targetKind === kind && row.disposition === "retained"), `edited report/template retains ${kind}`);
  }
}
