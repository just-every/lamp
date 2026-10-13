// The landing page is static HTML on the run site, so what moves as the visitor scrolls runs from this one script, last
// in the page, before first paint, like the intro's (IntroReady.tsx). Without it, or without motion, the page is simply
// its final, lit state.
//
// The scroll handoff, measured on the lamp itself and written to the page through the CSSOM. The big lamp hangs in the
// intro and scrolls at page speed; the handoff runs from s0, where its cord grip (213/1560 down its canvas) meets the
// header's bottom edge, to s1, where its bulb's bottom (0.7686) passes it, so the header mark drops in exactly while the
// lamp goes up into the ceiling. `--lamp-p` is that progress, 0 to 1; `--lamp-backing`, the header backing's opacity, is
// whole by s0, so the lamp always passes under a whole backing; `--lamp-scroll` is the scroll, up to one screen, so the
// intro's burst of light still reaches the far corner of the screen when a visitor scrolls during the click-on. One
// passive scroll listener schedules at most one write per animation frame; a ResizeObserver re-measures. Nothing
// transforms the lamp's box, so the layout gives its resting place.
//
// The moments below the hero ([data-moment]): a moment's state lives in its data-reveal attribute, which reveal.css and
// each section's CSS read. No attribute is the final state: no script, reduced motion, a moment already above the reveal
// line (85% down the viewport) when the script runs, and every moment once it has played or been focused. `wait` holds
// its moving parts at their first frame below the line; `play` runs each part's one short animation once the moment
// crosses it, after which the attribute is removed, and a focus that enters a waiting or playing moment removes it at
// once, so nothing that has been seen is hidden again and nothing replays.
//
// The footer index glides to its section where motion is welcome, never by CSS scroll-behavior, which would also slow
// every scroll the page makes itself, and moves focus to the section's headline as a native jump would.
const script = `(() => {
  const page = document.currentScript.closest('.lamp-home');
  const motion = () => window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  const stage = page.querySelector('.lamp-intro'), lamp = page.querySelector('.lamp-rig__lamp'), header = page.querySelector('.lamp-header');
  if (stage && lamp && header) {
    let s0 = 0, s1 = 1, frame = 0;
    const measure = () => {
      const top = stage.getBoundingClientRect().top + window.scrollY + lamp.offsetTop, ceiling = header.offsetHeight;
      s0 = top + lamp.offsetHeight * (213 / 1560) - ceiling;
      s1 = Math.max(s0 + 1, top + lamp.offsetHeight * 0.7686 - ceiling);
    };
    const write = () => {
      frame = 0;
      const y = window.scrollY;
      page.style.setProperty('--lamp-p', Math.min(1, Math.max(0, (y - s0) / (s1 - s0))).toFixed(4));
      page.style.setProperty('--lamp-backing', Math.min(1, y / Math.max(1, s0)).toFixed(4));
      page.style.setProperty('--lamp-scroll', Math.round(Math.min(y, window.innerHeight)) + 'px');
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(write); };
    const resize = new ResizeObserver(() => { measure(); schedule(); });
    resize.observe(stage);
    resize.observe(header);
    window.addEventListener('scroll', schedule, { passive: true });
  }
  if (typeof window.IntersectionObserver === 'function' && motion()) {
    const waiting = new Map();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const play = waiting.get(entry.target);
        waiting.delete(entry.target);
        observer.unobserve(entry.target);
        play?.();
      }
    }, { rootMargin: '0px 0px -15% 0px' });
    for (const node of page.querySelectorAll('[data-moment]')) {
      if (node.getBoundingClientRect().top < window.innerHeight * 0.85) continue;
      const end = () => { waiting.delete(node); observer.unobserve(node); node.removeEventListener('focusin', end); node.removeAttribute('data-reveal'); };
      node.setAttribute('data-reveal', 'wait');
      waiting.set(node, () => {
        node.setAttribute('data-reveal', 'play');
        Promise.allSettled(node.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => {
          if (node.getAttribute('data-reveal') === 'play') end();
        });
      });
      observer.observe(node);
      node.addEventListener('focusin', end);
    }
  }
  for (const link of page.querySelectorAll('.lamp-footer__index a[href^="#"]')) link.addEventListener('click', (event) => {
    const target = document.getElementById(link.hash.slice(1));
    if (!target || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !motion()) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.pushState(null, '', link.hash);
    const heading = document.getElementById(target.getAttribute('aria-labelledby') ?? '');
    (heading ?? target).focus({ preventScroll: true });
  });
})();`;

export function PageMotion() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
