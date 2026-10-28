import type { ComponentState } from "./domain";

export const statuspageStates:Record<ComponentState,string>={
  Operational:"operational","Degraded performance":"degraded_performance","Partially unavailable":"partial_outage","Major outage":"major_outage","Under maintenance":"under_maintenance",
};
export const statuspageImpacts:Record<ComponentState,string>={Operational:"none","Degraded performance":"minor","Partially unavailable":"major","Major outage":"critical","Under maintenance":"maintenance"};
export const statuspageMaintenanceStatuses:Record<string,string>={Scheduled:"scheduled","In progress":"in_progress",Verifying:"verifying",Completed:"completed",Cancelled:"completed"};
export const statuspageNoticeStatuses:Record<string,string>={scheduled:"scheduled",rescheduled:"scheduled",reminder:"scheduled",started:"in_progress",verifying:"verifying",completed:"completed",cancelled:"completed"};

/** The existing PAGE-016 public ID namespace, shared by every compatibility door. */
export function statuspagePublicId(native:string,imported:Record<string,string>={}):string {
  if(imported[native])return imported[native]!;
  let hash=14695981039346656037n;
  for(const byte of new TextEncoder().encode(`lamp-public:${native}`))hash=BigInt.asUintN(64,(hash^BigInt(byte))*1099511628211n);
  return (hash%(36n**12n)).toString(36).padStart(12,"0");
}
