// How long the intro holds, dim, for the lamp's drawings after the first frame before the room is lit without them.
export const HOLD_MS = 1000;

// Where the intro has got to, kept on the window so it outlives the intro's element: when the timeline started
// playing (`at`, a performance.now() time, 0 while held), whether the drawings are ready and the hold ran out, and
// whether a keyboard focus has shown the whole hero.
type IntroState = { intro: Element; at: number; ready: boolean; late: boolean; shown: boolean };
declare global { interface Window { lampIntro?: IntroState } }

// Runs as the document is parsed, straight after the rig, so the intro starts as soon as the lamp's drawings are decoded. Once the three drawings (the lamp
// unlit and lit, and the bulb's glow) have decoded, or failed, it marks the intro `data-ready` and the click-on plays.
// If they are still loading HOLD_MS after the first frame, it marks the intro `data-late`: the room lights without the
// lamp, and the lamp appears, already lit, only when its drawings arrive (timeline.css). The first keyboard focus anywhere
// on the page (a focus that shows its ring) marks the intro `data-shown` for good: the dusk lifts at once, and it stays
// lifted when that focus ends, so nothing replays. The listener is on the document.
// The marks go on whichever intro is on the page when they are made.
const script = `(() => {
  const intro = document.currentScript.parentElement;
  const images = [...intro.querySelectorAll('.lamp-rig img')];
  const state = window.lampIntro = { intro, at: 0, ready: false, late: false, shown: false };
  const mark = (name) => document.querySelector('.lamp-intro').setAttribute('data-' + name, '');
  let hold = 0;
  const show = (event) => {
    if (!event.target.matches?.(':focus-visible')) return;
    state.shown = true;
    mark('shown');
    document.removeEventListener('focusin', show);
  };
  document.addEventListener('focusin', show);
  Promise.allSettled(images.map((image) => image.decode())).then(() => {
    state.ready = true;
    state.at ||= performance.now();
    clearTimeout(hold);
    mark('ready');
  });
  requestAnimationFrame(() => {
    if (!state.ready) hold = setTimeout(() => { state.late = true; state.at = performance.now(); mark('late'); }, ${HOLD_MS});
  });
})();`;

export function IntroReady() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
