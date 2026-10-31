import { CommunicationPerformance } from "../../communication-performance/ui/communication-performance";
import { SubscriberReporting } from "../../subscriber-reporting/ui/subscriber-reporting";

/** Settings › Reports: the monthly reports that used to sit on Overview and under Subscribers. */
export function ReportsSettingsTab() {
  return <>
    <CommunicationPerformance />
    <div className="data-card"><SubscriberReporting refreshKey={0} /></div>
  </>;
}
