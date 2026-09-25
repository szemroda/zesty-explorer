import { describe, expect, it } from 'vitest';
import { codeFileMatches, shareableFileFilter } from './code-presentation';

const endpoint = { id: '11-events-json', fileName: '/api/events.json' } as const;
const snippet = { id: '11-helpers001', fileName: 'json_helpers' } as const;

describe('codeFileMatches', () => {
  it('matches part of a file name, ignoring case and surrounding spaces', () => {
    expect(codeFileMatches(endpoint, '')).toBe(true);
    expect(codeFileMatches(endpoint, ' EVENTS ')).toBe(true);
    expect(codeFileMatches(snippet, 'helpers')).toBe(true);
    expect(codeFileMatches(snippet, 'events')).toBe(false);
  });

  it("matches a custom endpoint's absolute or relative URL by its path", () => {
    const urls = [
      'https://www.example.com/api/events.json?city=Berlin',
      'https://www.example.com/site/api/events.json',
      '/api/events.json?city=Berlin#top',
    ];
    for (const url of urls) {
      expect(codeFileMatches(endpoint, url)).toBe(true);
      expect(codeFileMatches(snippet, url)).toBe(false);
    }
    expect(codeFileMatches(endpoint, 'https://www.example.com/')).toBe(false);
    expect(codeFileMatches(endpoint, 'https://www.example.com/api/other.json')).toBe(false);
  });

  it("matches a file's Zesty Manager URL by its ZUID", () => {
    const url = 'https://8-abc123.manager.zesty.io/code/file/views/11-helpers001';
    expect(codeFileMatches(snippet, url)).toBe(true);
    expect(codeFileMatches(endpoint, url)).toBe(false);
  });
});

describe('shareableFileFilter', () => {
  it("drops a URL's query and fragment, which may carry a session token", () => {
    expect(shareableFileFilter('https://example.com/api/events.json?APP_SID=secret#top')).toBe(
      'https://example.com/api/events.json',
    );
    expect(shareableFileFilter('/api/events.json#APP_SID=secret')).toBe('/api/events.json');
    expect(shareableFileFilter('events')).toBe('events');
  });
});
