import { PlainText } from './PlainText';
import { Plate } from './Plate';
import { HOST, atom } from './sample';
import './atom-plate.css';

const LABEL = 'Drawing of the Atom feed entry INC-14: Card payments failing, carrying the same update.';

// Plate B3: the feed's entry for the update, pretty-printed for reading; element names and text are exact. It ends on
// the line after the shared words.
export function AtomPlate() {
  return <Plate label={LABEL} className="lamp-same__plate lamp-same__plate--atom" strip={`${HOST}/feed.atom`} stripEnd={<span className="lamp-plate__pill">Atom feed</span>}>
    <div className="lamp-atom lamp-plate__mono">
      <p>{'<entry>'}</p>
      <p className="lamp-atom__in">{`<title>${atom.title}</title>`}</p>
      <p className="lamp-atom__in lamp-plate__muted">{`<updated>${atom.updated}</updated>`}</p>
      <p className="lamp-atom__in">{'<content type="text">'}{atom.lines[0]}</p>
      <PlainText lines={atom.lines.slice(1, 5)} highlight />
    </div>
  </Plate>;
}
