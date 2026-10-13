import { Intro } from './Intro';
import { SiteHeader } from './SiteHeader';
import { BuiltInSection } from './sections/BuiltInSection';
import { CloseSection } from './sections/CloseSection';
import { GlanceSection } from './sections/GlanceSection';
import { MaintenanceSection } from './sections/MaintenanceSection';
import { OwnershipSection } from './sections/OwnershipSection';
import { RecordSection } from './sections/RecordSection';
import { ResilienceSection } from './sections/ResilienceSection';
import { SameWordsSection } from './sections/SameWordsSection';
import { SiteFooter } from './sections/SiteFooter';
import { SubscribersSection } from './sections/SubscribersSection';
import { PageMotion } from './PageMotion';
import './page.css';
import './reveal/reveal.css';

// The Lamp product landing page, in the owner-approved modern design C (2026-10-09), the run site's home page. The intro hangs the pendant over
// the page, switches it on and reveals the headline, the subline and the two ways in; scrolling hands the lamp back to
// the header mark. Below it, eight sections show the product through cards of its real UI, on one 12-column grid, then
// the close and the footer.
// Every style is scoped to .lamp-home, so nothing leaks into the operator app.
export default function LampHome() {
  return <div className="lamp-home">
    <a className="lamp-skip" href="#lamp-main">Skip to content</a>
    <SiteHeader variant="site" />
    <main id="lamp-main">
      <Intro />
      <GlanceSection />
      <SameWordsSection />
      <ResilienceSection />
      <SubscribersSection />
      <RecordSection />
      <MaintenanceSection />
      <BuiltInSection />
      <OwnershipSection />
      <CloseSection />
    </main>
    <SiteFooter />
    <PageMotion />
  </div>;
}
