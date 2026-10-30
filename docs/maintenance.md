# Scheduled maintenance

Open **Maintenance** and create a window with a title, start and end time, and
at least one component. The window appears as scheduled until its start time,
then moves to In progress automatically. Lamp completes it automatically after
its end time; you do not need to keep the app open or complete it manually.

While it is in progress, maintenance claims **Under maintenance** for its
attached components. The public component state still reflects the most severe
claim from an incident, maintenance or standing operator status.

You can reschedule or cancel a scheduled window from its controls. Changes and
cancellation publish notices to subscribers already notified about that
maintenance. Scheduled, rescheduled, started, completed and canceled notices
appear in the Atom feed. Notices remain with their maintenance record and appear
in public history when the window is completed or canceled.

## Subscriber notices and delivery checks

By default, Lamp sends notices to matching confirmed subscribers when you
schedule maintenance, 24 hours before it starts, when it starts and when it
completes. Changes and cancellations notify the subscribers already notified
about that window. Imported maintenance history does not replay these notices.

A new Cloudflare deployment can serve requests for many minutes before its
scheduled trigger starts. Lamp does not wait for it: each operator change sends
its notice right after it is saved, and while the trigger has not run for three
minutes, ordinary visits to the public page or the operator app (at most every
20 seconds per Worker) also start due windows, finish them and send their
notices. Once the trigger runs, it does this work every minute. Both paths
share the same claims, so no subscriber gets the same notice twice.

Open **Subscribers → Delivery log** to check the window's `SCH-` reference, title and notice
kind, such as scheduled, reminder, started or completed. The CSV export includes
these maintenance details and the provider-accepted timestamp too. **Accepted
by SendGrid** or **Accepted by Resend** and that timestamp mean the provider
accepted the send; they do not prove inbox arrival. Signed provider receipts can
report delivered, bounced or complained. For a real end-to-end check, also
check the subscriber's mailbox. See [notification delivery outcomes](subscribers-and-notifications.md).
