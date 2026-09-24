import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { FieldPathInput } from './FieldPathInput';

function ParentPath() {
  const [value, setValue] = useState('');
  return (
    <FieldPathInput
      label="Parent field path"
      value={value}
      onValueChange={setValue}
      paths={['id', 'parent', 'parentKey', 'title']}
    />
  );
}

describe('FieldPathInput', () => {
  it('suggests matching paths and hides the list once a path is typed in full', async () => {
    render(<ParentPath />);
    const input = screen.getByRole('combobox', { name: 'Parent field path' });
    input.focus();

    fireEvent.change(input, { target: { value: 'par' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['parent', 'parentKey']);

    fireEvent.change(input, { target: { value: 'parentKey' } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('parentKey');
  });
});
