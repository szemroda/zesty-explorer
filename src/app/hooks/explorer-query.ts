import { Effect, Either } from 'effect';
import type { ExplorerError } from '../../domain';

/** Carries a Zesty request failure through TanStack Query, which stores thrown errors. */
export class ExplorerQueryError extends Error {
  constructor(readonly failure: ExplorerError) {
    super(failure.message);
    this.name = 'ExplorerQueryError';
  }
}

/** Runs a Zesty request inside a query function, throwing its failure as `ExplorerQueryError`. */
export async function runExplorerQuery<Value>(
  request: Effect.Effect<Value, ExplorerError>,
  signal: AbortSignal,
): Promise<Value> {
  const result = await Effect.runPromise(Effect.either(request), { signal });
  if (Either.isLeft(result)) throw new ExplorerQueryError(result.left);
  return result.right;
}

/** The request failure behind a query error, or undefined for any other error. */
export function explorerFailure(error: Error | null): ExplorerError | undefined {
  return error instanceof ExplorerQueryError ? error.failure : undefined;
}
