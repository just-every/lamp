import { MailBody } from './MailBody';
import { Plate } from './Plate';
import { MAIL_FROM, reminder } from './sample';

const LABEL = 'Drawing of the reminder email for SCH-6, starting 14 October 2026 at 22:00 and ending 15 October at 00:30, GMT+01:00.';

// Plate F2: the reminder email subscribers get the day before, whole.
export function ReminderEmailPlate() {
  return <Plate label={LABEL} className="lamp-reminder" strip={MAIL_FROM}>
    <MailBody subject={reminder.subject} lines={reminder.lines} size="item" />
  </Plate>;
}
