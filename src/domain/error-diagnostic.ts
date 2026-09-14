import type { ParseResult, SchemaAST } from 'effect';
import type { ExplorerDecodingIssue, ExplorerError, SafeRequestUrl } from './types';

const maximumIssues = 20;
const secretQueryParameter = /auth|credential|key|password|secret|sid|token/i;

export function safeRequestUrl(value: string): SafeRequestUrl {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    const secretParameters = [...url.searchParams.keys()].filter((key) =>
      secretQueryParameter.test(key),
    );
    for (const key of secretParameters) url.searchParams.delete(key);
    return url.toString() as SafeRequestUrl;
  } catch {
    return '[invalid request URL]' as SafeRequestUrl;
  }
}

function receivedType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function expectedType(ast: SchemaAST.AST): string {
  if (ast._tag === 'Refinement') {
    const baseType = expectedType(ast.from);
    return baseType === 'string'
      ? 'string matching required format'
      : `${baseType} satisfying required constraint`;
  }
  if (ast._tag === 'Transformation') return expectedType(ast.from);
  if (ast._tag === 'StringKeyword' || ast._tag === 'TemplateLiteral') return 'string';
  if (ast._tag === 'NumberKeyword') return 'number';
  if (ast._tag === 'BooleanKeyword') return 'boolean';
  if (ast._tag === 'BigIntKeyword') return 'bigint';
  if (ast._tag === 'SymbolKeyword' || ast._tag === 'UniqueSymbol') return 'symbol';
  if (ast._tag === 'TupleType') return 'array';
  if (ast._tag === 'TypeLiteral' || ast._tag === 'ObjectKeyword') return 'object';
  if (ast._tag === 'UndefinedKeyword' || ast._tag === 'VoidKeyword') return 'undefined';
  if (ast._tag === 'NeverKeyword') return 'no value';
  if (ast._tag === 'Enums') return 'enum value';
  if (ast._tag === 'Literal') return ast.literal === null ? 'null' : typeof ast.literal;
  if (ast._tag === 'Union') {
    return [...new Set(ast.types.map(expectedType))].join(' or ');
  }
  return 'value';
}

function appendPath(path: string, segment: PropertyKey): string {
  if (typeof segment === 'number') return `${path}[${segment}]`;
  if (typeof segment === 'string' && /^[A-Za-z_$][\w$]*$/.test(segment)) {
    return `${path}.${segment}`;
  }
  return `${path}[${JSON.stringify(String(segment))}]`;
}

function collectIssues(issue: ParseResult.ParseIssue): {
  readonly issues: readonly ExplorerDecodingIssue[];
  readonly omitted: boolean;
} {
  const issues: ExplorerDecodingIssue[] = [];
  let omitted = false;

  function add(path: string, expected: string, received: string) {
    if (issues.length >= maximumIssues) {
      omitted = true;
      return;
    }
    issues.push({ path, expected, received });
  }

  function visit(current: ParseResult.ParseIssue, path: string) {
    if (issues.length >= maximumIssues) {
      omitted = true;
      return;
    }
    if (current._tag === 'Pointer') {
      const segments: readonly PropertyKey[] = Array.isArray(current.path)
        ? current.path
        : [current.path as PropertyKey];
      let nestedPath = path;
      for (const segment of segments) nestedPath = appendPath(nestedPath, segment);
      visit(current.issue, nestedPath);
      return;
    }
    if (current._tag === 'Composite') {
      const nested: readonly ParseResult.ParseIssue[] = Array.isArray(current.issues)
        ? (current.issues as readonly ParseResult.ParseIssue[])
        : [current.issues as ParseResult.ParseIssue];
      for (const child of nested) {
        if (issues.length >= maximumIssues) {
          omitted = true;
          return;
        }
        visit(child, path);
      }
      return;
    }
    if (current._tag === 'Refinement' || current._tag === 'Transformation') {
      visit(current.issue, path);
      return;
    }
    if (current._tag === 'Missing') {
      add(path, expectedType(current.ast.type), 'missing');
      return;
    }
    if (current._tag === 'Unexpected') {
      add(path, 'no additional value', receivedType(current.actual));
      return;
    }
    add(path, expectedType(current.ast), receivedType(current.actual));
  }

  visit(issue, '$');
  return { issues, omitted };
}

export function unsupportedShapeError(
  message: string,
  parseError: ParseResult.ParseError,
): ExplorerError {
  const collected = collectIssues(parseError.issue);
  return {
    kind: 'decoding',
    message,
    diagnostic: {
      issues: collected.issues,
      ...(collected.omitted ? { issuesOmitted: true } : {}),
    },
  };
}
