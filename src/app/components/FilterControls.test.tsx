import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  CollectionNodeId,
  CollectionSchema,
  CollectionSnapshot,
  ContentItem,
  ItemZuid,
  ViewFilter,
} from '../../domain';
import { collectionNode } from '../../test/fixtures';
import { buildLoadedViewGraph, rootLoadedView } from '../load-view';
import { ColumnMenuHeader } from './ColumnMenu';
import { tableFilterControls, type TableSearch, type ViewScope } from './FilterControls';

const node = { ...collectionNode('node-articles', '6-articles'), name: 'Articles' };
const schema: CollectionSchema = {
  modelZuid: '6-articles',
  label: 'Articles',
  fields: [
    {
      id: '12-state',
      name: 'state',
      label: 'State',
      kind: 'text',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'review', label: 'In review' },
      ],
    },
    { id: '12-score', name: 'score', label: 'Score', kind: 'number' },
    { id: '12-published', name: 'published', label: 'Published', kind: 'date' },
  ],
};
const items: readonly ContentItem[] = ['review', 'review', 'draft'].map((value, index) => ({
  id: `7-${index}` as ItemZuid,
  fields: { state: value },
  metadata: {},
  raw: {},
}));
const snapshot: CollectionSnapshot = {
  id: 'snapshot-articles',
  instanceZuid: node.reference.instanceZuid,
  modelZuid: node.reference.modelZuid,
  state: 'latest',
  language: 'en-US',
  items,
  itemsById: new Map(items.map((item) => [item.id, item])),
  partial: false,
};
const loadedView = rootLoadedView(node, 'latest', { schema, snapshot });
const allItemIds = items.map((item) => item.id);

interface ControlsProps {
  readonly filters: readonly ViewFilter[];
  readonly onChange: (filters: readonly ViewFilter[]) => void;
  readonly itemIds?: readonly ItemZuid[];
  readonly search?: TableSearch;
  readonly isColumnShown?: (columnId: string) => boolean;
  readonly viewScope?: ViewScope;
}

const noSearch: TableSearch = { text: '', onChange: () => undefined };

function controls({
  filters,
  onChange,
  itemIds = allItemIds,
  search = noSearch,
  // Most tests render chips without the table, so no header shows a filter.
  isColumnShown = () => false,
  viewScope,
}: ControlsProps) {
  return tableFilterControls({
    node,
    label: 'View filter',
    addLabel: 'Add view filter',
    subject: 'Articles',
    loadedView,
    contentState: 'latest',
    graph: buildLoadedViewGraph(node, loadedView, 'latest'),
    itemIds,
    filters,
    onChange,
    search,
    isColumnShown,
    ...(viewScope ? { viewScope } : {}),
  });
}

function openColumnMenu(
  filters: readonly ViewFilter[],
  column = 'state',
  label = 'State',
  itemIds = allItemIds,
) {
  const onChange = vi.fn();
  const Header = () => (
    <ColumnMenuHeader
      header={{
        columnId: column,
        label,
        canSort: true,
        sorted: false,
        sort: vi.fn(),
        hide: vi.fn(),
      }}
      filter={controls({ filters, onChange, itemIds }).columnFilter(column)}
    />
  );
  render(<Header />);
  // A filtered header's name goes on with its filter, e.g. `State filtered: is Draft`.
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
  return onChange;
}

describe('column menu filter', () => {
  it('adds a filter on its column from the option list and Enter', async () => {
    const onChange = openColumnMenu([]);

    const review = await screen.findByRole('checkbox', { name: 'In review (2)' });
    expect(screen.getByRole('checkbox', { name: 'Draft (1)' })).toBeInTheDocument();
    // The column already names the field, so there is nothing to pick.
    expect(screen.queryByRole('combobox', { name: 'View filter field' })).not.toBeInTheDocument();
    fireEvent.click(review);
    fireEvent.keyDown(review, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        nodePath: [],
        fieldPath: ['state'],
        operator: 'one-of',
        value: ['review'],
      }),
    ]);
  });

  it('counts only the rows of its own table', async () => {
    openColumnMenu([], 'state', 'State', allItemIds.slice(0, 2));

    expect(await screen.findByRole('checkbox', { name: 'In review (2)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Draft (0)' })).toBeInTheDocument();
    expect(screen.getByText('Counts across 2 Articles items in this table')).toBeInTheDocument();
  });

  it('edits the existing filter on its column instead of adding another', async () => {
    const existing: ViewFilter = {
      id: 'f1',
      nodePath: [],
      fieldPath: ['state'],
      operator: 'one-of',
      value: ['draft'],
    };
    const onChange = openColumnMenu([existing]);

    expect(await screen.findByRole('checkbox', { name: 'Draft (1)' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'In review (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update filter' }));

    expect(onChange).toHaveBeenCalledWith([{ ...existing, value: ['draft', 'review'] }]);
  });
});

describe('field picker', () => {
  it('matches field names, not the collection that holds them', async () => {
    const sections = { ...collectionNode('node-sections', '6-sections'), name: 'Sections' };
    const parent = { ...node, children: [sections] };
    const view = {
      ...loadedView,
      schemas: new Map<CollectionNodeId, CollectionSchema>([
        [
          node.id,
          {
            ...schema,
            fields: [
              {
                id: '12-count',
                name: 'sectionCount',
                label: 'Section count',
                kind: 'number',
              },
            ],
          },
        ],
        [
          sections.id,
          {
            modelZuid: '6-sections',
            label: 'Sections',
            fields: [{ id: '12-heading', name: 'heading', label: 'Heading', kind: 'text' }],
          },
        ],
      ]),
    };
    const Toolbar = () =>
      tableFilterControls({
        node: parent,
        label: 'View filter',
        addLabel: 'Add view filter',
        subject: 'Articles',
        loadedView: view,
        contentState: 'latest',
        graph: buildLoadedViewGraph(parent, view, 'latest'),
        itemIds: allItemIds,
        filters: [],
        onChange: vi.fn(),
        search: noSearch,
        isColumnShown: () => true,
      }).toolbarButton;
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Add view filter' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'View filter field' }), {
      target: { value: 'section' },
    });

    expect(await screen.findByRole('option', { name: /Section count/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Heading/ })).not.toBeInTheDocument();
  });
});

