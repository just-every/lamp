import { SubscriberLimitError, subscriberCapacity, subscriberChannelFull, subscriberLimitAlerts, type SubscriberChannel, type SubscriberCounts } from "./limits";

export function createSubscriberLimitRepository(db:D1Database) {
  async function counts():Promise<SubscriberCounts> {
    const row=await db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(channel='email'),0) AS email,COALESCE(SUM(channel='webhook'),0) AS webhook,
      COALESCE(SUM(channel='slack'),0) AS slack,COALESCE(SUM(channel='teams'),0) AS teams
      FROM subscriber_directory AS subscribers WHERE state IN ('pending','active')`).first<SubscriberCounts>();
    if(!row)throw new Error("Subscriber counts could not be read.");
    return row;
  }
  return {
    counts,
    async assertAvailable(channel:SubscriberChannel) {if(subscriberChannelFull(await counts(),channel))throw new SubscriberLimitError();},
    async report(){return subscriberCapacity(await counts());},
    async alerts(){return subscriberLimitAlerts(await counts());},
  };
}
export type SubscriberLimitRepository=ReturnType<typeof createSubscriberLimitRepository>;
