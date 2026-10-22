import { useEffect } from "react";

import type { PageSettingsInput } from "../../../shared/schemas";
import { houseStyleShowing, type HouseStyleShowing } from "../../house-style/showing";
import { useAppData } from "../../../app/client/ui/api";
import { HouseStyleCard, type HouseStyleResponse } from "./house-style-card";

type Template = NonNullable<PageSettingsInput["template"]>;
const templates: Array<{ value: Template; name: string; description: string }> = [
  { value: "house", name: "House style", description: "Your own object, lit, over one calm sentence, in your site's colours. Lamp makes it once from your website." },
  { value: "default", name: "Default", description: "The original Lamp status page." },
  { value: "calm", name: "Calm headline", description: "One quiet sentence, with components and history beneath it." },
  { value: "uptime", name: "Uptime-history-led", description: "Overall uptime and a shared 90-day component history." },
  { value: "regions", name: "Regions map", description: "A world map and region filters for your components." },
];

/** Which template the public page shows and why: the same reasons, as the same kinds, that its foot gives. */
function shownLine(showing: Template, regionsAvailable: boolean, house: HouseStyleShowing, view: HouseStyleResponse["houseStyle"] | null) {
  if (showing === "house" && house.shown) {
    const record = view?.record;
    const again = record?.state === "making" ? " A new picture is being made; the page keeps this one until it is ready."
      : record?.state === "failed" ? ` The last re-make failed, so the page keeps this one. ${record.reason ?? ""}`
      : record?.state === "refused" ? ` ${record.reason ?? ""} The page keeps this one.` : "";
    return `Showing House style: you chose it.${again}`.trim();
  }
  if (house.reason === "not-connected") return showing === "house"
    ? "Showing Calm headline: House style is made with Workers AI, which this install isn't connected to yet."
    : "Showing Calm headline. House style isn't available: this install isn't connected to Workers AI yet.";
  if (house.reason === "making") return "Showing Calm headline while your house style is being made.";
  if (house.reason === "failed") return `Showing Calm headline: your house style couldn't be made. ${house.detail ?? ""}`.trim();
  if (house.reason === "refused") return `Showing Calm headline until your house style can be made. ${house.detail ?? ""}`.trim();
  if (showing === "regions" && !regionsAvailable) return "Showing Calm headline: you chose Regions map, and it needs public components in at least two regions.";
  return `Showing ${templates.find(template => template.value === showing)!.name}: ${showing === "default" ? "it is your saved default" : "you chose it"}.`;
}

export function TemplateChoice({ value, showing, regionsAvailable, onChange }: {
  value: Template; showing: Template; regionsAvailable: boolean; onChange: (value: Template) => void;
}) {
  const houseStyle = useAppData<HouseStyleResponse>("/api/app/house-style");
  const view = houseStyle.data?.houseStyle ?? null;
  const house = houseStyleShowing(showing, view?.connected ?? false, view?.record ?? null);
  const making = view?.record?.state === "making";
  const { refresh } = houseStyle;
  // A make runs out of the request; the card follows it in place until it settles, and after every save.
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [making, refresh]);
  useEffect(() => {
    window.addEventListener("lamp:page-settings-changed", refresh);
    return () => window.removeEventListener("lamp:page-settings-changed", refresh);
  }, [refresh]);

  return <section className="data-card" aria-labelledby="template-title">
    <p className="card-kicker" id="template-title">Template</p>
    <p role="status" data-reason={view ? house.reason ?? undefined : undefined}>{shownLine(showing, regionsAvailable, house, view)}</p>
    <label className="form-label">Template<select value={value} onChange={event => onChange(event.target.value as Template)} aria-describedby="template-description template-regions-reason">
      {templates.map(template => <option key={template.value} value={template.value} disabled={template.value === "regions" && !regionsAvailable && showing !== "regions"}>{template.name}</option>)}
    </select><small id="template-description">{templates.find(template => template.value === value)?.description} Save settings to publish your choice.</small></label>
    <p id="template-regions-reason">{regionsAvailable ? "Regions map is available: your public components are in more than one region." : "Regions map needs public components in at least two regions. Give your components a region in the component editor to use it."}</p>
    {view && (value === "house" || showing === "house") ? <HouseStyleCard view={view} chosen={showing === "house"} onChanged={refresh} /> : null}
  </section>;
}
