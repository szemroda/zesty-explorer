import type { CodeFileVersion, InstanceUser } from '../domain';
import {
  formattedLines,
  parseParsley,
  savedLines,
  sourceModeFor,
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

/** Display lines of one saved source, without the analysis the Code tab adds. */
export function versionSource(fileName: string, code: string): VersionSource {
  const document = parseParsley(code);
  const mode = sourceModeFor(fileName, document);
  return {
    formatted: formattedLines(document, [], mode),
    saved: savedLines(document, [], mode),
  };
}

/** Plain text of display lines, so a comparison matches what the source view shows. */
export function displayText(lines: readonly DisplayLine[]): string {
  return lines
    .map((line) => '  '.repeat(line.indent) + line.tokens.map((token) => token.text).join(''))
    .join('\n');
}
