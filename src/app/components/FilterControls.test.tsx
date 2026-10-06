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
import { tableFilterControls } from './FilterControls';

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

interface StateFunnelProps {
  readonly filters: readonly ViewFilter[];
  readonly onChange: (filters: readonly ViewFilter[]) => void;
  readonly itemIds?: readonly ItemZuid[];
}

function controls({ filters, onChange, itemIds = allItemIds }: StateFunnelProps) {
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
  });
}

function openFunnel(
  filters: readonly ViewFilter[],
  column = 'state',
  label = 'State',
  itemIds = allItemIds,
) {
  const onChange = vi.fn();
  const Funnel = () => controls({ filters, onChange, itemIds }).columnControl(column);
  render(<Funnel />);
  fireEvent.click(screen.getByRole('button', { name: `Filter by ${label}` }));
  return onChange;
}

describe('column filter button', () => {
  it('adds a filter on its column from the option list and Enter', async () => {
    const onChange = openFunnel([]);

    const review = await screen.findByRole('checkbox', { name: 'In review (2)' });
    expect(screen.getByRole('checkbox', { name: 'Draft (1)' })).toBeInTheDocument();
    // The column already names the field, so there is nothing to pick.
    expect(screen.queryByRole('combobox', { name: 'View filter field' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'View filter' })).toHaveTextContent('Filter by State');
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
    openFunnel([], 'state', 'State', allItemIds.slice(0, 2));

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
    const onChange = openFunnel([existing]);

    expect(await screen.findByRole('checkbox', { name: 'Draft (1)' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'In review (2)' }));
    fireEvent.click(screen.getByRole('button', { name: /Update/ }));

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
    openFunnel([], 'score', 'Score');
    fireEvent.click(screen.getByRole('combobox', { name: 'View filter condition' }));
    const between = await screen.findByRole('option', { name: 'between' });
    fireEvent.pointerDown(between, { pointerType: 'mouse' });
    fireEvent.pointerUp(between, { pointerType: 'mouse' });
    fireEvent.click(between);
    fireEvent.change(screen.getByRole('textbox', { name: 'View filter lower value' }), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add filter/ }));

    const upper = screen.getByRole('textbox', { name: 'View filter upper value' });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an upper value.');
    expect(upper).toHaveFocus();
    expect(upper).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'View filter lower value' })).not.toHaveAttribute(
      'aria-invalid',
    );
  });
});
