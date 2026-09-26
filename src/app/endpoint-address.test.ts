import { describe, expect, it } from 'vitest';
import { endpointPath, endpointUrl, isEndpoint, wildcardCount } from './endpoint-address';

describe('endpointPath', () => {
  it('maps custom, extensionless, wildcard, and legacy endpoints to WebEngine paths', () => {
    const path = (fileName: string, type = 'ajax-json') => endpointPath({ fileName, type });

    expect(path('/data/articles.json')).toBe('/data/articles.json');
    expect(path('/list')).toBe('/list.json');
    expect(path('/archive/by-category.html', 'ajax-html')).toBe('/archive/by-category.html');
    expect(path('/store/*/*/index.parsley')).toBe('/store/*/*/');
    expect(path('/api/*')).toBe('/api/*');
    expect(path('feed')).toBe('/-/custom/feed/');
    expect(path('sidebar', 'ajax-html')).toBe('/-/ajax/sidebar/');
  });

  it('recognizes only JSON and HTML endpoint files', () => {
    expect(isEndpoint({ type: 'ajax-json' })).toBe(true);
    expect(isEndpoint({ type: 'AJAX-HTML' })).toBe(true);
    expect(isEndpoint({ type: 'snippet' })).toBe(false);
    expect(isEndpoint({ type: 'templateset' })).toBe(false);
  });
});

describe('endpointUrl', () => {
  const base = 'https://h4sh-dev.webengine.zesty.io';

  it('keeps parameter order, repeated names, and explicitly empty values', () => {
    const url = endpointUrl(
      base,
      '/data/articles.json',
      [],
      [
        { name: 'tag', value: 'a' },
        { name: 'category', value: '' },
        { name: 'tag', value: 'b & c' },
        { name: '', value: 'ignored' },
      ],
    );

    expect(url).toBe(`${base}/data/articles.json?tag=a&category=&tag=b+%26+c`);
    expect(endpointUrl(base, '/data/articles.json', [], [])).toBe(`${base}/data/articles.json`);
  });

  it('needs a non-empty value for every wildcard segment and encodes it', () => {
    expect(wildcardCount('/store/*/*/')).toBe(2);
    expect(endpointUrl(base, '/store/*/*/', ['12345'], [])).toBeUndefined();
    expect(endpointUrl(base, '/store/*/*/', ['12345', ''], [])).toBeUndefined();
    expect(endpointUrl(base, '/store/*/*/', ['12345', 'a/b c'], [])).toBe(
      `${base}/store/12345/a%2Fb%20c/`,
    );
  });
});
