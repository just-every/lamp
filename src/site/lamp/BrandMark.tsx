import { badge } from './badge';
import './mark.css';

// The header mark's slot. Mark 18 waits above the top edge and drops into the slot as the big lamp leaves.
export function BrandMark() {
  return <span className="lamp-brand__slot">
    <img className="lamp-brand__mark" src={badge} alt="" width="64" height="64" />
  </span>;
}
