import { Dusk } from './Dusk';
import { IntroReady } from './IntroReady';
import { LampRig } from './LampRig';
import { docsUrl, runAction } from './repository';
import './intro.css';
import './timeline.css';

// The intro, design C: the headline, subline and two ways in are on the page from the first frame, on a dim background.
// The pendant settles on its cord and clicks on, and its warm light spreads from the bulb, lifting the dim to the lit page.
// The timeline holds at its start until IntroReady marks the lamp's drawings ready (`data-ready`), or lights the room
// without the lamp if they are slow (`data-late`).
export function Intro() {
  return <section className="lamp-intro" aria-labelledby="lamp-title">
    <Dusk />
    <LampRig />
    <IntroReady />
    <h1 id="lamp-title" className="lamp-intro__title"><span>When something breaks,</span> <span>turn the light on.</span></h1>
    <p className="lamp-intro__lede">The status page that never leaves your customers in the dark.</p>
    <p className="lamp-intro__actions"><a className="lamp-pill lamp-pill--large" href={runAction.href}>{runAction.label}</a><a className="lamp-docs-link" href={docsUrl}>Read the docs</a></p>
  </section>;
}
