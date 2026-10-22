// The incident page's composer and the new-incident screen, by their accessible names.
// What still works, Details, Notify, Publish timing, Relationship and Templates sit
// behind "More options"; notes, review, correction, impact and deletion behind
// "Private actions". Open either before using what is inside.
async function expand(page, name) {
  const toggle = page.getByRole("button", { name, exact: true });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
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
    moreOptions: () => expand(page, "More options"),
    privateActions: () => expand(page, "Private actions"),
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
    moreOptions: () => expand(page, "More options"),
  };
}
