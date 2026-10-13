import { Plate } from './Plate';
import './subscribe-tile.css';

const LABEL = 'Drawing of the subscribe form: Subscribe to status updates, an email address field and a Subscribe button.';

// T6: the public page's subscribe form: one email field, no cookie and no CAPTCHA. The field and button are drawn.
export function SubscribeTile() {
  return <Plate label={LABEL} className="lamp-tile lamp-subscribe">
    <span className="lamp-plate__eyebrow">Stay informed</span>
    <span className="lamp-plate__title lamp-plate__title--tile">Subscribe to status updates</span>
    <p className="lamp-plate__small lamp-subscribe__lede">Confirm your email address to receive future incident and maintenance updates.</p>
    <span className="lamp-subscribe__label">Email address</span>
    <span className="lamp-subscribe__row"><span className="lamp-subscribe__field" /><span className="lamp-plate__button">Subscribe</span></span>
  </Plate>;
}
