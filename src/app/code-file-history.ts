import type { CodeFileVersion, InstanceUser } from '../domain';
import {
  analyzeParsley,
  formattedLines,
  parseParsley,
  savedLines,
  sourceModeFor,
  type AnalysisContext,
  type DisplayLine,
} from '../parsley';
import { authorFor, type AuthorsState, type SavedVersionOption } from './item-version-preview';

export interface CodeVersionOption extends SavedVersionOption {
  readonly code: string;
}

export interface BuildCodeVersionOptionsInput {
  readonly versions: readonly CodeFileVersion[];
  /** The version served as published code, when the file has one. */
  readonly publishedVersion: number | undefined;
  readonly users: readonly InstanceUser[];
  readonly usersState: AuthorsState;
}

/** Saved versions of a code file, newest first, for the code history list. */
export function buildCodeVersionOptions({
  versions,
  publishedVersion,
  users,
  usersState,
}: BuildCodeVersionOptionsInput): readonly CodeVersionOption[] {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const ordered = versions.toSorted((left, right) => right.number - left.number);
  const latestNumber = ordered[0]?.number;
  return ordered.map((version) => ({
    number: version.number,
    code: version.code,
    ...(version.savedAt ? { savedAt: version.savedAt } : {}),
    ...authorFor(version.authorZuid, usersById, usersState),
    latestSaved: version.number === latestNumber,
    currentlyPublished: version.number === publishedVersion,
  }));
}

export interface VersionSource {
  readonly formatted: readonly DisplayLine[];
  readonly saved: readonly DisplayLine[];
}

/** What the session knows to color a saved source by. Field schemas are not loaded for history. */
export type VersionContext = Omit<AnalysisContext, 'schemas'>;

/**
 * Display lines of one saved source, colored like the Code tab but without its explanations: tokens
 * keep their kind and reference, not their hints. Without schemas, a known collection's fields all
 * color as fields.
 */
export function versionSource(
  fileName: string,
  code: string,
  context: VersionContext,
): VersionSource {
  const document = parseParsley(code);
  const mode = sourceModeFor(fileName, document);
  const annotations = analyzeParsley(document, { ...context, schemas: new Map() }).annotations.map(
    ({ span, kind, ref }) => ({ span, kind, ...(ref ? { ref } : {}) }),
  );
  return {
    formatted: formattedLines(document, annotations, mode),
    saved: savedLines(document, annotations, mode),
  };
}

/**
 * Plain text of a saved source laid out as `Formatted`, so a comparison matches what the source
 * view shows. Colors do not change the text, so the source is not analyzed.
 */
export function formattedText(fileName: string, code: string): string {
  const document = parseParsley(code);
  return formattedLines(document, [], sourceModeFor(fileName, document))
    .map((line) => '  '.repeat(line.indent) + line.tokens.map((token) => token.text).join(''))
    .join('\n');
}
