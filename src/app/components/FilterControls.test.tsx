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

interface ControlsProps {
  readonly freeText?: string;
  readonly filters: readonly ViewFilter[];
  readonly onChange?: (freeText: string, filters: readonly ViewFilter[]) => void;
  readonly itemIds?: readonly ItemZuid[];
}

function controls({
  freeText = '',
  filters,
  onChange = vi.fn(),
  itemIds = allItemIds,
}: ControlsProps) {
  return tableFilterControls({
    node,
    label: 'View filter',
    addLabel: 'Add view filter',
    subject: 'Articles',
    heading: 'View filters',
    loadedView,
    contentState: 'latest',
    graph: buildLoadedViewGraph(node, loadedView, 'latest'),
    itemIds,
    freeText,
    filters,
    onChange,
  });
}

// Base UI selects an option on the pointer sequence, not on a bare click.
function choose(option: HTMLElement) {
  fireEvent.pointerDown(option, { pointerType: 'mouse' });
  fireEvent.pointerUp(option, { pointerType: 'mouse' });
  fireEvent.click(option);
}

// Opens the toolbar editor and picks `field` the way a user does: type its label, choose it.
async function addFromToolbar(props: ControlsProps, field: string) {
  const Toolbar = () => controls(props).toolbarButton;
  render(<Toolbar />);
  fireEvent.click(screen.getByRole('button', { name: 'Add view filter' }));
  fireEvent.change(await screen.findByRole('combobox', { name: 'View filter field' }), {
    target: { value: field },
  });
  choose(await screen.findByRole('option', { name: new RegExp(`^${field}`) }));
}

function renderChips(props: ControlsProps) {
  const Chips = () => controls(props).chipRow;
  return render(<Chips />);
}

describe('toolbar filter', () => {
  it('adds a filter on a picked field from the option list and Enter', async () => {
    const onChange = vi.fn();
    await addFromToolbar({ filters: [], onChange }, 'State');

    const review = await screen.findByRole('checkbox', { name: 'In review (2)' });
    expect(screen.getByRole('checkbox', { name: 'Draft (1)' })).toBeInTheDocument();
    fireEvent.click(review);
    fireEvent.keyDown(review, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('', [
      expect.objectContaining({
        nodePath: [],
        fieldPath: ['state'],
        operator: 'one-of',
        value: ['review'],
      }),
    ]);
  });

  it('counts only the rows of its own table', async () => {
    await addFromToolbar({ filters: [], itemIds: allItemIds.slice(0, 2) }, 'State');

    expect(await screen.findByRole('checkbox', { name: 'In review (2)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Draft (0)' })).toBeInTheDocument();
    expect(screen.getByText('Counts across 2 Articles items in this table')).toBeInTheDocument();
  });
});

describe('filter chips', () => {
  const existing: ViewFilter = {
    id: 'f1',
    nodePath: [],
    fieldPath: ['state'],
    operator: 'one-of',
    value: ['draft'],
  };

  it('edits its filter in place instead of adding another', async () => {
    const onChange = vi.fn();
    renderChips({ filters: [existing], onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Edit filter State is Draft' }));

    expect(await screen.findByRole('checkbox', { name: 'Draft (1)' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'In review (2)' }));
    fireEvent.click(screen.getByRole('button', { name: /Update/ }));

    expect(onChange).toHaveBeenCalledWith('', [{ ...existing, value: ['draft', 'review'] }]);
  });

  it('clears the search and every filter on "Clear all"', () => {
    const onSearch = vi.fn();
    renderChips({ freeText: 'bottom', filters: [existing], onChange: onSearch });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onSearch).toHaveBeenCalledWith('', []);
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
        heading: 'View filters',
        filters: [],
        freeText: '',
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
    renderChips({ filters: [legacy] });
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit filter Published on 2026-01-31 12:00:00' }),
    );

    expect(screen.getByRole('combobox', { name: 'View filter condition' })).toHaveTextContent('on');
    const value = screen.getByRole('textbox', { name: 'View filter value' });
    expect(value).toHaveValue('2026-01-31 12:00:00');
    expect(value).toHaveAttribute('type', 'text');
  });

  it('reports a missing upper bound on the upper input and focuses it', async () => {
    await addFromToolbar({ filters: [] }, 'Score');
    fireEvent.click(screen.getByRole('combobox', { name: 'View filter condition' }));
    const between = await screen.findByRole('option', { name: 'between' });
    choose(between);
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
    const Toolbar = () => controls({ filters: [state], onChange: onSearch }).toolbarButton;
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
    renderChips({ freeText: 'bottom', filters: [state], onChange: onSearch });

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
