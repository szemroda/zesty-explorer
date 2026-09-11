import type { ExplorerError } from '../domain';

export interface ErrorMessage {
  readonly message: string;
  readonly recovery: string;
}

export function describeExplorerError(error: ExplorerError): ErrorMessage {
  if (error.kind === 'invalid-input' || error.kind === 'blocked-host') {
    return { message: error.message, recovery: 'Check the collection URL and try again.' };
  }
  if (error.kind === 'authentication') {
    return {
      message: error.message,
      recovery: 'Copy a fresh deployment-specific cookie from Zesty Manager.',
    };
  }
  if (error.kind === 'permission') {
    return {
      message: error.message,
      recovery: 'Ask a Zesty administrator for read access, then retry.',
    };
  }
  if (error.kind === 'missing-resource') {
    return { message: error.message, recovery: 'Confirm that the model still exists.' };
  }
  if (error.kind === 'decoding') {
    return {
      message: error.message,
      recovery: 'Refresh once. If it repeats, the response shape is not supported.',
    };
  }
  if (error.kind === 'network') {
    return {
      message: error.message,
      recovery: 'Check connectivity and browser CORS errors, then retry.',
    };
  }
  if (error.kind === 'timeout') {
    return { message: error.message, recovery: 'Retry after the connection stabilizes.' };
  }
  if (error.kind === 'rate-limit') {
    return { message: error.message, recovery: 'Wait briefly before retrying this node.' };
  }
  if (error.kind === 'server') {
    return { message: error.message, recovery: 'Retry after Zesty recovers.' };
  }
  if (error.kind === 'data-limit') {
    return {
      message: error.message,
      recovery: 'Narrow the view or remove collection nodes before retrying.',
    };
  }
  return { message: error.message, recovery: 'Retry the operation.' };
}
