// Prints GitHub release notes grouped by Conventional Commit type.
// Usage (Node 24 runs TypeScript directly): node scripts/release-notes.ts <previous-tag> <tag>
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type Commit = { hash: string; subject: string };

const sectionByType: Readonly<Record<string, string>> = {
  feat: 'Features',
  fix: 'Fixes',
  perf: 'Performance',
};
const hiddenTypes = new Set(['docs', 'test', 'build', 'style', 'chore', 'ci', 'refactor']);
const sectionOrder = ['Breaking changes', 'Features', 'Fixes', 'Performance', 'Other changes'];

/** Groups commits into Markdown sections; commits outside the convention go to "Other changes". */
export function formatReleaseNotes(commits: readonly Commit[], compareUrl: string): string {
  const sections = new Map<string, string[]>();
  for (const { hash, subject } of commits) {
    const match = /^(\w+)(?:\([^)]*\))?(!)?: (.+)$/.exec(subject);
    const [, type = '', breaking, description = subject] = match ?? [];
    if (!breaking && hiddenTypes.has(type)) continue;
    const section = breaking ? 'Breaking changes' : (sectionByType[type] ?? 'Other changes');
    sections.set(section, [...(sections.get(section) ?? []), `- ${description} (${hash})`]);
  }
  const body = sectionOrder
    .filter((section) => sections.has(section))
    .map((section) => `## ${section}\n\n${sections.get(section)?.join('\n')}`);
  return [
    ...(body.length ? body : ['No user-facing changes.']),
    `**Full Changelog**: ${compareUrl}`,
  ]
    .join('\n\n')
    .concat('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [previousTag, tag] = process.argv.slice(2);
  const repository = process.env.GITHUB_REPOSITORY ?? 'szemroda/zesty-explorer';
  if (!previousTag || !tag) throw new Error('Usage: release-notes.ts <previous-tag> <tag>');
  const log = execFileSync('git', ['log', '--format=%h%x09%s', `${previousTag}..${tag}`], {
    encoding: 'utf8',
  });
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', subject = ''] = line.split('\t');
      return { hash, subject };
    });
  const compareUrl = `https://github.com/${repository}/compare/${previousTag}...${tag}`;
  process.stdout.write(formatReleaseNotes(commits, compareUrl));
}
