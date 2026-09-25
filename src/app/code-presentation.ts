import type { CodeFile, CodeFileZuid, CodeState, InstanceReference, ModelZuid } from '../domain';
import type { TokenKind } from '../parsley';

export interface CollectionTone {
  readonly text: string;
  readonly chip: string;
  readonly dot: string;
  readonly row: string;
}

const tones: readonly CollectionTone[] = [
  {
    text: 'text-violet-300',
    chip: 'bg-violet-400/15 ring-1 ring-violet-400/35',
    dot: 'bg-violet-400',
    row: 'bg-violet-400/10',
  },
  {
    text: 'text-sky-300',
    chip: 'bg-sky-400/15 ring-1 ring-sky-400/35',
    dot: 'bg-sky-400',
    row: 'bg-sky-400/10',
  },
  {
    text: 'text-pink-300',
    chip: 'bg-pink-400/15 ring-1 ring-pink-400/35',
    dot: 'bg-pink-400',
    row: 'bg-pink-400/10',
  },
  {
    text: 'text-teal-300',
    chip: 'bg-teal-400/15 ring-1 ring-teal-400/35',
    dot: 'bg-teal-400',
    row: 'bg-teal-400/10',
  },
  {
    text: 'text-amber-300',
    chip: 'bg-amber-400/15 ring-1 ring-amber-400/35',
    dot: 'bg-amber-400',
    row: 'bg-amber-400/10',
  },
  {
    text: 'text-indigo-300',
    chip: 'bg-indigo-400/15 ring-1 ring-indigo-400/35',
    dot: 'bg-indigo-400',
    row: 'bg-indigo-400/10',
  },
];

/** Highlight for steps and entries that are not about one collection. */
export const neutralTone: CollectionTone = {
  text: 'text-orange-300',
  chip: 'bg-orange-400/15 ring-1 ring-orange-400/35',
  dot: 'bg-orange-400',
  row: 'bg-orange-400/10',
};

export type ToneLookup = (modelZuid: ModelZuid) => CollectionTone;

/**
 * Colors collections by their catalog order, so a collection has the same color in every file
 * and neighbours in the catalog never share one. Collections outside the catalog hash their ZUID.
 */
export function catalogTones(catalogOrder: readonly ModelZuid[]): ToneLookup {
  const order = new Map(catalogOrder.map((modelZuid, index) => [modelZuid, index]));
  return (modelZuid) => {
    let index = order.get(modelZuid);
    if (index === undefined) {
      index = 0;
      for (const char of modelZuid) index = (index * 31 + char.charCodeAt(0)) >>> 0;
    }
    return tones[index % tones.length]!;
  };
}

export const tokenClasses: Readonly<Record<TokenKind, string>> = {
  delimiter: 'text-zinc-500',
  keyword: 'font-semibold text-fuchsia-300',
  collection: 'rounded px-0.5 font-semibold',
  alias: 'font-semibold',
  field: '',
  meta: 'text-zinc-400 italic',
  input: 'rounded bg-orange-400/15 px-0.5 text-orange-300',
  function: 'text-yellow-200/80',
  builtin: 'text-indigo-300',
  variable: 'text-orange-200',
  string: 'text-emerald-300/85',
  number: 'text-orange-200',
  operator: 'text-zinc-400',
  comment: 'text-zinc-500 italic',
  snippet: 'text-teal-300 underline underline-offset-4',
  remote: 'text-emerald-300',
  literal: 'text-emerald-200/80',
  // Unmatched references and unknown syntax are neutral: they are not evidence of a code error.
  'unrecognized-reference':
    'text-code-content underline decoration-muted-foreground decoration-dotted underline-offset-4',
  'unrecognized-syntax':
    'rounded-sm bg-muted/70 text-code-content underline decoration-muted-foreground decoration-dotted underline-offset-4',
  'json-key': 'font-medium text-foreground',
  'json-punctuation': 'text-zinc-400',
  'html-tag': 'text-rose-300/80',
  text: 'text-code-content',
};

export const codeStateLabels: Readonly<Record<CodeState, string>> = {
  latest: 'Latest',
  published: 'Published',
};

/** A short name for Zesty's file type, e.g. `Custom endpoint` for `ajax-json`. */
export function fileTypeLabel(file: Pick<CodeFile, 'type' | 'fileName'>): string {
  const type = file.type.toLowerCase();
  if (type === 'ajax-json')
    return file.fileName.startsWith('/') ? 'Custom endpoint' : 'Legacy endpoint';
  if (type === 'ajax-html') return 'Legacy HTML file';
  if (type === 'snippet') return 'Snippet';
  if (type === 'templateset' || type === 'pageset' || type === 'dataset') return 'Model template';
  if (type === 'block') return 'Block template';
  if (type === '404') return '404 page';
  if (type === 'loader') return 'Loader';
  return file.type;
}

/** The file's extension in capitals, or `No extension`. */
export function fileFormatLabel(fileName: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1];
  return extension ? extension.toUpperCase() : 'No extension';
}

/**
 * The part of a Code file filter that a link keeps. A URL's query or fragment may carry a session
 * token, and matching ignores them.
 */
export function shareableFileFilter(filter: string): string {
  return filter.replace(/[?#].*/s, '');
}

/**
 * Whether a code file matches the Code tab's file filter: part of its name, ignoring case, or a
 * URL that serves it (a custom endpoint's path) or opens it (its ZUID in Zesty Manager). The URL
 * may be relative, e.g. `/api/events.json?page=2`.
 */
export function codeFileMatches(file: Pick<CodeFile, 'id' | 'fileName'>, filter: string): boolean {
  const text = shareableFileFilter(filter).trim().toLowerCase();
  const fileName = file.fileName.toLowerCase();
  if (fileName.includes(text)) return true;
  const url = URL.parse(text, 'https://site.invalid');
  if (!url) return false;
  const servesFile = fileName.startsWith('/') && url.pathname.endsWith(fileName);
  return servesFile || url.pathname.split('/').includes(file.id.toLowerCase());
}

/** Zesty Manager's code editor page for a `/web/views` file. */
export function managerCodeFileUrl(
  instance: Pick<InstanceReference, 'managerBaseUrl'>,
  fileId: CodeFileZuid,
): string {
  return `${instance.managerBaseUrl}/code/file/views/${fileId}`;
}
