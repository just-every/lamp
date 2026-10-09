import { MailUnavailableError, type MailSender } from "../../platform/mail";
import { createOpaqueToken, hashOpaqueToken } from "../../platform/security/opaque-tokens";
import { createUlid, nowIso } from "../../shared/ids";

import { erasedOperatorEmail, type StoredFormerOperator, type StoredOperator, type SessionRepository } from "./repository";

const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const MAGIC_LINK_MS = 20 * 60 * 1000;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function expiresAfter(milliseconds: number) {
  return new Date(Date.now() + milliseconds).toISOString();
}

export interface SessionService {
  getActiveOperator(sessionId: string): Promise<StoredOperator | null>;
  requestSignIn(email: string, origin: string): Promise<void>;
  consumeSignIn(token: string): Promise<{ sessionId: string; operator: StoredOperator } | null>;
  signOut(sessionId: string): Promise<void>;
  listOperators(): Promise<StoredOperator[]>;
  listFormerOperators(): Promise<StoredFormerOperator[]>;
  inviteOperator(input: { email: string; displayName: string; invitedByOperatorId: string; origin: string }): Promise<void>;
  revokeOperatorAccess(input: { operatorId: string; requestedByOperatorId: string }): Promise<boolean>;
  eraseOperator(input: { operatorId: string; requestedByOperatorId: string }): Promise<boolean>;
}

export function createSessionService(repository: SessionRepository, mail?: MailSender, mailFrom?: string | (() => Promise<string>)): SessionService {
  const resolveFrom = async () => typeof mailFrom === "function" ? mailFrom() : mailFrom;
  async function sendMagicLink(input: { id: string; email: string; kind: "signin" | "invite"; token: string; origin: string }) {
    const from = await resolveFrom();
    if (!mail || !from || !mail.configured) throw new MailUnavailableError();
    const action = input.kind === "signin" ? "Sign in to Lamp" : "Accept your Lamp operator invitation";
    const url = new URL(`/signin/complete/${encodeURIComponent(input.token)}`, input.origin).toString();
    await mail.send({
      from,
      to: input.email,
      subject: action,
      text: `${action}: ${url}\n\nThis link expires in 20 minutes.`,
      headers: { "Auto-Submitted": "auto-generated" },
      idempotencyKey: `magic-link/${input.id}`,
    });
  }

  async function issueMagicLink(input: { email: string; displayName: string; operatorId: string | null; kind: "signin" | "invite"; invitedByOperatorId: string | null; origin: string }) {
    const timestamp = nowIso();
    const id = createUlid();
    const token = createOpaqueToken();
    await repository.insertMagicLink({
      id,
      operatorId: input.operatorId,
      email: input.email,
      displayName: input.displayName,
      kind: input.kind,
      tokenHash: await hashOpaqueToken(token),
      expiresAt: expiresAfter(MAGIC_LINK_MS),
      consumedAt: null,
      revokedAt: null,
      invitedByOperatorId: input.invitedByOperatorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    try {
      await sendMagicLink({ id, email: input.email, kind: input.kind, token, origin: input.origin });
    } catch (error) {
      await repository.revokeMagicLink(id, nowIso());
      throw error;
    }
  }

  return {
    async getActiveOperator(sessionId) {
      const operator = await repository.findActiveOperator(sessionId, nowIso());
      if (!operator) return null;
      await repository.touchSession(sessionId, expiresAfter(SESSION_IDLE_MS), nowIso());
      return operator;
    },
    async requestSignIn(email, origin) {
      if (!mail || !await resolveFrom() || !mail.configured) throw new MailUnavailableError();
      const operator = await repository.findOperatorByEmail(normalizeEmail(email));
      // Do not reveal the allow-list to the person asking for a link.
      if (!operator) return;
      await issueMagicLink({ email: operator.email, displayName: operator.displayName, operatorId: operator.id, kind: "signin", invitedByOperatorId: null, origin });
    },
    async consumeSignIn(token) {
      const timestamp = nowIso();
      const link = await repository.findUsableMagicLink(await hashOpaqueToken(token), timestamp);
      if (!link || !(await repository.consumeMagicLink(link.id, timestamp))) return null;
      let operator = link.operatorId ? await repository.findOperator(link.operatorId) : null;
      if (link.kind === "invite" && !operator) {
        await repository.insertOperator({ id: createUlid(), email: link.email, displayName: link.displayName, isSetupOperator: false, createdAt: timestamp, updatedAt: timestamp });
        operator = await repository.findOperatorByEmail(link.email);
      }
      if (!operator) return null;
      const sessionId = createUlid();
      await repository.insertSession({ id: sessionId, operatorId: operator.id, expiresAt: expiresAfter(SESSION_IDLE_MS), createdAt: timestamp, updatedAt: timestamp });
      return { sessionId, operator };
    },
    async signOut(sessionId) {
      await repository.revokeSession(sessionId);
    },
    async listOperators() {
      return repository.listOperators();
    },
    async listFormerOperators() {
      return repository.listFormerOperators();
    },
    async inviteOperator(input) {
      if (!mail || !await resolveFrom() || !mail.configured) throw new MailUnavailableError();
      const email = normalizeEmail(input.email);
      if (await repository.findOperatorByEmail(email)) throw new Error("That operator is already active.");
      await issueMagicLink({ email, displayName: input.displayName.trim(), operatorId: null, kind: "invite", invitedByOperatorId: input.invitedByOperatorId, origin: input.origin });
    },
    async revokeOperatorAccess({ operatorId, requestedByOperatorId }) {
      const operator = await repository.findOperator(operatorId);
      if (!operator) return false;
      if (operator.isSetupOperator && operator.id !== requestedByOperatorId) throw new Error("Only the configured setup operator can remove themselves.");
      const revokedAt = nowIso();
      return repository.revokeOperatorAccess({ operatorId: operator.id, requestedByOperatorId, revokedAt, auditId: createUlid() });
    },
    async eraseOperator({ operatorId, requestedByOperatorId }) {
      const operator = await repository.findOperatorIncludingDeactivated(operatorId);
      if (!operator) return false;
      if (operator.isSetupOperator && operator.id !== requestedByOperatorId) throw new Error("Only the configured setup operator can erase themselves.");
      const erasedEmail = erasedOperatorEmail(operator.id);
      if (operator.email === erasedEmail) return true;
      const erasedAt = nowIso();
      return repository.eraseOperator({ operatorId: operator.id, originalEmail: operator.email, erasedEmail, erasedAt, auditId: createUlid(), requestedByOperatorId });
    },
  };
}
