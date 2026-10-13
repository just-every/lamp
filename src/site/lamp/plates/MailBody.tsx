import { PlainText } from './PlainText';
import './mail-body.css';

// A notification email as the product sends its HTML part: the subject as its heading, the plain text preformatted,
// then the subscription links.
export function MailBody({ subject, lines, size, highlight = false }: { subject: string; lines: readonly string[]; size: 'section' | 'item'; highlight?: boolean }) {
  return <>
    <span className={size === 'item' ? 'lamp-plate__title lamp-plate__title--item lamp-mail__subject' : 'lamp-plate__title lamp-mail__subject'}>{subject}</span>
    <PlainText lines={lines} highlight={highlight} />
    <p className="lamp-mail__links"><u className="lamp-plate__link">Manage subscription</u> · <u className="lamp-plate__link">Unsubscribe</u></p>
  </>;
}
