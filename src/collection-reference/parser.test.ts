import { describe, expect, it } from 'vitest';
import { parseCollectionReference, parseInstanceReference } from './index';

describe('InstanceReferenceParser', () => {
  it.each([
    {
      input: 'https://8-abc123.manager.zesty.io/',
      deployment: 'production',
      api: 'https://8-abc123.api.zesty.io/v1',
      suggestedModel: undefined,
    },
    {
      input: 'https://8-abc123.manager.zesty.io/schema/6-model123/fields?tab=settings#panel',
      deployment: 'production',
      api: 'https://8-abc123.api.zesty.io/v1',
      suggestedModel: '6-model123',
    },
    {
      input: 'https://8-abc123.api.stage.zesty.io/v1/content/models',
      deployment: 'stage',
      api: 'https://8-abc123.api.stage.zesty.io/v1',
      suggestedModel: undefined,
    },
    {
      input: 'https://8-abc123.api.zesty.io/v1/content/models/6-model123/fields?lang=en-US',
      deployment: 'production',
      api: 'https://8-abc123.api.zesty.io/v1',
      suggestedModel: '6-model123',
    },
    {
      input: 'http://8-abc123.api.dev.zesty.io/v1/content/models/6-model123',
      deployment: 'development',
      api: 'http://8-abc123.api.dev.zesty.io/v1',
      suggestedModel: '6-model123',
    },
  ])('accepts $input', ({ input, deployment, api, suggestedModel }) => {
    const parsed = parseInstanceReference(input);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      instanceZuid: '8-abc123',
      deployment,
      apiBaseUrl: api,
    });
    expect(parsed.value.suggestedModelZuid).toBe(suggestedModel);
  });

  it.each([
    'https://evil.example/content/6-model123',
    'https://8-abc123.api.zesty.io/',
    'https://8-abc123.api.zesty.io/v2/content/models',
    'https://8-abc123.api.zesty.io/v1/content/items',
  ])('rejects %s without returning a request target', (input) => {
    const parsed = parseInstanceReference(input);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(JSON.stringify(parsed)).not.toContain('apiBaseUrl');
  });
});

describe('CollectionReferenceParser', () => {
  it.each([
    {
      input:
        'https://8-abc123.manager.zesty.io/content/6-model123/7-item123/edit?ignored=yes#panel',
      deployment: 'production',
      api: 'https://8-abc123.api.zesty.io/v1',
      area: 'content',
      item: '7-item123',
    },
    {
      input: 'https://8-abc123.cms.stage.content.one/blocks/6-model123/',
      deployment: 'stage',
      api: 'https://8-abc123.api.stage.zesty.io/v1',
      area: 'blocks',
      item: undefined,
    },
    {
      input: 'http://8-abc123.manager.dev.zesty.io:8080/content/6-model123',
      deployment: 'development',
      api: 'http://8-abc123.api.dev.zesty.io/v1',
      area: 'content',
      item: undefined,
    },
    {
      input: 'https://8-abc123.api.zesty.io/v1/content/models/6-model123/items?limit=20',
      deployment: 'production',
      api: 'https://8-abc123.api.zesty.io/v1',
      area: 'content',
      item: undefined,
    },
  ])('accepts $input', ({ input, deployment, api, area, item }) => {
    const parsed = parseCollectionReference(input);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      instanceZuid: '8-abc123',
      modelZuid: '6-model123',
      deployment,
      area,
      apiBaseUrl: api,
    });
    expect(parsed.value.itemZuid).toBe(item);
  });

  it.each([
    'https://evil.example/content/6-model123',
    'https://8-abc123.manager.zesty.io/content',
    'https://8-abc123.manager.zesty.io/content/new',
    'https://8-abc123.manager.zesty.io/content/import',
    'https://8-abc123.manager.zesty.io/content/7-item123',
    'https://8-abc123.api.zesty.io/v1/content/models/6-model123/items/7-item123',
    'javascript:alert(1)',
    'https://8-abc123.manager.zesty.io/content/6-model123/%E0%A4%A',
  ])('rejects %s without returning a request target', (input) => {
    const parsed = parseCollectionReference(input);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(JSON.stringify(parsed)).not.toContain('apiBaseUrl');
  });
});
