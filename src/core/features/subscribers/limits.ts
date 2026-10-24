export type SubscriberChannel = "email" | "webhook" | "slack" | "teams";
export interface SubscriberCounts { total:number;email:number;webhook:number;slack:number;teams:number }
export interface SubscriberCapacity { channel:"all"|SubscriberChannel|"slack-and-teams";count:number;limit:number }
export const subscriberLimits = { total:25_000,webhook:2_500,chat:1_000 } as const;
export class SubscriberLimitError extends Error {
  readonly status=409;
  constructor(){super("This page cannot take new subscriptions on that channel right now.");this.name="SubscriberLimitError";}
}
export function subscriberCapacity(counts:SubscriberCounts):SubscriberCapacity[] {
  return [
    {channel:"all",count:counts.total,limit:subscriberLimits.total},
    {channel:"email",count:counts.email,limit:subscriberLimits.total},
    {channel:"webhook",count:counts.webhook,limit:subscriberLimits.webhook},
    {channel:"slack",count:counts.slack,limit:subscriberLimits.chat},
    {channel:"teams",count:counts.teams,limit:subscriberLimits.chat},
    {channel:"slack-and-teams",count:counts.slack+counts.teams,limit:subscriberLimits.chat},
  ];
}
export function subscriberChannelFull(counts:SubscriberCounts,channel:SubscriberChannel):boolean {
  return counts.total>=subscriberLimits.total || channel==="webhook"&&counts.webhook>=subscriberLimits.webhook
    || (channel==="slack"||channel==="teams")&&counts.slack+counts.teams>=subscriberLimits.chat;
}
/** A fresh import plans its complete demand, then labels the excess rows. No
 * fitting prefix is applied while another selected row exceeds capacity. */
export function planSubscriberCapacity<T extends {channel:SubscriberChannel}>(counts:SubscriberCounts,rows:T[]) {
  const requested={...counts};
  for(const row of rows){requested.total++;requested[row.channel]++;}
  const summaries:string[]=[];
  const format=(value:number)=>value.toLocaleString("en-US");
  for(const channel of [...new Set(rows.map(row=>row.channel))]) {
    const limit=channel==="webhook"?subscriberLimits.webhook:channel==="email"?subscriberLimits.total:subscriberLimits.chat;
    const projected=channel==="slack"||channel==="teams"?requested.slack+requested.teams:channel==="email"?requested.total:requested.webhook;
    if(projected>limit)summaries.push(`${channel} would reach ${format(projected)}, over the ${format(limit)} limit by ${format(projected-limit)}`);
  }
  if(requested.total>subscriberLimits.total&&!rows.some(row=>row.channel==="email"))summaries.push(`all channels would reach ${format(requested.total)}, over the ${format(subscriberLimits.total)} limit by ${format(requested.total-subscriberLimits.total)}`);
  const occupied={...counts},refused=new Set<T>();
  for(const row of rows) {
    if(subscriberChannelFull(occupied,row.channel))refused.add(row);
    else {occupied.total++;occupied[row.channel]++;}
  }
  return {refused,summaries};
}
export function subscriberLimitAlerts(counts:SubscriberCounts) {
  const buckets=[{channel:"all channels",key:"all",count:counts.total,limit:subscriberLimits.total},
    {channel:"webhook",key:"webhook",count:counts.webhook,limit:subscriberLimits.webhook},
    {channel:"Slack and Teams",key:"chat",count:counts.slack+counts.teams,limit:subscriberLimits.chat}];
  return buckets.flatMap(bucket=>[80,100].filter(percent=>bucket.count>=bucket.limit*percent/100).map(percent=>({
    eventId:`subscriber-limit/${bucket.key}/${percent}`,title:`Lamp ${bucket.channel} subscriptions reached ${percent}%`,
    text:`${bucket.channel} subscriptions reached ${percent}% of their ${bucket.limit.toLocaleString("en-US")} limit. Review Settings → Subscribers.`,
  })));
}
