import { createUlid, nowIso } from "../../shared/ids";
import type { LampEventDispatcher } from "../../api/extensions";
import type { ComponentsService } from "../components";
import { defaultMaintenanceRemindersPolicy, type MaintenanceRemindersPolicy } from "./policies";
import type { MaintenanceNotice, MaintenanceRepository, StoredMaintenance, StoredMaintenanceComponent } from "./repository";

export type MaintenanceView = StoredMaintenance & { components: StoredMaintenanceComponent[]; notices: MaintenanceNotice[]; importedUpdates: Awaited<ReturnType<MaintenanceRepository["listImportedUpdates"]>>; overrunning: boolean };

export interface MaintenanceNotificationStatements {
  forMaintenanceNotice(input: { eventId: string; maintenanceId: string; componentIds: string[]; kind: MaintenanceNotice["kind"]; queuedAt: string; recipientScope: "eligible" | "previous"; previousEventIds: string[] }): Promise<D1PreparedStatement[]>;
}

export interface MaintenanceInput { title: string; startsAt: string; endsAt: string; componentIds: string[]; }

export interface MaintenanceOverrunAlertEvent {
  maintenanceId: string;
  endsAt: string;
}

export type MaintenanceRuntimeEvents = Pick<LampEventDispatcher, "maintenanceScheduled" | "maintenanceStarted" | "maintenanceCompleted">;

