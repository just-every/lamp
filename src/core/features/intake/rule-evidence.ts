import { readGroupedAlerts, isGroupedPreset } from "./grouped-alerts";
import { readPagerDuty, pagerDutyComponents } from "./pagerduty";
import { readOperationsAlert, isOperationsPreset, operationsComponents } from "./vendor-alerts";
import { readPreset } from "./presets";
import { readPath } from "./alert-title";
import type { AlertSourceRow } from "./repository";

/** Reuse the authenticated intake parsers; rules never interpret unverified text. */
export function ruleEvidence(source:AlertSourceRow,componentId:string,payload:unknown):Array<{fingerprint:string;firing:boolean}> {
  if(isGroupedPreset(source.preset)) {
    const reading=readGroupedAlerts(source.preset,payload,source.labelMatchers ?? []);
    return 'refused' in reading?[]:reading.alerts.filter(row=>row.componentIds.includes(componentId)).map(row=>({fingerprint:row.fingerprint,firing:row.state==='firing'}));
  }
  if(isOperationsPreset(source.preset)) {
    const reading=readOperationsAlert(payload);
    if('refused' in reading || !['Create','Close'].includes(reading.action) || !operationsComponents(reading,source.labelMatchers ?? []).includes(componentId))return [];
    return [{fingerprint:reading.key,firing:!reading.recovered}];
  }
  if(source.preset==='pagerduty') {
    const reading=readPagerDuty(payload);
    if('refused' in reading || !['incident.triggered','incident.resolved'].includes(reading.action) || !pagerDutyComponents(reading.labels,source.labelMatchers ?? []).includes(componentId))return [];
    return [{fingerprint:reading.key,firing:!reading.recovered}];
  }
  if(source.preset) {
    const reading=readPreset(source.preset,payload);if('refused' in reading)return [];
    const mapped=source.preset==='uptime'?source.monitorMappings?.find(row=>row.monitorId===reading.monitorId)?.componentId:source.componentId;
    return mapped===componentId?[{fingerprint:reading.key,firing:!reading.recovered}]:[];
  }
  const key=readPath(payload,source.deduplicationPath);
  return typeof key==='string'?[{fingerprint:key.trim(),firing:readPath(payload,source.statePath)!==source.recoveredValue}]:[];
}
