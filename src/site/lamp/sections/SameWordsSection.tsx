import { AtomPlate } from '../plates/AtomPlate';
import { BannerPlate } from '../plates/BannerPlate';
import { EmailPlate } from '../plates/EmailPlate';
import { SectionText } from './SectionText';
import './section.css';
import './same-words.css';

// Section 2: the feed entry, the site banner and the email cascade back to front, one highlighted line through all three.
export function SameWordsSection() {
  return <section data-moment id="updates" className="lamp-section lamp-same" aria-labelledby="lamp-same-title">
    <SectionText id="lamp-same-title" eyebrow="Updates" title="Say it once, everywhere." className="lamp-section__text--side lamp-same__text">
      <p className="lamp-section__sentence">Page, email, site banner and feed carry the same words.</p>
    </SectionText>
    <div className="lamp-section__plates lamp-same__cluster">
      <AtomPlate />
      <BannerPlate />
      <EmailPlate />
    </div>
  </section>;
}
