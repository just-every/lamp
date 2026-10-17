import { assertWording, renderMaintenanceNotice, type MaintenanceWording, type MaintenanceUpdateInput, type NoticeSnapshot } from "./wording";
import type { DraftReference } from "./drafts";
import type { UpdateChannel } from "../../shared/domain";
import { createUlid, nowIso } from "../../shared/ids";
import type { LampEventDispatcher } from "../../api/extensions";
import type { ComponentsService } from "../components";
import { defaultMaintenanceRemindersPolicy, type MaintenanceRemindersPolicy } from "./policies";
import type { MaintenanceNotice, MaintenanceRepository, StoredMaintenance, StoredMaintenanceComponent } from "./repository";

export type MaintenanceView = Omit<StoredMaintenance, "state"> & { state: StoredMaintenance["state"] | "Verifying" } & { components: StoredMaintenanceComponent[]; notices: MaintenanceNotice[]; importedUpdates: Awaited<ReturnType<MaintenanceRepository["listImportedUpdates"]>>; overrunning: boolean };

export interface MaintenanceNotificationStatements {
  forMaintenanceNotice(input: { eventId: string; maintenanceId: string; componentIds: string[]; kind: MaintenanceNotice["kind"]; queuedAt: string; recipientScope: "eligible" | "previous"; previousEventIds: string[]; channels?: UpdateChannel[] }): Promise<D1PreparedStatement[]>;
}

export interface MaintenanceInput extends MaintenanceWording, DraftReference { autoStart?: boolean; autoComplete?: boolean; remindPrior?: boolean; channels?: UpdateChannel[]; title: string; startsAt: string; endsAt: string; componentIds: string[]; }

export interface MaintenanceOverrunAlertEvent {
  maintenanceId: string;
  endsAt: string;
  kind?: "overrun" | "start-due";
}

export type MaintenanceRuntimeEvents = Pick<LampEventDispatcher, "maintenanceScheduled" | "maintenanceStarted" | "maintenanceCompleted">;

export interface MaintenanceService {
  publishUpdate(maintenanceId: string, input: MaintenanceUpdateInput & DraftReference, operatorId: string): Promise<MaintenanceView | null>;
  list(): Promise<MaintenanceView[]>;
  create(input: MaintenanceInput, operatorId: string): Promise<MaintenanceView>;
  reschedule(maintenanceId: string, input: Pick<MaintenanceInput, "startsAt" | "endsAt">, operatorId: string): Promise<MaintenanceView | null>;
  cancel(maintenanceId: string, operatorId: string): Promise<MaintenanceView | null>;
  complete(maintenanceId: string, operatorId: string): Promise<MaintenanceView | null>;
  finishCompletion(maintenanceId: string, operatorId: string): Promise<void>;
  runDue(now?: string): Promise<{ started: string[]; completed: string[]; reminded: string[] }>;
  refreshPublic(): Promise<void>;
}

function assertWindow(startsAt: string, endsAt: string) {
  const start = new Date(startsAt).getTime(); const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Maintenance end time must be after start time.");
}

function groupByMaintenance<T extends { maintenanceId: string }>(records: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const group = groups.get(record.maintenanceId) ?? [];
    group.push(record);
    groups.set(record.maintenanceId, group);
  }
  return groups;
}

