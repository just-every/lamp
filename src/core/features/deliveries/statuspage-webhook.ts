import { mostSevereState } from "../../shared/domain";
import { incidentImpact } from "../../shared/incident-impact";
import { projectStatuspageRecords, type StatuspageProjectionModel } from "../../shared/statuspage-records";
import { isPublicComponentShown } from "../public-snapshot/component-visibility";
import { publicUpdate } from "../public-snapshot/public-update";
import type { PageStatusRollupPolicy } from "../public-snapshot/policies";
import type { PublicSnapshotSource } from "../public-snapshot/repository";
import type { DispatchableDelivery } from "./repository";
import { statuspagePublicId } from "../../shared/statuspage-mapping";

function projection(source:PublicSnapshotSource,origin:string,rollup:PageStatusRollupPolicy):StatuspageProjectionModel {
  const components=source.components.map(component=>({...component,state:mostSevereState(source.claims.filter(claim=>claim.componentId===component.id).map(claim=>claim.state))}));
  const hidden=new Set(components.filter(component=>!isPublicComponentShown(component)).map(component=>component.id));
  return {
    settings:source.settings,origin:source.publicOrigin??origin,generatedAt:new Date().toISOString(),overall:rollup(components.map(component=>component.state)),
    visibleComponents:components.filter(isPublicComponentShown),
    incidents:source.incidents.map(incident=>({...incident,
      ...incidentImpact(source.incidentImpacts?.[incident.id],incident.impactOverride,source.incidentComponents.filter(component=>component.incidentId===incident.id).map(component=>component.state)),
      components:source.incidentComponents.filter(component=>component.incidentId===incident.id&&(!component.componentId||!hidden.has(component.componentId))).map(component=>component.componentName),
      updates:source.updates.filter(update=>update.incidentId===incident.id).map(update=>publicUpdate(source,update)),
      report:source.reports.find(report=>report.incidentId===incident.id)??null,
    })).filter(incident=>incident.updates.length>0&&source.incidentComponents.some(component=>component.incidentId===incident.id)),
    maintenance:source.maintenance.map(item=>({...item,
      components:source.maintenanceComponents.filter(component=>component.maintenanceId===item.id&&(!component.componentId||!hidden.has(component.componentId))).map(component=>component.componentName),
      notices:source.maintenanceNotices.filter(notice=>notice.maintenanceId===item.id),
      importedUpdates:(source.importedMaintenanceUpdates??[]).filter(update=>update.maintenanceId===item.id),
    })).filter(item=>source.maintenanceComponents.some(component=>component.maintenanceId===item.id)),
  };
}

export function statuspageWebhookBody(source:PublicSnapshotSource,delivery:DispatchableDelivery,origin:string,unsubscribeToken:string,rollup:PageStatusRollupPolicy) {
  const records=projectStatuspageRecords(projection(source,origin,rollup),source);
  const incident=delivery.maintenanceId
    ? records.maintenance.find(item=>item.id===statuspagePublicId(delivery.maintenanceId!,source.publicApiIds))
    : records.incidents.find(item=>item.id===statuspagePublicId(delivery.statuspageIncidentId??delivery.incidentId??"",source.publicApiIds));
  if(!incident)throw new Error("The notification has no public Statuspage record.");
  return {
    meta:{unsubscribe:new URL(`/unsubscribe/${encodeURIComponent(unsubscribeToken)}`,origin).href,documentation:"https://github.com/just-every/run-lamp/blob/main/docs/subscribers-and-notifications.md"},
    page:{id:records.page.id,status_indicator:records.status.indicator,status_description:records.status.description},
    incident,
  };
}
