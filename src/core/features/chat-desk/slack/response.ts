export function responseUrl(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Invalid Slack response address.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'hooks.slack.com' || url.port || url.username || url.password || url.hash) throw new Error('Slack responses must use hooks.slack.com.');
  return url.href;
}
export async function postResponse(url: string, payload: unknown) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(url, { method: 'POST', redirect: 'manual', credentials: 'omit', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Slack did not accept the incident response. Open the incident in the operator app.');
  } finally { clearTimeout(timer); }
}
