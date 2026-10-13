import { LAMP_SIZES, lampOff, lampOn, type Sprite } from './sprites';
import './sprites.css';

function SpriteImage({ sprite, className }: { sprite: Sprite; className: string }) {
  return <picture className={className}>
    <source type="image/avif" srcSet={sprite.avif} sizes={LAMP_SIZES} />
    <img src={sprite.fallback} srcSet={sprite.webp} sizes={LAMP_SIZES} alt="" width="1560" height="1560" />
  </picture>;
}

// The lamp unlit and lit, stacked in one box: the lit drawing switches on over the unlit one.
export function LampSprites() {
  return <>
    <SpriteImage sprite={lampOff} className="lamp-sprite lamp-sprite--off" />
    <SpriteImage sprite={lampOn} className="lamp-sprite lamp-sprite--on" />
  </>;
}
