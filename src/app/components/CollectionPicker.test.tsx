import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CollectionPicker } from './CollectionPicker';

describe('CollectionPicker', () => {
  it('shows catalog loading inside the field', () => {
    render(
      <CollectionPicker
        label="Root collection"
        collections={[]}
        value={undefined}
        onChange={vi.fn()}
        loading
      />,
    );

    expect(screen.getByRole('status', { name: 'Loading collection catalog' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Root collection' })).toHaveAttribute(
      'placeholder',
      'Loading collections…',
    );
  });
});
