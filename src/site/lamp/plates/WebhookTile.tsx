import { Plate } from './Plate';
import { shortId, shortSignatures, webhook, webhookEvent } from './sample';
import './header-lines.css';

const LABEL = 'Drawing of a signed webhook delivery: its id, timestamp and two signatures, and the event it carries, incident.update.published.';

// T3: one webhook delivery's headers, the id and signatures shortened so no token breaks, and the first line of its
// body, the event it carries.
export function WebhookTile() {
  return <Plate label={LABEL} className="lamp-tile lamp-webhook">
    <div className="lamp-plate__mono lamp-headers">
      <p>webhook-id: {shortId}</p>
      <p>webhook-timestamp: {webhook.timestamp}</p>
      <p>webhook-signature: {shortSignatures}</p>
      <p className="lamp-headers__body">{webhookEvent}</p>
    </div>
  </Plate>;
}
