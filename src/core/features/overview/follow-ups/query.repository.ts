import { incidentFollowUpsSql } from "./incident.repository";
import { maintenanceFollowUpsSql } from "./maintenance.repository";
import { reportCandidatesSql, reportFollowUpsSql } from "./report.repository";
import { importFollowUpsSql } from "./import.repository";
import { notificationFollowUpsSql } from "./notification.repository";
import { channelFollowUpsSql } from "./channel.repository";

/** One clock and one projection are shared by reads and atomic mutation guards. */
export const followUpsQuery = `WITH follow_up_clock(now) AS (SELECT ?),
  follow_up_reports AS (${reportCandidatesSql}),
  follow_ups AS (${[incidentFollowUpsSql, maintenanceFollowUpsSql, reportFollowUpsSql, importFollowUpsSql, notificationFollowUpsSql, channelFollowUpsSql].join(" UNION ALL ")})`;
