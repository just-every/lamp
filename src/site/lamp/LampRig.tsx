import { Cord } from './Cord';
import { LampSprites } from './LampSprites';
import { Light } from './Light';
import './rig.css';

// The big hanging lamp: hung from the top edge, settled by the intro, raised out by the scroll handoff.
export function LampRig() {
  return <div className="lamp-rig" aria-hidden="true">
    <div className="lamp-rig__lamp">
      <div className="lamp-rig__swing">
        <Light />
        <Cord />
        <LampSprites />
      </div>
    </div>
  </div>;
}
