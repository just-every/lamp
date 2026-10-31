import { Link } from "@tanstack/react-router";

import { Icon } from "../../../app/client/ui/icon";
import { PageDataCard } from "../../page-export/ui/page-data-card";
import { ImportDoorSetting } from "./import-door-setting";

/** Settings › Export and restore: bringing data in (Move in and Business imports) and taking it out or back. */
export function ExportSettingsTab() {
  return <>
    <section className="data-card intake-link-card"><p className="card-kicker">Moving here</p><h2>Move in</h2><p>Bring components, incident history, maintenance and subscribers, with a dry run first and undo after.</p><ImportDoorSetting /><Link className="text-link" to="/app/move-in">Start a move-in <Icon name="arrow" width={16} height={16} /></Link><a className="text-link" href="/app/cutover">Cutover preview</a></section>
    <PageDataCard />
  </>;
}
