import { MailBody } from './MailBody';
import { Plate } from './Plate';
import { MAIL_FROM, email, emailLines } from './sample';

const LABEL = 'Drawing of the notification email for INC-14, Card payments failing, status Identified.';

// Plate B1: the notification email for INC-14's Identified update.
export function EmailPlate() {
  return <Plate label={LABEL} className="lamp-same__plate lamp-same__plate--email" strip={MAIL_FROM} stripEnd={<span className="lamp-plate__pill">Email</span>}>
    <MailBody subject={email.subject} lines={emailLines} size="section" highlight />
  </Plate>;
}
