import type { AgentAction } from "../incidents/agent-action";
import { renderMaintenanceWording } from "../../shared/update-renderer";
import { defaultMaintenanceAutomation, type MaintenanceAutomation } from "./automation.repository";
import { createUlid, nowIso } from "../../shared/ids";
import type { LampEventDispatcher } from "../../api/extensions";
import type { ComponentsService } from "../components";
import { defaultMaintenanceRemindersPolicy, type MaintenanceRemindersPolicy } from "./policies";
import type { MaintenanceNotice, MaintenanceRepository, StoredMaintenance, StoredMaintenanceComponent } from "./repository";

export type MaintenanceView = StoredMaintenance & MaintenanceAutomation & { components: StoredMaintenanceComponent[]; notices: MaintenanceNotice[]; importedUpdates: Awaited<ReturnType<MaintenanceRepository["listImportedUpdates"]>>; overrunning: boolean };

export interface MaintenanceNotificationStatements {
  forMaintenanceNotice(input: { eventId: string; maintenanceId: string; componentIds: string[]; kind: MaintenanceNotice["kind"]; queuedAt: string; recipientScope: "eligible" | "previous"; previousEventIds: string[]; social?: boolean }): Promise<D1PreparedStatement[]>;
}

export interface MaintenanceInput extends Partial<MaintenanceAutomation> { social?:boolean; affectedAudience: string; customerImpact: string; title: string; startsAt: string; endsAt: string; componentIds: string[]; }

export interface MaintenanceOverrunAlertEvent {
  maintenanceId: string;
  endsAt: string;
}

export type MaintenanceRuntimeEvents = Pick<LampEventDispatcher, "maintenanceScheduled" | "maintenanceStarted" | "maintenanceCompleted">;

export interface MaintenanceService {
  list(): Promise<MaintenanceView[]>;
  getAutomationDefault(): Promise<MaintenanceAutomation>;
  saveAutomationDefault(value: MaintenanceAutomation): Promise<MaintenanceAutomation>;
  create(input: MaintenanceInput, operatorId: string, agentAction?: AgentAction): Promise<MaintenanceView>;
  start(maintenanceId: string, operatorId: string, expectedUpdatedAt?: string, agentAction?: AgentAction): Promise<MaintenanceView | null>;
  reschedule(maintenanceId: string, input: Pick<MaintenanceInput, "startsAt" | "endsAt" | "autoStart" | "autoComplete" | "social"> & Partial<Pick<MaintenanceInput, "affectedAudience" | "customerImpact">>, operatorId: string, expectedUpdatedAt?: string, agentAction?: AgentAction): Promise<MaintenanceView | null>;
  cancel(maintenanceId: string, operatorId: string, expectedUpdatedAt?: string, agentAction?: AgentAction): Promise<MaintenanceView | null>;
  complete(maintenanceId: string, operatorId: string, expectedUpdatedAt?: string, agentAction?: AgentAction): Promise<MaintenanceView | null>;
  autostart(maintenanceId: string, operatorId: string, expectedUpdatedAt?: string, agentAction?: AgentAction): Promise<MaintenanceView | null>;
  autocomplete(maintenanceId: string, operatorId: string, expectedUpdatedAt?: string, agentAction?: AgentAction): Promise<MaintenanceView | null>;
  remind(maintenanceId: string, operatorId: string, expectedUpdatedAt: string, agentAction: AgentAction): Promise<MaintenanceView | null>;
  finishCompletion(maintenanceId: string, operatorId: string): Promise<void>;
  runDue(now?: string): Promise<{ started: string[]; completed: string[]; reminded: string[] }>;
  refreshPublic(): Promise<void>;
}

