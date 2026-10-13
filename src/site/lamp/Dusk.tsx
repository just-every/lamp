import './dusk.css';

// The dim room: the page's background under the first screen, behind the header, the lamp and the hero text, which are
// drawn above it in their own colours. The lamp's light lifts it from the bulb outward (dusk.css, timeline.css).
export function Dusk() {
  return <div className="lamp-dusk" aria-hidden="true" />;
}
