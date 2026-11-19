import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CollectionCatalogEntry, CollectionSchema, ModelZuid } from '../../domain';
import type { SchemaLoader } from '../hooks/useSchemaIndex';
import { RootPicker } from './RootPicker';

function entry(
  modelZuid: string,
  label: string,
  type: string,
  group: CollectionCatalogEntry['group'],
): CollectionCatalogEntry {
  return {
    label,
    name: label.toLowerCase(),
    type,
    group,
    reference: {
      instanceZuid: '8-abc123',
      modelZuid: modelZuid as ModelZuid,
      deployment: 'production',
      area: group === 'blocks' ? 'blocks' : 'content',
      apiBaseUrl: 'https://8-abc123.api.zesty.io/v1',
      managerBaseUrl: 'https://8-abc123.manager.zesty.io',
    },
  };
}

const collections = [
  entry('6-stories', 'Stories', 'pageset', 'content'),
  entry('6-hero', 'Hero banner', 'block', 'blocks'),
  entry('6-authors', 'Authors', 'dataset', 'content'),
];

const schemas: Readonly<Record<string, CollectionSchema>> = {
  '6-stories': {
    modelZuid: '6-stories',
    label: 'Stories',
    fields: [
      { id: '12-title', name: 'title', label: 'Title', kind: 'text', datatype: 'text' },
      {
        id: '12-featured',
        name: 'featured',
        label: 'Featured',
        kind: 'boolean',
        datatype: 'yes_no',
      },
      {
        id: '12-author',
        name: 'author',
        label: 'Author',
        kind: 'relationship',
        datatype: 'one_to_one',
        relatedModelZuid: '6-authors',
      },
      {
        id: '12-tags',
        name: 'tags',
        label: 'Tags',
        kind: 'relationship',
        datatype: 'one-to-many',
        relatedModelZuid: '6-hero',
      },
    ],
  },
};

const loadSchema: SchemaLoader = (reference) => {
  const schema = schemas[reference.modelZuid];
  return Promise.resolve(schema ? { ok: true, schema } : { ok: false, message: 'No such model.' });
};

function renderPicker(overrides: Partial<Parameters<typeof RootPicker>[0]> = {}) {
  const onSelect = vi.fn<(modelZuid: ModelZuid) => void>();
  const onOpen = vi.fn<(modelZuid: ModelZuid) => void>();
  const props = {
    titleId: 'root-picker-title',
    instanceName: 'Acme',
    collections,
    loading: false,
    error: undefined,
    warning: undefined,
    onRetry: vi.fn(),
    selected: undefined,
    onSelect,
    openRoot: undefined,
    inView: new Set<ModelZuid>(),
    rootHasChildren: false,
    addRelated: false,
    onAddRelatedChange: vi.fn(),
    onOpen,
    onPasteUrl: vi.fn(() => undefined),
    onSwitchInstance: vi.fn(),
    loadSchema,
    ...overrides,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RootPicker {...props} />
    </QueryClientProvider>,
  );
  return {
    ...props,
    onSelect,
    onOpen,
    search: screen.getByRole('combobox', {
      name: 'Search collections by name or ZUID, or paste a Zesty URL',
    }),
  };
}

describe('RootPicker', () => {
  it('lists the catalog by section and marks the open root and the collections in the view', () => {
    renderPicker({
      selected: '6-stories',
      openRoot: '6-stories',
      inView: new Set(['6-stories', '6-authors']),
    });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Authorsauthors · 6-authorsIn this view',
      'Storiesstories · 6-storiesOpen now',
      'Hero bannerhero banner · 6-hero',
    ]);
    expect(
      screen.getAllByRole('group').map((group) => within(group).getAllByRole('option').length),
    ).toEqual([2, 1]);
    expect(screen.getByRole('group', { name: 'Blocks' })).toHaveTextContent('Hero banner');
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Stories');
  });

  it('opens the collection the search highlights, by button or Enter', () => {
    const { search, onOpen } = renderPicker({ selected: '6-stories' });
    fireEvent.change(search, { target: { value: 'hero' } });
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Hero banner');
    fireEvent.click(screen.getByRole('button', { name: 'Open Hero banner' }));
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onOpen.mock.calls).toEqual([['6-hero'], ['6-hero']]);
  });

  it('moves the choice with the arrow keys', () => {
    const { search, onSelect } = renderPicker({ selected: '6-authors' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(onSelect.mock.calls).toEqual([['6-stories']]);
  });

  it("previews the highlighted collection's fields in Zesty Manager's terms", async () => {
    renderPicker({ selected: '6-stories' });
    const preview = await screen.findByRole('region', { name: 'Stories fields' });
    expect(preview).toHaveTextContent('Multi page model. Each item is a page with its own URL.');
    expect(within(preview).getByRole('link', { name: 'Open in Zesty Manager' })).toHaveAttribute(
      'href',
      'https://8-abc123.manager.zesty.io/content/6-stories',
    );
    expect((await within(preview).findAllByRole('row')).map((row) => row.textContent)).toEqual([
      'TitleText',
      'FeaturedYes/No',
      'AuthorLink to Authors',
      'TagsLinks to Hero banner',
    ]);
  });

  it('keeps the open tree, without adding related collections, when its root is chosen again', () => {
    renderPicker({
      selected: '6-stories',
      openRoot: '6-stories',
      rootHasChildren: true,
      addRelated: true,
    });
    const addRelated = screen.getByRole('checkbox', { name: /Add related collections/ });
    expect(addRelated).not.toBeChecked();
    expect(addRelated).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('This collection is open with its tree, which stays as it is.'),
    ).toBeVisible();
  });

  it('offers Retry when the catalog fails, and says when the catalog is empty', () => {
    const { onRetry } = renderPicker({
      collections: [],
      error: { kind: 'network', message: 'Catalog is unavailable.' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Catalog is unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry catalog' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says what to do when the catalog is empty', () => {
    renderPicker({ collections: [] });
    expect(screen.getByRole('status')).toHaveTextContent(
      'This session returned an empty collection catalog. Paste a collection URL to open one directly.',
    );
    expect(screen.getByRole('button', { name: 'Open collection' })).toBeDisabled();
  });
});
