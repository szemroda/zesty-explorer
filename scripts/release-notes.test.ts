// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatReleaseNotes } from './release-notes.ts';

const compareUrl = 'https://github.com/szemroda/zesty-explorer/compare/v0.1.0...v0.2.0';

describe('formatReleaseNotes', () => {
  it('groups user-facing commits and hides maintenance types', () => {
    const notes = formatReleaseNotes(
      [
        { hash: 'a1', subject: 'fix(api): retry expired tokens' },
        { hash: 'b2', subject: 'feat: add code history' },
        { hash: 'c3', subject: 'docs: explain releases' },
        { hash: 'd4', subject: 'refactor!: drop legacy links' },
        { hash: 'e5', subject: 'Quick tweak' },
        { hash: 'f6', subject: 'chore(release): v0.2.0' },
      ],
      compareUrl,
    );

    expect(notes).toBe(
      [
        '## Breaking changes\n\n- drop legacy links (d4)',
        '## Features\n\n- add code history (b2)',
        '## Fixes\n\n- retry expired tokens (a1)',
        '## Other changes\n\n- Quick tweak (e5)',
        `**Full Changelog**: ${compareUrl}\n`,
      ].join('\n\n'),
    );
  });

  it('says so when a release has no user-facing changes', () => {
    expect(formatReleaseNotes([{ hash: 'a1', subject: 'ci: cache pnpm' }], compareUrl)).toBe(
      `No user-facing changes.\n\n**Full Changelog**: ${compareUrl}\n`,
    );
  });
});
