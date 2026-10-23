import type { WebhookFormat } from "./webhook-format";

export function createWebhookFormatRepository(db:D1Database) {
  return {
    async get(subscriberId:string):Promise<WebhookFormat> {
      return (await db.prepare("SELECT webhook_format AS format FROM subscribers WHERE id=?").bind(subscriberId).first<{format:WebhookFormat}>())?.format??"lamp";
    },
    async set(subscriberId:string,format:WebhookFormat):Promise<void> {
      await db.prepare("UPDATE subscribers SET webhook_format=? WHERE id=? AND channel='webhook'").bind(format,subscriberId).run();
    },
  };
}
