import type { ChatIdentity, ChatLinksRepository } from './links.repository';
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function randomCode() {
  return [...crypto.getRandomValues(new Uint8Array(24))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createChatLinksService(repository: ChatLinksRepository, audit: (operator: string, action: string, entity: string) => Promise<void>) {
  return {
    async mint(operator: string) {
      const code = randomCode(), expiresAt = Date.now() + 600_000;
      await repository.mint(operator, await digest(code), expiresAt);
      return { code, expiresAt: new Date(expiresAt).toISOString() };
    },
    async link(code: string, identity: ChatIdentity) {
      if (!/^[a-f0-9]{48}$/.test(code)) throw new Error('The link code is invalid or expired. Create a new code in the operator app.');
      const operator = await repository.redeem(await digest(code), identity, Date.now());
      if (!operator) throw new Error('The link code is invalid, used or expired, or this chat identity is already linked.');
      await audit(operator, 'linked', identity.transport);
      return { message: 'Chat identity linked. You can now open an incident.' };
    },
    list: repository.list,
    async remove(id: string, operator: string) {
      const removed = await repository.remove(id, operator);
      if (removed) await audit(operator, 'unlinked', id);
      return removed;
    },
  };
}
