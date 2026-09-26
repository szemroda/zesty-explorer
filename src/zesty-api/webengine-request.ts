// Anonymous GET requests to WebEngine endpoints (ADR 0011). They carry no cookies, session token,
// or custom headers, so a CORS-enabled endpoint answers without a preflight.
import { Effect } from 'effect';

export interface EndpointResponse {
  readonly status: number;
  readonly statusText: string;
  readonly contentType: string;
  readonly durationMs: number;
  readonly body: string;
  /** Bytes of the body that were read. */
  readonly bytes: number;
  /** Reading stopped at the size limit, so `body` is only the start of the response. */
  readonly truncated: boolean;
}

/**
 * `unreadable`: the browser exposed no response. The host may be unreachable, or it answered
 * without CORS headers, as WebEngine error pages do; scripts cannot tell these apart.
 */
export type EndpointFailure = { readonly kind: 'unreadable' } | { readonly kind: 'timeout' };

export interface EndpointRequestOptions {
  readonly timeoutMs?: number;
  readonly limitBytes?: number;
}

export const endpointTimeoutMs = 30_000;
export const endpointLimitBytes = 10 * 1024 * 1024;

/** GETs an endpoint URL, reading at most `limitBytes` of its body. Interrupting it aborts the request. */
export function requestEndpoint(
  url: string,
  { timeoutMs = endpointTimeoutMs, limitBytes = endpointLimitBytes }: EndpointRequestOptions = {},
): Effect.Effect<EndpointResponse, EndpointFailure> {
  return Effect.tryPromise({
    try: (signal) => fetchEndpoint(url, limitBytes, signal),
    catch: (): EndpointFailure => ({ kind: 'unreadable' }),
  }).pipe(
    Effect.timeoutFail({
      duration: timeoutMs,
      onTimeout: (): EndpointFailure => ({ kind: 'timeout' }),
    }),
  );
}

async function fetchEndpoint(
  url: string,
  limitBytes: number,
  signal: AbortSignal,
): Promise<EndpointResponse> {
  const started = performance.now();
  const response = await fetch(url, { credentials: 'omit', signal });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  const reader = response.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = limitBytes - bytes;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    bytes += Math.min(value.byteLength, room);
    if (value.byteLength > room) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  const decoder = new TextDecoder();
  const body =
    chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
  return {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('content-type') ?? '',
    durationMs: Math.round(performance.now() - started),
    body,
    bytes,
    truncated,
  };
}
