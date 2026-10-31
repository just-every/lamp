// The incident page's composer and the new-incident screen, by their accessible names.
// What still works, Details (and a new incident's Opened at) join the fields from the + ("Update options");
// Notify, Schedule, Backdate, Relationship, the templates and a correction open their panel under the Publish
// row. Notes, impact, the report, the communication owner and the incident's subscribers are rows of the
// incident panel. Choose the entry, or open the row, before using what is inside.
async function choose(page, entry) {
  const plus = page.getByRole("button", { name: "Update options", exact: true });
  if (await plus.getAttribute("aria-expanded") !== "true") await plus.click();
  await page.getByRole("menuitem", { name: new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
}
async function openRow(page, name) {
  const row = page.getByRole("button", { name, exact: true });
  if (await row.getAttribute("aria-expanded") !== "true") await row.click();
}

export function incidentComposer(page) {
  return {
    impact: page.getByLabel("What’s happening?", { exact: true }),
    audience: page.getByLabel("Who is affected", { exact: true }),
    stillWorks: page.getByLabel("What still works", { exact: true }),
    details: page.getByLabel("Details", { exact: true }),
    nextUpdate: page.getByLabel("Next update date and time", { exact: true }),
    publish: page.getByRole("button", { name: "Publish update", exact: true }),
    status: () => page.locator('input[name="lifecycle"]:checked').inputValue(),
    setStatus: (lifecycle) => page.getByRole("radio", { name: lifecycle, exact: true }).check(),
    option: (entry) => choose(page, entry),
    row: (name) => openRow(page, name),
  };
}

// The new-incident screen: title, impact, components, audience, next update, Publish.
export function newIncidentForm(page) {
  return {
    title: page.getByLabel("Incident title", { exact: true }),
    impact: page.getByLabel("Customer impact", { exact: true }),
    audience: page.getByLabel("Who is affected", { exact: true }),
    addComponent: (label) => page.getByLabel("Add component", { exact: true }).selectOption({ label }),
    componentState: (name, state) => page.getByLabel(`${name} state with this update`, { exact: true }).selectOption(state),
    nextUpdate: page.getByLabel("Next update date and time", { exact: true }),
    publish: page.getByRole("button", { name: "Publish", exact: true }),
    option: (entry) => choose(page, entry),
  };
}
