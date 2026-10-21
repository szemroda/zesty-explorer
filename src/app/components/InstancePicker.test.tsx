import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { instanceReferenceFor } from '../../collection-reference';
import type { InstanceListEntry } from '../../domain';
import type { InstanceListQueryResult } from '../hooks/useInstanceList';
import { InstancePicker } from './InstancePicker';

const entries: readonly InstanceListEntry[] = [
  { reference: instanceReferenceFor('8-unnamed', 'production') },
  { name: 'Zulu', reference: instanceReferenceFor('8-zulu123', 'production') },
  { name: 'Acme Corp', reference: instanceReferenceFor('8-acme123', 'production') },
  { name: 'Acme Corp', reference: instanceReferenceFor('8-acme001', 'production') },
];

function query(overrides: Partial<InstanceListQueryResult> = {}): InstanceListQueryResult {
  return {
    list: { deployment: 'production', instances: entries },
    error: undefined,
    isLoading: false,
    refresh: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

describe('InstancePicker', () => {
  it('sorts named instances before unnamed ones and finds a choice by name or ZUID', async () => {
    const onChange = vi.fn();
    render(<InstancePicker query={query()} value={undefined} onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Instance' });
    fireEvent.click(screen.getByRole('button', { name: 'Show instances' }));
    await screen.findByRole('option', { name: /Zulu.*8-zulu123/ });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Acme Corp8-acme001',
      'Acme Corp8-acme123',
      'Zulu8-zulu123',
      '8-unnamed8-unnamed',
    ]);
    fireEvent.change(input, { target: { value: 'acme' } });
    await waitFor(() =>
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Acme Corp8-acme001',
        'Acme Corp8-acme123',
      ]),
    );
    fireEvent.change(input, { target: { value: '8-unnamed' } });
    fireEvent.click(await screen.findByRole('option', { name: /8-unnamed.*8-unnamed/ }));
    expect(onChange.mock.calls[0]?.[0]).toEqual({
      instanceZuid: '8-unnamed',
      deployment: 'production',
      apiBaseUrl: 'https://8-unnamed.api.zesty.io/v1',
      managerBaseUrl: 'https://8-unnamed.manager.zesty.io',
    });
  });

  it('places the chosen unlisted instance first and keeps its collection suggestion', async () => {
    const value = {
      ...instanceReferenceFor('8-missing', 'production'),
      suggestedModelZuid: '6-stories123',
    } as const;
    const onChange = vi.fn();
    render(<InstancePicker query={query()} value={value} onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Instance' })).toHaveValue('8-missing');
    fireEvent.click(screen.getByRole('button', { name: 'Show instances' }));
    const missing = await screen.findByRole('option', {
      name: /8-missing.*Not in your instance list/,
    });
    expect(screen.getAllByRole('option')[0]).toBe(missing);
    fireEvent.click(missing);
    expect(onChange.mock.calls[0]?.[0]).toEqual({
      instanceZuid: '8-missing',
      deployment: 'production',
      apiBaseUrl: 'https://8-missing.api.zesty.io/v1',
      managerBaseUrl: 'https://8-missing.manager.zesty.io',
      suggestedModelZuid: '6-stories123',
    });
  });

  it('offers Retry and the pasted URL fallback when the list fails', () => {
    const refresh = vi.fn(() => Promise.resolve(true));
    render(
      <InstancePicker
        query={query({
          list: undefined,
          error: { kind: 'network', message: 'Instance list is unavailable.' },
          refresh,
        })}
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Instance list is unavailable.');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Paste a Zesty URL below to open an instance directly.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry instance list' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows a loading row in the popup before the list arrives', async () => {
    render(
      <InstancePicker
        query={query({ list: undefined, isLoading: true })}
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show instances' }));
    expect(await screen.findByText('Loading instances…')).toBeInTheDocument();
    expect(screen.queryByText('No instances found.')).not.toBeInTheDocument();
  });

  it.each([
    { state: 'loading', isLoading: true, error: undefined },
    { state: 'failed', isLoading: false, error: { kind: 'network', message: 'Unavailable.' } },
  ] as const)(
    'does not call a selected instance unlisted while the list is $state',
    async (state) => {
      render(
        <InstancePicker
          query={query({ list: undefined, isLoading: state.isLoading, error: state.error })}
          value={instanceReferenceFor('8-missing', 'production')}
          onChange={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Show instances' }));
      expect(await screen.findByRole('option')).toHaveTextContent('8-missing8-missing');
      expect(screen.queryByText('Not in your instance list')).not.toBeInTheDocument();
    },
  );

  it('keeps focus when the list names a selected instance', () => {
    const value = instanceReferenceFor('8-acme123', 'production');
    const onChange = vi.fn();
    const { rerender } = render(
      <InstancePicker
        query={query({ list: undefined, isLoading: true })}
        value={value}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Instance' });
    act(() => input.focus());
    rerender(<InstancePicker query={query()} value={value} onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Instance' })).toBe(input);
    expect(input).toHaveFocus();
  });

  it('hides instance list notices and Retry when instance selection is disabled', () => {
    render(
      <InstancePicker
        query={query({
          error: { kind: 'network', message: 'Instance list is unavailable.' },
          list: {
            deployment: 'production',
            instances: [],
            warning: { kind: 'decoding', message: 'Omitted records.' },
            truncated: { returned: 0, total: 10 },
          },
        })}
        value={instanceReferenceFor('8-acme123', 'production')}
        disabled
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry instance list' })).not.toBeInTheDocument();
  });

  it('reports omitted and truncated records together and points at the URL fallback', () => {
    render(
      <InstancePicker
        query={query({
          list: {
            deployment: 'production',
            instances: entries,
            warning: {
              kind: 'decoding',
              message: 'Some instance records could not be understood and were omitted.',
            },
            truncated: { returned: 100, total: 140 },
          },
        })}
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Some instance records could not be understood and were omitted.',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Zesty returned 100 of 140 instances.');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Paste a Zesty URL below to open one that is missing.',
    );
    expect(screen.getByRole('button', { name: 'Technical details' })).toBeInTheDocument();
  });
});