export interface MaintenanceService {
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

export function createMaintenanceService(
  repository: MaintenanceRepository,
  componentsService: ComponentsService,
  onPublicDataChanged: () => Promise<void>,
  notificationStatements: MaintenanceNotificationStatements | null = null,
  reminderPolicy: MaintenanceRemindersPolicy = defaultMaintenanceRemindersPolicy,
  onOverrun: (event: MaintenanceOverrunAlertEvent) => Promise<void>,
  events?: MaintenanceRuntimeEvents,
): MaintenanceService {
  const view = async (record: StoredMaintenance): Promise<MaintenanceView> => ({ ...record, components: await repository.listComponents(record.id), notices: await repository.listNotices(record.id), importedUpdates: await repository.listImportedUpdates(record.id), overrunning: record.state === "In progress" && new Date(record.endsAt).getTime() + 15 * 60 * 1000 < Date.now() });
  const prepareNotice = async (record: StoredMaintenance, components: StoredMaintenanceComponent[], kind: MaintenanceNotice["kind"], operatorId: string | null, recipientScope: "eligible" | "previous") => {
    if (!notificationStatements) throw new Error("Maintenance notification transaction wiring is required.");
    const timestamp = nowIso(); const notice: MaintenanceNotice = { id: createUlid(), maintenanceId: record.id, kind, body: `${record.reference}: ${record.title}`, publishedAt: timestamp, authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
    const previousEventIds = recipientScope === "previous" ? (await repository.listNotices(record.id)).map((prior) => prior.id) : [];
    const statements = await notificationStatements.forMaintenanceNotice({ eventId: notice.id, maintenanceId: record.id, componentIds: components.flatMap((component) => component.componentId ? [component.componentId] : []), kind, queuedAt: timestamp, recipientScope, previousEventIds });
    return { notice, statements };
  };
  const notify = async (record: StoredMaintenance, components: StoredMaintenanceComponent[], kind: MaintenanceNotice["kind"], operatorId: string | null, recipientScope: "eligible" | "previous") => {
    const { notice, statements } = await prepareNotice(record, components, kind, operatorId, recipientScope);
    return repository.writeNotice(notice, statements);
  };
  return {
    async list() {
      const records = await repository.listMaintenance();
      const result = await Promise.all(records.map(view));
      await Promise.all(result.filter((record) => record.overrunning).map((record) => onOverrun({ maintenanceId: record.id, endsAt: record.endsAt })));
      return result;
    },
    async create(input, operatorId) {
      if (!input.title.trim() || input.title.length > 250) throw new Error("Maintenance title is required and must be at most 250 characters.");
      assertWindow(input.startsAt, input.endsAt);
      if (!input.componentIds.length) throw new Error("Attach at least one component to maintenance.");
      if (!notificationStatements) throw new Error("Maintenance notification transaction wiring is required.");
      const components = await Promise.all(input.componentIds.map((id) => componentsService.get(id)));
      if (components.some((component) => !component)) throw new Error("One or more attached components no longer exist.");
      const timestamp = nowIso(); const maintenanceId = createUlid();
      const reference = await repository.allocateMaintenanceReference();
      const record: StoredMaintenance = { id: maintenanceId, reference, title: input.title.trim(), state: "Scheduled", startsAt: input.startsAt, endsAt: input.endsAt, completedAt: null, createdByOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
      const attached = components.map((component) => ({ id: createUlid(), maintenanceId, componentId: component!.id, componentName: component!.name, state: "Under maintenance" as const, createdAt: timestamp, updatedAt: timestamp }));
      const notice: MaintenanceNotice = { id: createUlid(), maintenanceId, kind: "scheduled", body: `${record.reference}: ${record.title}`, publishedAt: timestamp, authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
      const statements = await notificationStatements.forMaintenanceNotice({ eventId: notice.id, maintenanceId, componentIds: attached.flatMap((component) => component.componentId ? [component.componentId] : []), kind: notice.kind, queuedAt: timestamp, recipientScope: "eligible", previousEventIds: [] });
      await repository.create(record, attached, notice, statements);
      await events?.maintenanceScheduled({ maintenanceId, reference: record.reference, state: "Scheduled", occurredAt: timestamp });
      return view(record);
    },
    async reschedule(maintenanceId, input, operatorId) {
      assertWindow(input.startsAt, input.endsAt);
      const record = await repository.find(maintenanceId); if (!record) return null;
      const timestamp = nowIso(); const components = await repository.listComponents(maintenanceId);
      const changed = { ...record, startsAt: input.startsAt, endsAt: input.endsAt, updatedAt: timestamp };
      const { notice, statements } = await prepareNotice(changed, components, "rescheduled", operatorId, "previous");
      if (!(await repository.updateWindowWithNotice(maintenanceId, input.startsAt, input.endsAt, timestamp, notice, statements))) throw new Error("Only scheduled maintenance can be rescheduled.");
      return view((await repository.find(maintenanceId))!);
    },
    async cancel(maintenanceId, operatorId) {
      const record = await repository.find(maintenanceId); if (!record) return null;
      const timestamp = nowIso(); const components = await repository.listComponents(maintenanceId);
      const changed = { ...record, state: "Cancelled" as const, updatedAt: timestamp };
      const { notice, statements } = await prepareNotice(changed, components, "cancelled", operatorId, "previous");
      if (!(await repository.cancelWithNotice(maintenanceId, timestamp, notice, statements))) throw new Error("Only scheduled maintenance can be cancelled.");
      return view((await repository.find(maintenanceId))!);
    },
    async complete(maintenanceId, operatorId) {
      const record = await repository.find(maintenanceId); if (!record) return null;
      const timestamp = nowIso(); const components = await repository.listComponents(maintenanceId);
      const changed = { ...record, state: "Completed" as const, completedAt: timestamp, updatedAt: timestamp };
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
          const changed = { ...record, state: "In progress" as const, updatedAt: now };
          const { notice, statements } = await prepareNotice(changed, components, "started", null, "eligible");
          if (await repository.transitionWithNotice(record.id, "Scheduled", "In progress", null, now, notice, statements)) {
            await Promise.all(components.flatMap((component) => component.componentId ? [componentsService.recomputePublicState(component.componentId, { type: "maintenance", id: record.id, operatorId: null }, now)] : []));
            await events?.maintenanceStarted({ maintenanceId: record.id, reference: record.reference, state: "In progress", occurredAt: now });
            started.push(record.id);
          }
        }
        if (record.state === "In progress") {
          const changed = { ...record, state: "Completed" as const, completedAt: now, updatedAt: now };
          const { notice, statements } = await prepareNotice(changed, components, "completed", null, "eligible");
          if (await repository.transitionWithNotice(record.id, "In progress", "Completed", now, now, notice, statements)) {
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
