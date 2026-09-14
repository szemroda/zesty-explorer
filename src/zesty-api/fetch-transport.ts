import { FetchHttpClient, HttpClient } from '@effect/platform';
import { Effect } from 'effect';
import type { ZestyTransport } from './types';

function parseResponseBody(text: string): unknown {
  if (!text) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export const fetchZestyTransport: ZestyTransport = {
  request: (request) =>
    Effect.gen(function* () {
      // Zesty's preflight rejects Effect's default b3 and traceparent headers.
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.withTracerPropagation(false));
      const response = yield* client.get(request.url, { headers: request.headers });
      const text = yield* response.text;
      return { status: response.status, headers: response.headers, body: parseResponseBody(text) };
    }).pipe(
      Effect.mapError(() => ({ kind: 'network' as const })),
      Effect.provide(FetchHttpClient.layer),
    ),
};
