// Best-effort discovery of the query parameters an endpoint reads, for its request form.
import type { CodeFileZuid } from '../domain';
import { analyzeParsley, type CodeFileSummary } from './analysis';
import { parseParsley } from './syntax';

export interface ParsleySourceFile extends CodeFileSummary {
  readonly code: string;
}

const queryInputPrefix = 'input:query:';

/**
 * Query parameter names a file reads, followed by those of the snippets it includes by a static
 * name, recursively. `files` are the files of one code state; an include resolves only among them.
 * Each name appears once, in the order found. The list may be incomplete and says nothing about
 * which parameters are required.
 */
export function queryParameterNames(
  file: ParsleySourceFile,
  files: readonly ParsleySourceFile[],
): readonly string[] {
  const names = new Set<string>();
  const visited = new Set<CodeFileZuid>();
  const visit = (current: ParsleySourceFile) => {
    if (visited.has(current.id)) return;
    visited.add(current.id);
    const { usage } = analyzeParsley(parseParsley(current.code), {
      collections: [],
      schemas: new Map(),
      files,
    });
    for (const input of usage.inputs) {
      if (input.target.startsWith(queryInputPrefix)) {
        names.add(input.target.slice(queryInputPrefix.length));
      }
    }
    for (const snippet of usage.snippets) {
      const included = snippet.fileId && files.find((candidate) => candidate.id === snippet.fileId);
      if (included) visit(included);
    }
  };
  visit(file);
  return [...names];
}
