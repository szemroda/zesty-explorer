// Where WebEngine serves an endpoint, and the URL a request form builds for it.
import type { CodeFile } from '../domain';

/** Whether a code file is an endpoint: a custom or legacy JSON or HTML file WebEngine serves. */
export function isEndpoint(file: Pick<CodeFile, 'type'>): boolean {
  const type = file.type.toLowerCase();
  return type === 'ajax-json' || type === 'ajax-html';
}

/**
 * The path WebEngine serves an endpoint at, with `*` for each wildcard segment:
 * - `/list` (JSON without an extension) is served as `/list.json`;
 * - `/store/*\/*\/index.parsley` as `/store/*\/*\/`;
 * - a legacy file `feed` as `/-/custom/feed/`, or `/-/ajax/feed/` for HTML.
 */
export function endpointPath(file: Pick<CodeFile, 'type' | 'fileName'>): string {
  const json = file.type.toLowerCase() === 'ajax-json';
  if (!file.fileName.startsWith('/')) {
    return json ? `/-/custom/${file.fileName}/` : `/-/ajax/${file.fileName}/`;
  }
  if (file.fileName.endsWith('/index.parsley'))
    return file.fileName.slice(0, -'index.parsley'.length);
  const last = file.fileName.split('/').at(-1) ?? '';
  return json && last !== '*' && !last.includes('.') ? `${file.fileName}.json` : file.fileName;
}

/** The number of wildcard segments in an endpoint path. */
export function wildcardCount(path: string): number {
  return path.split('/').filter((segment) => segment === '*').length;
}

export interface QueryParameter {
  readonly name: string;
  readonly value: string;
}

/**
 * The URL a request sends, or undefined while a wildcard segment is empty. Segment values are
 * encoded. Parameters keep their order, repeated names, and empty values (`?category=`); one
 * without a name is left out.
 */
export function endpointUrl(
  baseUrl: string,
  path: string,
  segments: readonly string[],
  parameters: readonly QueryParameter[],
): string | undefined {
  let wildcard = 0;
  let complete = true;
  const filled = path
    .split('/')
    .map((segment) => {
      if (segment !== '*') return segment;
      const value = segments[wildcard++] ?? '';
      if (!value) complete = false;
      return encodeURIComponent(value);
    })
    .join('/');
  if (!complete) return undefined;
  const query = new URLSearchParams(
    parameters.filter((parameter) => parameter.name).map(({ name, value }) => [name, value]),
  ).toString();
  return `${baseUrl}${filled}${query ? `?${query}` : ''}`;
}
