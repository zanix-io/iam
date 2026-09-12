/**
 * Test-only `globalThis.fetch` stub for exercising an `IamApiClient` subclass without a real
 * network call. Records the request `fetch` was actually called with, and returns a canned
 * `Response` built from `status`/`body`.
 */
export interface MockFetchCall {
  url: string
  method: string
  headers: Headers
  body: string | undefined
}

/** Parses a recorded call's JSON body — throws (rather than a non-null assertion) when no body
 * was actually sent, so a test asserting on a GET call's body fails loudly instead of silently. */
export function bodyJson(call: MockFetchCall): unknown {
  if (call.body === undefined) throw new Error('Expected this call to carry a request body.')
  return JSON.parse(call.body)
}

export function withMockFetch<T>(
  responses: Array<{ status: number; body?: unknown }>,
  run: (calls: MockFetchCall[]) => Promise<T>,
): Promise<T> {
  const calls: MockFetchCall[] = []
  const original = globalThis.fetch
  let callIndex = 0

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const response = responses[Math.min(callIndex, responses.length - 1)]
    callIndex++
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    const text = response.body === undefined ? '' : JSON.stringify(response.body)
    return Promise.resolve(
      new Response(text, {
        status: response.status,
        headers: response.body === undefined ? {} : { 'Content-Type': 'application/json' },
      }),
    )
  }) as typeof fetch

  return run(calls).finally(() => {
    globalThis.fetch = original
  })
}
