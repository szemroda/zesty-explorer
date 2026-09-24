import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollectionNode, CollectionSchema } from '../../domain';
import { FilterBuilder } from './FilterBuilder';

const root: CollectionNode = {
  id: 'node-root',
  name: 'Stories',
  reference: {
    instanceZuid: '8-abc123',
    modelZuid: '6-model123',
    deployment: 'production',
    area: 'content',
    apiBaseUrl: 'https://8-abc123.api.zesty.io/v1',
    managerBaseUrl: 'https://8-abc123.manager.zesty.io',
  },
  presentation: {
    visibleColumns: ['*'],
    columnWidths: {},
    sort: { fieldPath: ['modified'], direction: 'desc' },
    filters: [],
    freeText: '',
  },
  children: [],
};

const schema: CollectionSchema = {
  modelZuid: '6-model123',
  label: 'Stories',
  fields: [{ id: '12-title123', name: 'title', label: 'Title', kind: 'text' }],
};

afterEach(cleanup);

describe('FilterBuilder', () => {
  it('explains a missing value on the value field instead of ignoring the click', () => {
    const onChange = vi.fn();
    render(
      <FilterBuilder
        label="Table filter"
        root={root}
        schemas={new Map([[root.id, schema]])}
        filters={[]}
        onChange={onChange}
      />,
    );
    const value = screen.getByRole('textbox', { name: 'Table filter value' });

    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(value).toHaveAttribute('aria-invalid', 'true');
    expect(value).toHaveAccessibleDescription('Enter a value.');
    expect(value).toHaveFocus();

    fireEvent.change(value, { target: { value: 'story' } });
    expect(value).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ fieldPath: ['title'], operator: 'contains', value: 'story' }),
    ]);
  });
});
