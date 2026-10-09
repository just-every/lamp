import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
const { sendSendGrid, SendGridSendError } = await import(new URL('sender.ts', process.env.RER_COMPONENT_SOURCE ?? new URL('../src/', import.meta.url)).href)

function isSendGridError(error: unknown): error is Error & {
  outcome: 'rejected' | 'rate_limited' | 'ambiguous'
  status?: number
} {
  return error instanceof Error && error instanceof SendGridSendError
    && 'outcome' in error
    && typeof error.outcome === 'string'
    && ['rejected', 'rate_limited', 'ambiguous'].includes(error.outcome)
    && (!('status' in error) || error.status === undefined || typeof error.status === 'number')
}

const message = { from: 'Support <support@example.com>', to: ['person@example.com'], subject: 'Your request', text: 'Reply', html: '<p>Reply</p>', deliveryId: 'durable-1' }

test('sends authenticated v3 mail with durable correlation and reports acceptance only', async () => {
  let calls = 0
  const result = await sendSendGrid({ apiKey: 'test-secret', message: {
    ...message, replyTo: 'reply@example.com', headers: { 'In-Reply-To': '<first@example.com>' },
    attachments: [{ content: 'aGk=', filename: 'proof.txt', type: 'text/plain' }],
  }, fetch: async (url: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
    calls++
    assert.equal(url, 'https://api.sendgrid.com/v3/mail/send')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-secret')
    assert.equal(init?.redirect, 'manual')
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(body.from, { name: 'Support', email: 'support@example.com' })
    assert.deepEqual(body.personalizations, [{ to: [{ email: 'person@example.com' }] }])
    assert.deepEqual(body.custom_args, { rer_delivery_id: 'durable-1' })
    assert.deepEqual(body.reply_to, { email: 'reply@example.com' })
    assert.equal(body.attachments[0].disposition, 'attachment')
    assert.equal(body.tracking_settings.click_tracking.enable, false)
    return new Response(null, { status: 202, headers: { 'X-Message-Id': 'provider-receipt' } })
  } })
  assert.deepEqual(result, { provider: 'sendgrid', providerMessageId: 'provider-receipt', state: 'accepted' })
  assert.equal(calls, 1)
})

test('uncertain submission never triggers a duplicate automatic attempt', async () => {
  for (const response of [null, new Response(null, { status: 500 }), new Response(null, { status: 408 }), new Response(null, { status: 200 })]) {
    let calls = 0
    await assert.rejects(sendSendGrid({ apiKey: 'test', message, fetch: async () => {
      calls++
      if (response === null) throw new Error('network interruption')
      return response
    } }), (error: unknown) => isSendGridError(error) && error.outcome === 'ambiguous')
    assert.equal(calls, 1)
  }
})

test('rejection and rate limit are explicit and provider response bodies stay private', async () => {
  for (const [status, outcome] of [[400, 'rejected'], [401, 'rejected'], [429, 'rate_limited']] as const) {
    await assert.rejects(sendSendGrid({ apiKey: 'test', message, fetch: async () => new Response('private-provider-details', { status }) }),
      (error: unknown) => isSendGridError(error) && error.outcome === outcome && error.status === status && !error.message.includes('private-provider-details'))
  }
})

test('invalid recipient or reserved headers fail before a provider call', async () => {
  for (const badMessage of [{ ...message, to: [] }, { ...message, to: ['bad\r\n@example.com'] }, { ...message, headers: { From: 'other@example.com' } }]) {
    let calls = 0
    await assert.rejects(sendSendGrid({ apiKey: 'test', message: badMessage, fetch: async () => { calls++; return new Response(null, { status: 202 }) } }), SendGridSendError)
    assert.equal(calls, 0)
  }
})

test('optional provider unsubscribe settings and product marker preserve command correlation', async () => {
  await sendSendGrid({ apiKey: 'test', message: { ...message, asmGroupId: 33984, subscriptionTracking: true, customArgs: { rer_product: 'orbit' } }, fetch: async (_url: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(body.asm, { group_id: 33984 })
    assert.deepEqual(body.custom_args, { rer_product: 'orbit', rer_delivery_id: 'durable-1' })
    assert.deepEqual(body.tracking_settings.subscription_tracking, { enable: true })
    assert.equal(body.tracking_settings.open_tracking.enable, false)
    assert.equal(body.tracking_settings.click_tracking.enable, false)
    return new Response(null, { status: 202, headers: { 'x-message-id': 'accepted' } })
  } })
})

