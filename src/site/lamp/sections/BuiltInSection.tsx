import type { ReactNode } from 'react';
import { AlertsTile } from '../plates/AlertsTile';
import { DeliveriesTile } from '../plates/DeliveriesTile';
import { ReportTile } from '../plates/ReportTile';
import { SettingsTile } from '../plates/SettingsTile';
import { SubscribeTile } from '../plates/SubscribeTile';
import { WebhookTile } from '../plates/WebhookTile';
import { SectionText } from './SectionText';
import { TileIcon, type TileIconName } from './TileIcon';
import './section.css';
import './built-in.css';

// Each tile is its own moment, so on a phone, one tile under another, each rises as it comes into view.
function Tile({ icon, caption, children }: { icon: TileIconName; caption: string; children: ReactNode }) {
  return <li data-moment className="lamp-built__tile">
    <TileIcon name={icon} />
    <h3 className="lamp-built__caption">{caption}</h3>
    {children}
  </li>;
}

// Section 7: what else is in the product, six tiles in a 3×2 grid under a centred headline, each an icon, its caption
// and a crop of the real screen.
export function BuiltInSection() {
  return <section data-moment id="included" className="lamp-section lamp-built" aria-labelledby="lamp-built-title">
    <SectionText id="lamp-built-title" eyebrow="Also included" title="Already wired in." className="lamp-built__text" />
    <ul className="lamp-section__plates lamp-built__grid">
      <Tile icon="report" caption="Post-incident reports"><ReportTile /></Tile>
      <Tile icon="alerts" caption="Alerts in, one incident per problem"><AlertsTile /></Tile>
      <Tile icon="webhooks" caption="Signed webhooks, Slack too"><WebhookTile /></Tile>
      <Tile icon="deliveries" caption="Delivery log, no tracking"><DeliveriesTile /></Tile>
      <Tile icon="domain" caption="Your domain, your colours"><SettingsTile /></Tile>
      <Tile icon="subscribe" caption="No cookies, no CAPTCHA"><SubscribeTile /></Tile>
    </ul>
  </section>;
}