function maintenanceWording(input: { affectedAudience?: string; customerImpact?: string }) {
  if (typeof input.affectedAudience !== "string" || typeof input.customerImpact !== "string") throw new Error("Who is affected and customer impact are required for maintenance.");
  const affectedAudience = input.affectedAudience.trim(), customerImpact = input.customerImpact.trim();
  if (!affectedAudience || !customerImpact || affectedAudience.length > 250 || customerImpact.length > 250) throw new Error("Who is affected and customer impact must each contain 1 to 250 characters.");
  return { affectedAudience, customerImpact };
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
  onStartDue?: (event: { maintenanceId: string; startsAt: string }) => Promise<void>,
): MaintenanceService {
  const view = async (record: StoredMaintenance): Promise<MaintenanceView> => {
    const [components, notices, importedUpdates, automation] = await Promise.all([
      repository.listComponents(record.id), repository.listNotices(record.id), repository.listImportedUpdates(record.id), repository.automation.get(record.id),
    ]);
    return { ...record, ...automation, components, notices, importedUpdates, overrunning: record.state === "In progress" && new Date(record.endsAt).getTime() + 15 * 60 * 1000 <= Date.now() };
  };
  const prepareNotice = async (record: StoredMaintenance, components: StoredMaintenanceComponent[], kind: MaintenanceNotice["kind"], operatorId: string | null, recipientScope: "eligible" | "previous", social=false, agentAction?: AgentAction) => {
    if (!notificationStatements) throw new Error("Maintenance notification transaction wiring is required.");
    const timestamp = nowIso(); const notice: MaintenanceNotice = { ...(agentAction ? { agentAction } : {}), id: createUlid(), maintenanceId: record.id, kind, body: renderMaintenanceWording(record), publishedAt: timestamp, authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
    const previousEventIds = recipientScope === "previous" ? (await repository.listNotices(record.id)).map((prior) => prior.id) : [];
    const statements = await notificationStatements.forMaintenanceNotice({ eventId: notice.id, maintenanceId: record.id, componentIds: components.flatMap((component) => component.componentId ? [component.componentId] : []), kind, queuedAt: timestamp, recipientScope, previousEventIds, social });
    return { notice, statements };
  };
  const notify = async (record: StoredMaintenance, components: StoredMaintenanceComponent[], kind: MaintenanceNotice["kind"], operatorId: string | null, recipientScope: "eligible" | "previous") => {
    const { notice, statements } = await prepareNotice(record, components, kind, operatorId, recipientScope);
    return repository.writeNotice(notice, statements);
  };
  const startTransition = async (maintenanceId: string, operatorId: string, automatic: boolean, expectedUpdatedAt?: string, agentAction?: AgentAction) => {
    const record = await repository.find(maintenanceId); if (!record) return null;
    if (expectedUpdatedAt !== undefined && record.updatedAt !== expectedUpdatedAt) throw new Error("The maintenance changed. Reload it before editing.");
    const automation = await repository.automation.get(maintenanceId);
    if (record.state !== "Scheduled" || automation.autoStart !== automatic) throw new Error(automatic ? "Automatic start is not enabled for this scheduled maintenance." : "Only scheduled maintenance with auto-start off can be started by this action.");
    if (automatic && (!agentAction || !await repository.agentOwned(maintenanceId) || Date.parse(record.startsAt) > Date.now())) throw new Error("Agent maintenance has not reached its current authorized start time.");
    const timestamp = nowIso(), components = await repository.listComponents(maintenanceId);
    const changed = { ...record, state: "In progress" as const, updatedAt: timestamp };
    const { notice, statements } = await prepareNotice(changed, components, "started", operatorId, "eligible", false, agentAction);
    if (!await repository.transitionWithNotice(maintenanceId, "Scheduled", "In progress", null, timestamp, notice, statements, { startsAt: record.startsAt, endsAt: record.endsAt, autoStart: automatic }, expectedUpdatedAt ?? record.updatedAt, automatic)) throw new Error("The maintenance changed before it could be started.");
    await Promise.all(components.flatMap(component => component.componentId ? [componentsService.recomputePublicState(component.componentId, {type: "maintenance", id: maintenanceId, operatorId, ...(agentAction ? { agentAction } : {})}, timestamp)] : []));
    await events?.maintenanceStarted({ maintenanceId, reference: record.reference, state: "In progress", occurredAt: timestamp });
    await onPublicDataChanged();
    return view((await repository.find(maintenanceId))!);
  };
  const completeTransition = async (maintenanceId: string, operatorId: string, automatic: boolean, expectedUpdatedAt?: string, agentAction?: AgentAction) => {
    const record = await repository.find(maintenanceId); if (!record) return null;
    if (expectedUpdatedAt !== undefined && record.updatedAt !== expectedUpdatedAt) throw new Error("The maintenance changed. Reload it before editing.");
    const automation = await repository.automation.get(maintenanceId);
    if (automatic && (!automation.autoComplete || !agentAction || !await repository.agentOwned(maintenanceId) || Date.parse(record.endsAt) > Date.now())) throw new Error("Agent maintenance has not reached its current authorized completion time.");
    const timestamp = nowIso(), components = await repository.listComponents(maintenanceId);
    const changed = { ...record, state: "Completed" as const, completedAt: timestamp, updatedAt: timestamp };
    const { notice, statements } = await prepareNotice(changed, components, "completed", operatorId, "eligible", false, agentAction);
    if (!await repository.transitionWithNotice(maintenanceId, "In progress", "Completed", timestamp, timestamp, notice, statements, automatic ? { startsAt: record.startsAt, endsAt: record.endsAt, autoComplete: true } : undefined, expectedUpdatedAt ?? record.updatedAt, automatic)) throw new Error("Only in-progress unchanged maintenance can be completed.");
    await events?.maintenanceCompleted({ maintenanceId, reference: record.reference, state: "Completed", occurredAt: timestamp });
    return view((await repository.find(maintenanceId))!);
  };
  return {
    getAutomationDefault: () => repository.automation.getDefault(),
    saveAutomationDefault: value => repository.automation.saveDefault(value),
    async list() {
      const [records, details, automation] = await Promise.all([repository.listMaintenance(), repository.listCollectionDetails(), repository.automation.list()]);
      const components = groupByMaintenance(details.components);
      const notices = groupByMaintenance(details.notices);
      const importedUpdates = groupByMaintenance(details.importedUpdates);
      const result = records.map((record): MaintenanceView => ({
        ...record,
        ...(automation.get(record.id) ?? defaultMaintenanceAutomation),
        components: components.get(record.id) ?? [],
        notices: notices.get(record.id) ?? [],
        importedUpdates: (importedUpdates.get(record.id) ?? []).map(({ maintenanceId, ...update }) => update),
        overrunning: record.state === "In progress" && new Date(record.endsAt).getTime() + 15 * 60 * 1000 <= Date.now(),
      }));
      await Promise.all(result.filter((record) => record.overrunning).map((record) => onOverrun({ maintenanceId: record.id, endsAt: record.endsAt })));
      return result;
    },
    async create(input, operatorId, agentAction) {
      if (!input.title.trim() || input.title.length > 250) throw new Error("Maintenance title is required and must be at most 250 characters.");
      assertWindow(input.startsAt, input.endsAt);
      const wording = maintenanceWording(input);
      if (!input.componentIds.length) throw new Error("Attach at least one component to maintenance.");
      if (!notificationStatements) throw new Error("Maintenance notification transaction wiring is required.");
      const components = await Promise.all(input.componentIds.map((id) => componentsService.get(id)));
      if (components.some((component) => !component)) throw new Error("One or more attached components no longer exist.");
      const timestamp = nowIso(); const maintenanceId = createUlid();
      const reference = await repository.allocateMaintenanceReference();
      const record: StoredMaintenance = { id: maintenanceId, reference, title: input.title.trim(), ...wording, state: "Scheduled", startsAt: input.startsAt, endsAt: input.endsAt, completedAt: null, createdByOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
      const attached = components.map((component) => ({ id: createUlid(), maintenanceId, componentId: component!.id, componentName: component!.name, state: "Under maintenance" as const, createdAt: timestamp, updatedAt: timestamp }));
      const notice: MaintenanceNotice = { ...(agentAction ? { agentAction } : {}), id: createUlid(), maintenanceId, kind: "scheduled", body: renderMaintenanceWording(record), publishedAt: timestamp, authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
      const statements = await notificationStatements.forMaintenanceNotice({ eventId: notice.id, maintenanceId, componentIds: attached.flatMap((component) => component.componentId ? [component.componentId] : []), kind: notice.kind, queuedAt: timestamp, recipientScope: "eligible", previousEventIds: [], social: input.social });
      const defaults = await repository.automation.getDefault();
      await repository.create(record, attached, notice, statements, { autoStart: input.autoStart ?? defaults.autoStart, autoComplete: input.autoComplete ?? defaults.autoComplete });
      await events?.maintenanceScheduled({ maintenanceId, reference: record.reference, state: "Scheduled", occurredAt: timestamp });
      return view(record);
    },
    async reschedule(maintenanceId, input, operatorId, expectedUpdatedAt, agentAction) {
      assertWindow(input.startsAt, input.endsAt);
      const record = await repository.find(maintenanceId); if (!record) return null;
      if (expectedUpdatedAt !== undefined && record.updatedAt !== expectedUpdatedAt) throw new Error("The maintenance changed. Reload it before editing.");
      const timestamp = nowIso(); const components = await repository.listComponents(maintenanceId);
      const wording = input.affectedAudience === undefined && input.customerImpact === undefined ? undefined : maintenanceWording(input);
      const changed = { ...record, ...wording, startsAt: input.startsAt, endsAt: input.endsAt, updatedAt: timestamp };
      const { notice, statements } = await prepareNotice(changed, components, "rescheduled", operatorId, "previous", input.social, agentAction);
      if (record.state === "Scheduled") {
        if (!(await repository.updateWindowWithNotice(maintenanceId, input.startsAt, input.endsAt, timestamp, notice, statements, { autoStart: input.autoStart, autoComplete: input.autoComplete }, wording, expectedUpdatedAt))) throw new Error("Only scheduled maintenance can be rescheduled.");
      } else if (record.state === "In progress") {
        if (input.startsAt !== record.startsAt) throw new Error("The start time cannot change after maintenance has started.");
        const hasSwitch = input.autoStart !== undefined || input.autoComplete !== undefined;
        if (Date.parse(input.endsAt) < Date.parse(record.endsAt) || (!hasSwitch && input.endsAt === record.endsAt)) throw new Error("An in-progress maintenance window can only be extended to a later end time, or keep its time while changing automation.");
        if (!(await repository.extendInProgressWithNotice(maintenanceId, record.startsAt, record.endsAt, input.endsAt, timestamp, notice, statements, input.autoStart === undefined && input.autoComplete === undefined ? undefined : { autoStart: input.autoStart, autoComplete: input.autoComplete }, wording, expectedUpdatedAt))) throw new Error("The maintenance window changed before it could be extended.");
      } else {
        throw new Error("Only scheduled maintenance can be rescheduled or in-progress maintenance can be extended.");
      }
      return view((await repository.find(maintenanceId))!);
    },
    start: (maintenanceId, operatorId, expectedUpdatedAt, agentAction) => startTransition(maintenanceId, operatorId, false, expectedUpdatedAt, agentAction),
    autostart: (maintenanceId, operatorId, expectedUpdatedAt, agentAction) => startTransition(maintenanceId, operatorId, true, expectedUpdatedAt, agentAction),
    async cancel(maintenanceId, operatorId, expectedUpdatedAt, agentAction) {
      const record = await repository.find(maintenanceId); if (!record) return null;
      if (expectedUpdatedAt !== undefined && record.updatedAt !== expectedUpdatedAt) throw new Error("The maintenance changed. Reload it before editing.");
      const timestamp = nowIso(); const components = await repository.listComponents(maintenanceId);
      const changed = { ...record, state: "Cancelled" as const, updatedAt: timestamp };
      const { notice, statements } = await prepareNotice(changed, components, "cancelled", operatorId, "previous", false, agentAction);
      if (!(await repository.cancelWithNotice(maintenanceId, timestamp, notice, statements, expectedUpdatedAt))) throw new Error("Only scheduled maintenance can be cancelled.");
      return view((await repository.find(maintenanceId))!);
    },
    complete: (maintenanceId, operatorId, expectedUpdatedAt, agentAction) => completeTransition(maintenanceId, operatorId, false, expectedUpdatedAt, agentAction),
    autocomplete: (maintenanceId, operatorId, expectedUpdatedAt, agentAction) => completeTransition(maintenanceId, operatorId, true, expectedUpdatedAt, agentAction),
    async remind(maintenanceId, operatorId, expectedUpdatedAt, agentAction) {
      const record = await repository.find(maintenanceId); if (!record) return null;
      const now = nowIso();
      if (record.updatedAt !== expectedUpdatedAt || record.state !== "Scheduled" || !await repository.agentOwned(maintenanceId)
        || Date.parse(record.startsAt) <= Date.parse(now) || Date.parse(record.startsAt) > Date.parse(now) + 24 * 60 * 60_000
        || !reminderPolicy.shouldNotify({ kind: "scheduled", state: record.state, startsAt: record.startsAt, now })) throw new Error("The current agent maintenance reminder is not due.");
      const components = await repository.listComponents(maintenanceId);
      const { notice, statements } = await prepareNotice(record, components, "reminder", operatorId, "eligible", false, agentAction);
      if (!await repository.writeNotice(notice, statements, { updatedAt: expectedUpdatedAt, requireAgentOwned: true })) throw new Error("This maintenance reminder was already published or the plan changed.");
      await onPublicDataChanged();
      return view(record);
    },
    async finishCompletion(maintenanceId, operatorId) {
      const record = await repository.find(maintenanceId);
      if (!record || record.state !== "Completed") return;
      const components = await repository.listComponents(maintenanceId);
      const changedAt = record.completedAt ?? record.updatedAt;
      const agentAction = (await repository.listNotices(maintenanceId)).find(notice => notice.kind === "completed")?.agentAction;
      await Promise.all(components.flatMap((component) => component.componentId ? [componentsService.recomputePublicState(component.componentId, { type: "maintenance", id: maintenanceId, operatorId, ...(agentAction ? { agentAction } : {}) }, changedAt)] : []));
      await onPublicDataChanged();
    },
    async runDue(now = nowIso()) {
      const due = await repository.listDue(now); const started: string[] = []; const completed: string[] = []; const reminded: string[] = [];
      for (const record of due) {
        const automation = await repository.automation.get(record.id);
        if (record.state === "Scheduled" && !automation.autoStart) {
          await onStartDue?.({ maintenanceId: record.id, startsAt: record.startsAt });
          continue;
        }
        if (record.state === "In progress" && !automation.autoComplete) {
          if (Date.parse(now) >= Date.parse(record.endsAt) + 15 * 60_000) await onOverrun({ maintenanceId: record.id, endsAt: record.endsAt });
          continue;
        }
        const components = await repository.listComponents(record.id);
        if (record.state === "Scheduled") {
          const changed = { ...record, state: "In progress" as const, updatedAt: now };
          const { notice, statements } = await prepareNotice(changed, components, "started", null, "eligible");
          if (await repository.transitionWithNotice(record.id, "Scheduled", "In progress", null, now, notice, statements, { startsAt: record.startsAt, endsAt: record.endsAt, autoStart: true })) {
            await Promise.all(components.flatMap((component) => component.componentId ? [componentsService.recomputePublicState(component.componentId, { type: "maintenance", id: record.id, operatorId: null }, now)] : []));
            await events?.maintenanceStarted({ maintenanceId: record.id, reference: record.reference, state: "In progress", occurredAt: now });
            started.push(record.id);
          }
        }
        if (record.state === "In progress") {
          const changed = { ...record, state: "Completed" as const, completedAt: now, updatedAt: now };
          const { notice, statements } = await prepareNotice(changed, components, "completed", null, "eligible");
          if (await repository.transitionWithNotice(record.id, "In progress", "Completed", now, now, notice, statements, { startsAt: record.startsAt, endsAt: record.endsAt, autoComplete: true })) {
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
