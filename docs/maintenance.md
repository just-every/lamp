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
maintenance. Scheduled, rescheduled, started, completed and cancelled notices
appear in the Atom feed. Notices remain with their maintenance record and appear
in public history when the window is completed or cancelled.