test('invalid ASM and reserved correlation are rejected without network activity', async () => {
  for (const extra of [{ asmGroupId: 0 }, { asmGroupId: 1.5 }, { customArgs: { rer_delivery_id: 'override' } }, { customArgs: { metadata: 'x'.repeat(10001) } }]) {
    let called = false
    await assert.rejects(sendSendGrid({ apiKey: 'test', message: { ...message, ...extra }, fetch: async () => { called = true; throw new Error('must not send') } }), SendGridSendError)
    assert.equal(called, false)
  }
})


test('native fetch refuses redirects without sending mail to a redirect destination', async () => {
  let destinationCalls = 0
  let providerCalls = 0
  let status = 307
  const destination = createServer((_request, response) => {
    destinationCalls++
    response.writeHead(202, { 'x-message-id': 'redirect-receipt' }).end()
  })
  destination.listen(0, '127.0.0.1')
  await once(destination, 'listening')
  const destinationAddress = destination.address()
  assert.ok(destinationAddress && typeof destinationAddress === 'object')
  const destinationUrl = `http://127.0.0.1:${destinationAddress.port}/canary`
  const provider = createServer((request, response) => {
    providerCalls++
    request.resume()
    response.writeHead(status, { location: destinationUrl }).end()
  })
  provider.listen(0, '127.0.0.1')
  await once(provider, 'listening')
  const providerAddress = provider.address()
  assert.ok(providerAddress && typeof providerAddress === 'object')
  const providerUrl = `http://127.0.0.1:${providerAddress.port}/send`
  try {
    // Prove the local canary observes native fetch's default redirect behavior.
    assert.equal((await fetch(providerUrl, { method: 'POST', body: 'canary-control' })).status, 202)
    assert.equal(destinationCalls, 1)
    destinationCalls = 0
    providerCalls = 0
    for (status of [301, 302, 303, 307, 308]) {
      await assert.rejects(sendSendGrid({ apiKey: 'local-test-key', message, fetch: (url: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
        assert.equal(url, 'https://api.sendgrid.com/v3/mail/send')
        // Only substitute the endpoint; exercise the sender's real fetch options.
        return globalThis.fetch(providerUrl, init)
      } }), (error: unknown) => isSendGridError(error) && error.outcome === 'ambiguous' && error.status === status)
    }
    assert.equal(providerCalls, 5, 'exactly one submission per redirect response')
    assert.equal(destinationCalls, 0, 'redirect destination receives neither message nor credentials')
  } finally {
    provider.closeAllConnections()
    destination.closeAllConnections()
    await Promise.all([new Promise<void>((resolve) => provider.close(() => resolve())), new Promise<void>((resolve) => destination.close(() => resolve()))])
  }
})

 test('HTTP 202 without a usable receipt remains accepted with explicitly absent provider evidence', async () => {
  for (const headers of [{}, { 'x-message-id': '   ' }]) {
    let calls = 0
    const result = await sendSendGrid({ apiKey: 'test', message, fetch: async () => { calls++; return new Response(null, { status: 202, headers }) } })
    assert.deepEqual(result, { provider: 'sendgrid', state: 'accepted', providerMessageId: null })
    assert.equal(calls, 1)
  }
})

test('native fetch interruption and timeout are ambiguous without a second attempt', async () => {
  let calls = 0
  let mode = 'interrupt'
  const provider = createServer((request, response) => {
    calls++
    request.resume()
    if (mode === 'interrupt') request.socket.destroy()
    // timeout mode intentionally never supplies a response.
  })
  provider.listen(0, '127.0.0.1')
  await once(provider, 'listening')
  const endpoint = provider.address()
  assert.ok(endpoint && typeof endpoint === 'object')
  try {
    for (mode of ['interrupt', 'timeout']) {
      await assert.rejects(sendSendGrid({ apiKey: 'local-test-key', message, timeoutMilliseconds: 100, fetch: (_url: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => globalThis.fetch(`http://127.0.0.1:${endpoint.port}/send`, init) }),
        (error: unknown) => isSendGridError(error) && error.outcome === 'ambiguous')
    }
    assert.equal(calls, 2)
  } finally {
    provider.closeAllConnections()
    await new Promise<void>(resolve => provider.close(() => resolve()))
  }
})