describe('filter editor values', () => {
  it('opens a legacy date "equals" filter as "on" with its timestamp editable as text', () => {
    const legacy: ViewFilter = {
      id: 'd1',
      nodePath: [],
      fieldPath: ['published'],
      operator: 'equals',
      value: '2026-01-31 12:00:00',
    };
    const Chips = () => controls({ filters: [legacy], onChange: vi.fn() }).chipRow;
    render(<Chips />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit filter Published on 2026-01-31 12:00:00' }),
    );

    expect(screen.getByRole('combobox', { name: 'View filter condition' })).toHaveTextContent('on');
    const value = screen.getByRole('textbox', { name: 'View filter value' });
    expect(value).toHaveValue('2026-01-31 12:00:00');
    expect(value).toHaveAttribute('type', 'text');
  });

  it('reports a missing upper bound on the upper input and focuses it', async () => {
    openColumnMenu([], 'score', 'Score');
    fireEvent.click(screen.getByRole('combobox', { name: 'View filter condition' }));
    const between = await screen.findByRole('option', { name: 'between' });
    fireEvent.pointerDown(between, { pointerType: 'mouse' });
    fireEvent.pointerUp(between, { pointerType: 'mouse' });
    fireEvent.click(between);
    fireEvent.change(screen.getByRole('textbox', { name: 'View filter lower value' }), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filter' }));

    const upper = screen.getByRole('textbox', { name: 'View filter upper value' });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an upper value.');
    expect(upper).toHaveFocus();
    expect(upper).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'View filter lower value' })).not.toHaveAttribute(
      'aria-invalid',
    );
  });
});

describe('search as a filter', () => {
  const state: ViewFilter = {
    id: 's1',
    nodePath: [],
    fieldPath: ['state'],
    operator: 'one-of',
    value: ['draft'],
  };

  it('saves "Any field" from the toolbar as the search, keeping the filters', async () => {
    const onSearch = vi.fn();
    const Toolbar = () =>
      controls({ filters: [state], onChange: vi.fn(), search: { text: '', onChange: onSearch } })
        .toolbarButton;
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Add view filter' }));
    // Enter on the empty picker takes its first field, "Any field".
    fireEvent.keyDown(await screen.findByRole('combobox', { name: 'View filter field' }), {
      key: 'Enter',
    });
    const value = await screen.findByRole('textbox', { name: 'View filter value' });
    fireEvent.change(value, { target: { value: 'bottom' } });
    fireEvent.keyDown(value, { key: 'Enter' });

    expect(onSearch).toHaveBeenCalledWith('bottom', [state]);
  });

  it('lists the search as the first chip, and removing it clears only the search', () => {
    const onSearch = vi.fn();
    const Chips = () =>
      controls({
        filters: [state],
        onChange: vi.fn(),
        search: { text: 'bottom', onChange: onSearch },
      }).chipRow;
    render(<Chips />);

    const chips = screen.getAllByRole('button', { name: /^Edit filter/ });
    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'Edit filter Any field contains “bottom”',
      'Edit filter State is Draft',
    ]);
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove filter Any field contains “bottom”' }),
    );
    expect(onSearch).toHaveBeenCalledWith('', [state]);
  });
});

describe('chips and column headers', () => {
  const draft: ViewFilter = {
    id: 'd1',
    nodePath: [],
    fieldPath: ['state'],
    operator: 'one-of',
    value: ['draft'],
  };

  it('lists a filter as a chip only while no header on screen shows it', () => {
    const Chips = ({ shown }: { readonly shown: boolean }) =>
      controls({ filters: [draft], onChange: vi.fn(), isColumnShown: () => shown }).chipRow;
    const { rerender } = render(<Chips shown />);
    expect(screen.queryByRole('group', { name: 'Active filters' })).not.toBeInTheDocument();

    rerender(<Chips shown={false} />);
    expect(screen.getByRole('button', { name: 'Edit filter State is Draft' })).toBeInTheDocument();
  });

  it('moves a nested column filter into the view filters on "All <root>"', async () => {
    const onChange = vi.fn();
    const onViewChange = vi.fn();
    const root = { ...collectionNode('node-pages', '6-pages'), name: 'Pages' };
    // The view already filters this column; the moved filter replaces it rather than doubling it.
    const viewFilter: ViewFilter = { ...draft, id: 'v1', nodePath: [node.id], value: ['review'] };
    const Header = () => (
      <ColumnMenuHeader
        header={{
          columnId: 'state',
          label: 'State',
          canSort: true,
          sorted: false,
          sort: vi.fn(),
          hide: vi.fn(),
        }}
        filter={controls({
          filters: [draft],
          onChange,
          viewScope: { root, nodePath: [node.id], filters: [viewFilter], onChange: onViewChange },
        }).columnFilter('state')}
      />
    );
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: /^State/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'All Pages' }));
    // The choice waits for Update, like the condition and value.
    expect(onViewChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Update filter' }));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(onViewChange).toHaveBeenCalledWith([{ ...draft, id: 'v1', nodePath: [node.id] }]);
  });
});
