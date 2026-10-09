export interface SendGridMessage {
  readonly from: string
  readonly to: readonly string[]
  readonly subject: string
  readonly text: string
  readonly html?: string | null
  readonly replyTo?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly attachments?: readonly { readonly content: string; readonly filename: string; readonly type?: string }[]
  readonly asmGroupId?: number
  readonly subscriptionTracking?: boolean
  readonly customArgs?: Readonly<Record<string, string>>
  /** Durable local command ID for correlation; SendGrid does not deduplicate it. */
  readonly deliveryId: string
}

export class SendGridSendError extends Error {
  public readonly outcome: 'rejected' | 'rate_limited' | 'ambiguous'
  public readonly status: number | undefined
  constructor(
    outcome: 'rejected' | 'rate_limited' | 'ambiguous',
    message: string,
    status?: number,
  ) {
    super(message)
    this.name = 'SendGridSendError'
    this.outcome = outcome
    this.status = status
  }
}

const forbiddenHeaders = new Set(['x-sg-id', 'x-sg-eid', 'received', 'dkim-signature', 'content-type', 'content-transfer-encoding', 'to', 'from', 'subject', 'reply-to', 'cc', 'bcc'])

function address(value: string): { email: string; name?: string } {
  if (/[\r\n\0]/.test(value)) throw new SendGridSendError('rejected', 'Mail address contains a control character.')
  const match = value.trim().match(/^(?:(.*?)\s*<([^<>]+)>|([^<>]+))$/)
  const email = (match?.[2] ?? match?.[3] ?? '').trim()
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new SendGridSendError('rejected', 'Mail address is invalid.')
  const name = match?.[1]?.trim().replace(/^"(.*)"$/, '$1')
  return name ? { email, name } : { email }
}

/** Validated wire envelope, also usable as a durable claim fingerprint. */
export function serializeSendGridMessage(message: SendGridMessage): string {
  if (!message.deliveryId || message.deliveryId.length > 512) throw new SendGridSendError('rejected', 'A bounded durable delivery ID is required.')
  if (message.to.length === 0) throw new SendGridSendError('rejected', 'At least one recipient is required.')
  if (message.asmGroupId !== undefined && (!Number.isSafeInteger(message.asmGroupId) || message.asmGroupId <= 0)) throw new SendGridSendError('rejected', 'ASM group ID must be a positive integer.')
  if (message.subscriptionTracking !== undefined && typeof message.subscriptionTracking !== 'boolean') throw new SendGridSendError('rejected', 'Subscription tracking must be boolean.')
  const customArgs = message.customArgs ?? {}
  const reservedArgs = new Set(['rer_delivery_id', 'email', 'event', 'timestamp', 'sg_event_id', 'sg_message_id'])
  if (Object.entries(customArgs).some(([key, value]) => !key || reservedArgs.has(key) || typeof value !== 'string' || /[\r\n\0]/.test(key))) throw new SendGridSendError('rejected', 'Invalid or reserved custom argument.')
  if (new TextEncoder().encode(JSON.stringify({ ...customArgs, rer_delivery_id: message.deliveryId })).length > 10_000) throw new SendGridSendError('rejected', 'Custom arguments exceed provider limit.')
  const headers = message.headers ?? {}
  for (const [name, value] of Object.entries(headers)) {
    if (!name || /[\r\n\0]/.test(name + value) || forbiddenHeaders.has(name.toLowerCase())) {
      throw new SendGridSendError('rejected', 'Invalid or reserved SendGrid message header.')
    }
  }
  const content = [{ type: 'text/plain', value: message.text }]
  if (message.html) content.push({ type: 'text/html', value: message.html })
  return JSON.stringify({
    personalizations: [{ to: message.to.map(address) }],
    from: address(message.from),
    subject: message.subject,
    content,
    ...(message.replyTo ? { reply_to: address(message.replyTo) } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(message.attachments?.length ? { attachments: message.attachments.map((attachment) => ({ ...attachment, disposition: 'attachment' })) } : {}),
    custom_args: { ...customArgs, rer_delivery_id: message.deliveryId },
    ...(message.asmGroupId !== undefined ? { asm: { group_id: message.asmGroupId } } : {}),
    tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false }, ganalytics: { enable: false }, ...(message.subscriptionTracking !== undefined ? { subscription_tracking: { enable: message.subscriptionTracking } } : {}) },
  })
}

/** One attempt only. Acceptance and a provider receipt are distinct evidence. */
export async function sendSendGrid(input: {
  readonly apiKey: string
  readonly message: SendGridMessage
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMilliseconds?: number
}): Promise<{ provider: 'sendgrid'; providerMessageId: string | null; state: 'accepted' }> {
  if (!input.apiKey.trim()) throw new SendGridSendError('rejected', 'SendGrid API key is required.')
  const body = serializeSendGridMessage(input.message)
  let response: Response
  try {
    response = await (input.fetch ?? globalThis.fetch)('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
      redirect: 'manual', // Never forward mail or credentials beyond the declared provider endpoint.
      body, signal: AbortSignal.timeout(input.timeoutMilliseconds ?? 15_000),
    })
  } catch {
    throw new SendGridSendError('ambiguous', 'SendGrid submission did not return a receipt; reconcile before resending.')
  }
  if (response.status === 429) throw new SendGridSendError('rate_limited', 'SendGrid rate limited this submission.', response.status)
  if (response.status >= 400 && response.status < 500 && response.status !== 408) throw new SendGridSendError('rejected', `SendGrid rejected this submission (${response.status}).`, response.status)
  if (response.status !== 202) throw new SendGridSendError('ambiguous', `SendGrid returned an unconfirmed submission status (${response.status}); reconcile before resending.`, response.status)
  const providerMessageId = response.headers.get('x-message-id')?.trim()
  // HTTP 202 establishes acceptance; a missing/malformed header loses correlation
  // evidence, not acceptance. Never fabricate a provider receipt or resend here.
  return { provider: 'sendgrid', providerMessageId: providerMessageId && !/[\r\n\0]/.test(providerMessageId) ? providerMessageId : null, state: 'accepted' }
}
