import { docsUrl, runAction } from '../repository';
import { StaticLamp } from './StaticLamp';
import { LampPool } from './LampPool';
import './section.css';
import './close.css';

// The close mirrors the hero: the intro's pendant, lit and still, hangs on its cord from a hairline ceiling over the
// last line, its reason, and both ways in.
export function CloseSection() {
  return <section data-moment className="lamp-section lamp-close" aria-labelledby="lamp-close-title">
    <StaticLamp className="lamp-close__lamp" />
    <div className="lamp-close__text">
      <LampPool className="lamp-close__pool" />
      <h2 id="lamp-close-title" className="lamp-close__title">Hang the lamp before you need it.</h2>
      <p className="lamp-section__sentence lamp-close__sentence">Set it up on a calm day. It’s ready for the bad one.</p>
      <p className="lamp-close__actions"><a className="lamp-pill lamp-pill--large" href={runAction.href}>{runAction.label}</a><a className="lamp-docs-link" href={docsUrl}>Read the docs</a></p>
    </div>
  </section>;
}
