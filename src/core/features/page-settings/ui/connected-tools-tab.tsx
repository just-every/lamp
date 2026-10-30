import { AlertsBody } from "../../intake/ui/alerts-page";
import { AlertRulesSettings } from "../../intake/ui/alert-rules";
import { ChannelsCard } from "../../channels/ui/channels-card";
import { ChatLinksPanel } from "../../chat-desk/ui/chat-links-panel";
import { SocialSettings } from "../../social/ui/social-settings";

/** Settings › Connected tools: alerts in from monitoring tools, updates out to chat and social accounts, then what
 * alerts may do. `#alerts`, the old Alert rules tab and the target of the tools' own link, lands on the rules. */
export function ConnectedToolsTab() {
  return <>
    <AlertsBody />
    <ChannelsCard />
    <ChatLinksPanel />
    <SocialSettings />
    <div id="alerts" className="page-stack"><AlertRulesSettings /></div>
  </>;
}