export function createMaintenanceService(
  repository: MaintenanceRepository,
  componentsService: ComponentsService,
  onPublicDataChanged: () => Promise<void>,
  notificationStatements: MaintenanceNotificationStatements | null = null,
  reminderPolicy: MaintenanceRemindersPolicy = defaultMaintenanceRemindersPolicy,
  onOverrun: (event: MaintenanceOverrunAlertEvent) => Promise<void>,
  events?: MaintenanceRuntimeEvents,
): MaintenanceService {
  const view = async (record: StoredMaintenance): Promise<MaintenanceView> => {
    const [components, notices, importedUpdates] = await Promise.all([
      repository.listComponents(record.id), repository.listNotices(record.id), repository.listImportedUpdates(record.id),
    ]);
    return { ...record, state: record.verifying && record.state === "In progress" ? "Verifying" : record.state, components, notices, importedUpdates, overrunning: record.state === "In progress" && new Date(record.endsAt).getTime() + 15 * 60 * 1000 <= Date.now() };
  };
  const snapshot = (record: StoredMaintenance): NoticeSnapshot => ({ reference:record.reference,title:record.title,state:record.verifying && record.state === "In progress" ? "Verifying" : record.state, startsAt:record.startsAt,endsAt:record.endsAt,calendarSequence:record.calendarSequence,affectedAudience:record.affectedAudience,customerImpact:record.customerImpact,whatStillWorks:record.whatStillWorks,details:record.details });
  const prepareNotice = async (record: StoredMaintenance, components: StoredMaintenanceComponent[], kind: MaintenanceNotice["kind"], operatorId: string | null, recipientScope: "eligible" | "previous", channels?: UpdateChannel[]) => {
    if (!notificationStatements) throw new Error("Maintenance notification transaction wiring is required.");
    const timestamp = nowIso(); const notice: MaintenanceNotice = { id: createUlid(), maintenanceId: record.id, kind, body: renderMaintenanceNotice(snapshot(record), kind).plainText, snapshotJson: JSON.stringify(snapshot(record)), publishedAt: timestamp, authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
    const previousEventIds = recipientScope === "previous" ? (await repository.listNotices(record.id)).map((prior) => prior.id) : [];
    const statements = await notificationStatements.forMaintenanceNotice({ eventId: notice.id, maintenanceId: record.id, componentIds: components.flatMap((component) => component.componentId ? [component.componentId] : []), kind, queuedAt: timestamp, recipientScope, previousEventIds, channels });
    return { notice, statements };
  };
  const notify = async (record: StoredMaintenance, components: StoredMaintenanceComponent[], kind: MaintenanceNotice["kind"], operatorId: string | null, recipientScope: "eligible" | "previous") => {
    const { notice, statements } = await prepareNotice(record, components, kind, operatorId, recipientScope);
    return repository.writeNotice(notice, statements);
  };
  return {
    async publishUpdate(maintenanceId, input, operatorId) {
      const previous = await repository.find(maintenanceId); if (!previous) return null;
      assertWording(input, previous.wordingRequired);
      if (["Completed","Cancelled"].includes(previous.state) && !input.correctsNoticeId) throw new Error("A completed or cancelled maintenance accepts corrections only.");
      if (input.correctsNoticeId && !(await repository.listNotices(maintenanceId)).some(notice=>notice.id===input.correctsNoticeId)) throw new Error("The corrected notice does not belong to this maintenance.");
      if (previous.state !== "Scheduled" && input.state === "Scheduled") throw new Error("A started window cannot return to Scheduled.");
      if (previous.state === "Scheduled" && input.state === "Completed") throw new Error("Start maintenance before completing it.");
      if (["Completed","Cancelled"].includes(previous.state) && input.state !== previous.state) throw new Error("A correction keeps the completed lifecycle.");
      const timestamp = nowIso();
      const changed: StoredMaintenance = { ...previous, affectedAudience:input.affectedAudience,customerImpact:input.customerImpact,whatStillWorks:input.whatStillWorks,details:input.details,
        state: input.state === "Verifying" ? "In progress" : input.state, verifying: input.state === "Verifying", completedAt:input.state === "Completed" ? previous.completedAt ?? timestamp : null,
        calendarSequence:previous.calendarSequence+1,autoStart:input.autoStart ?? previous.autoStart,autoComplete:input.autoComplete ?? previous.autoComplete,remindPrior:input.remindPrior ?? previous.remindPrior,updatedAt:timestamp };
      const components = await repository.listComponents(maintenanceId);
      const kind = input.correctsNoticeId || changed.state === previous.state && changed.verifying === previous.verifying ? "update" : input.state === "Verifying" ? "verifying" : input.state === "In progress" && previous.state === "Scheduled" ? "started" : input.state === "Completed" ? "completed" : "update";
      const prepared = await prepareNotice(changed,components,kind,operatorId,"eligible",input.channels);
      prepared.notice.correctsNoticeId=input.correctsNoticeId;
      if (!(await repository.publishUpdate(changed,previous,prepared.notice,prepared.statements,input))) throw new Error("Maintenance or its draft changed. Reload before publishing.");
      await Promise.all(components.flatMap(component=>component.componentId?[componentsService.recomputePublicState(component.componentId,{type:"maintenance",id:maintenanceId,operatorId},timestamp)]:[]));
      return view(changed);
    },
    async list() {
      const [records, details] = await Promise.all([repository.listMaintenance(), repository.listCollectionDetails()]);
      const components = groupByMaintenance(details.components);
      const notices = groupByMaintenance(details.notices);
      const importedUpdates = groupByMaintenance(details.importedUpdates);
      const result = records.map((record): MaintenanceView => ({
        ...record, state: record.verifying && record.state === "In progress" ? "Verifying" : record.state,
        components: components.get(record.id) ?? [],
        notices: notices.get(record.id) ?? [],
        importedUpdates: (importedUpdates.get(record.id) ?? []).map(({ maintenanceId, ...update }) => update),
        overrunning: record.state === "In progress" && new Date(record.endsAt).getTime() + 15 * 60 * 1000 <= Date.now(),
      }));
      await Promise.all(result.filter((record) => record.overrunning).map((record) => onOverrun({ maintenanceId: record.id, endsAt: record.endsAt })));
      return result;
    },
    async create(input, operatorId) {
      if (!input.title.trim() || input.title.length > 250) throw new Error("Maintenance title is required and must be at most 250 characters.");
      assertWording(input, true);
      assertWindow(input.startsAt, input.endsAt);
      if (!input.componentIds.length) throw new Error("Attach at least one component to maintenance.");
      if (!notificationStatements) throw new Error("Maintenance notification transaction wiring is required.");
      const components = await Promise.all(input.componentIds.map((id) => componentsService.get(id)));
      if (components.some((component) => !component)) throw new Error("One or more attached components no longer exist.");
      const timestamp = nowIso(); const maintenanceId = createUlid();
      const reference = await repository.allocateMaintenanceReference();
      const record: StoredMaintenance = { affectedAudience: input.affectedAudience, customerImpact: input.customerImpact, whatStillWorks: input.whatStillWorks, details: input.details, wordingRequired: true, verifying: false, autoStart: input.autoStart ?? true, autoComplete: input.autoComplete ?? true, remindPrior: input.remindPrior ?? true, calendarSequence: 0, id: maintenanceId, reference, title: input.title.trim(), state: "Scheduled", startsAt: input.startsAt, endsAt: input.endsAt, completedAt: null, createdByOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
      const attached = components.map((component) => ({ id: createUlid(), maintenanceId, componentId: component!.id, componentName: component!.name, state: "Under maintenance" as const, createdAt: timestamp, updatedAt: timestamp }));
      const notice: MaintenanceNotice = { id: createUlid(), maintenanceId, kind: "scheduled", body: renderMaintenanceNotice(record, "scheduled").plainText, snapshotJson: JSON.stringify(snapshot(record)), publishedAt: timestamp, authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
      const statements = await notificationStatements.forMaintenanceNotice({ eventId: notice.id, maintenanceId, componentIds: attached.flatMap((component) => component.componentId ? [component.componentId] : []), kind: notice.kind, queuedAt: timestamp, recipientScope: "eligible", previousEventIds: [], channels: input.channels });
      await repository.create(record, attached, notice, statements, input);
      await events?.maintenanceScheduled({ maintenanceId, reference: record.reference, state: "Scheduled", occurredAt: timestamp });
      return view(record);
    },
    async reschedule(maintenanceId, input, operatorId) {
      assertWindow(input.startsAt, input.endsAt);
      const record = await repository.find(maintenanceId); if (!record) return null;
      const timestamp = nowIso(); const components = await repository.listComponents(maintenanceId);
      const changed = { ...record, startsAt: input.startsAt, endsAt: input.endsAt, calendarSequence: record.calendarSequence + 1, updatedAt: timestamp };
      const { notice, statements } = await prepareNotice(changed, components, "rescheduled", operatorId, "previous");
      if (record.state === "Scheduled") {
        if (!(await repository.updateWindowWithNotice(maintenanceId, input.startsAt, input.endsAt, timestamp, notice, statements))) throw new Error("Only scheduled maintenance can be rescheduled.");
      } else if (record.state === "In progress") {
        if (input.startsAt !== record.startsAt) throw new Error("The start time cannot change after maintenance has started.");
        if (new Date(input.endsAt).getTime() <= new Date(record.endsAt).getTime()) throw new Error("An in-progress maintenance window can only be extended to a later end time.");
        if (!(await repository.extendInProgressWithNotice(maintenanceId, record.startsAt, record.endsAt, input.endsAt, timestamp, notice, statements))) throw new Error("The maintenance window changed before it could be extended.");
      } else {
        throw new Error("Only scheduled maintenance can be rescheduled or in-progress maintenance can be extended.");
      }
      return view((await repository.find(maintenanceId))!);
    },
    async cancel(maintenanceId, operatorId) {
      const record = await repository.find(maintenanceId); if (!record) return null;
      const timestamp = nowIso(); const components = await repository.listComponents(maintenanceId);
      const changed = { ...record, state: "Cancelled" as const, calendarSequence: record.calendarSequence + 1, updatedAt: timestamp };
      const { notice, statements } = await prepareNotice(changed, components, "cancelled", operatorId, "previous");
      if (!(await repository.cancelWithNotice(maintenanceId, timestamp, notice, statements))) throw new Error("Only scheduled maintenance can be cancelled.");
      return view((await repository.find(maintenanceId))!);
    },
    async complete(maintenanceId, operatorId) {
      const record = await repository.find(maintenanceId); if (!record) return null;
      const timestamp = nowIso(); const components = await repository.listComponents(maintenanceId);
      const changed = { ...record, state: "Completed" as const, completedAt: timestamp, calendarSequence:record.calendarSequence+1, updatedAt: timestamp };
      const { notice, statements } = await prepareNotice(changed, components, "completed", operatorId, "eligible");
      if (!(await repository.transitionWithNotice(maintenanceId, "In progress", "Completed", timestamp, timestamp, notice, statements))) throw new Error("Only in-progress maintenance can be completed.");
      await events?.maintenanceCompleted({ maintenanceId, reference: record.reference, state: "Completed", occurredAt: timestamp });
      return view((await repository.find(maintenanceId))!);
    },
    async finishCompletion(maintenanceId, operatorId) {
      const record = await repository.find(maintenanceId);
      if (!record || record.state !== "Completed") return;
      const components = await repository.listComponents(maintenanceId);
      const changedAt = record.completedAt ?? record.updatedAt;
      await Promise.all(components.flatMap((component) => component.componentId ? [componentsService.recomputePublicState(component.componentId, { type: "maintenance", id: maintenanceId, operatorId }, changedAt)] : []));
      await onPublicDataChanged();
    },
    async runDue(now = nowIso()) {
      const due = await repository.listDue(now); const started: string[] = []; const completed: string[] = []; const reminded: string[] = [];
      for (const record of due) {
        const components = await repository.listComponents(record.id);
        if (record.state === "Scheduled") {
          if (!record.autoStart) { await onOverrun({ maintenanceId: record.id, endsAt: record.startsAt, kind: "start-due" }); continue; }
          const changed = { ...record, state: "In progress" as const, calendarSequence:record.calendarSequence+1, updatedAt: now };
          const { notice, statements } = await prepareNotice(changed, components, "started", null, "eligible");
          if (await repository.transitionWithNotice(record.id, "Scheduled", "In progress", null, now, notice, statements, { startsAt: record.startsAt, endsAt: record.endsAt })) {
            await Promise.all(components.flatMap((component) => component.componentId ? [componentsService.recomputePublicState(component.componentId, { type: "maintenance", id: record.id, operatorId: null }, now)] : []));
            await events?.maintenanceStarted({ maintenanceId: record.id, reference: record.reference, state: "In progress", occurredAt: now });
            started.push(record.id);
          }
        }
        if (record.state === "In progress") {
          if (!record.autoComplete) { if (Date.parse(now) >= Date.parse(record.endsAt)+15*60*1000) await onOverrun({ maintenanceId: record.id, endsAt: record.endsAt, kind: "overrun" }); continue; }
          const changed = { ...record, state: "Completed" as const, completedAt: now, calendarSequence:record.calendarSequence+1, updatedAt: now };
          const { notice, statements } = await prepareNotice(changed, components, "completed", null, "eligible");
          if (await repository.transitionWithNotice(record.id, "In progress", "Completed", now, now, notice, statements, { startsAt: record.startsAt, endsAt: record.endsAt })) {
            await Promise.all(components.flatMap((component) => component.componentId ? [componentsService.recomputePublicState(component.componentId, { type: "maintenance", id: record.id, operatorId: null }, now)] : []));
            await events?.maintenanceCompleted({ maintenanceId: record.id, reference: record.reference, state: "Completed", occurredAt: now });
            completed.push(record.id);
          }
        }
      }
      for (const record of await repository.listReminderDue(now)) {
        if (!reminderPolicy.shouldNotify({ kind: "scheduled", state: record.state, startsAt: record.startsAt, now })) continue;
        const components = await repository.listComponents(record.id); if (await notify(record, components, "reminder", null, "eligible")) reminded.push(record.id);
      }
      if (started.length || completed.length || reminded.length) await onPublicDataChanged();
      return { started, completed, reminded };
    },
    refreshPublic: onPublicDataChanged,
  };
}
