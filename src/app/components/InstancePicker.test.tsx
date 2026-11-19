import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { instanceReferenceFor } from '../../collection-reference';
import type { InstanceListEntry, InstanceReference } from '../../domain';
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

function renderList({
  current,
  onChoose = vi.fn(),
  onPasteUrl = vi.fn(() => undefined),
  ...overrides
}: Partial<InstanceListQueryResult> & {
  readonly current?: InstanceReference;
  readonly onChoose?: (instance: InstanceReference) => void;
  readonly onPasteUrl?: (url: string) => string | undefined;
} = {}) {
  render(
    <InstancePicker
      query={query(overrides)}
      deployment="production"
      current={current}
      onChoose={onChoose}
      onPasteUrl={onPasteUrl}
    />,
  );
  return screen.getByRole('combobox', {
    name: 'Search instances by name or ZUID, or paste a Zesty URL',
  });
}

const optionTexts = () => screen.getAllByRole('option').map((option) => option.textContent);

describe('InstancePicker', () => {
  it('sorts named instances before unnamed ones and finds one by name or ZUID', () => {
    const onChoose = vi.fn();
    const search = renderList({ onChoose });
    expect(optionTexts()).toEqual([
      'Acme Corp8-acme001',
      'Acme Corp8-acme123',
      'Zulu8-zulu123',
      '8-unnamed8-unnamed',
    ]);
    fireEvent.change(search, { target: { value: 'ACME' } });
    expect(optionTexts()).toEqual(['Acme Corp8-acme001', 'Acme Corp8-acme123']);
    fireEvent.change(search, { target: { value: '8-unnamed' } });
    fireEvent.click(screen.getByRole('option', { name: /8-unnamed/ }));
    expect(onChoose).toHaveBeenCalledWith({
      instanceZuid: '8-unnamed',
      deployment: 'production',
      apiBaseUrl: 'https://8-unnamed.api.zesty.io/v1',
      managerBaseUrl: 'https://8-unnamed.manager.zesty.io',
    });
  });

  it('chooses the instance the arrow keys reach when Enter is pressed', () => {
    const onChoose = vi.fn();
    const search = renderList({ onChoose });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Zulu');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChoose.mock.calls[0]?.[0]).toMatchObject({ instanceZuid: '8-zulu123' });
  });

  it('places the open unlisted instance first and keeps its collection suggestion', () => {
    const current = {
      ...instanceReferenceFor('8-missing', 'production'),
      suggestedModelZuid: '6-stories123',
    } as const;
    const onChoose = vi.fn();
    renderList({ current, onChoose });
    const missing = screen.getByRole('option', { name: /8-missing.*Not in your instance list/ });
    expect(screen.getAllByRole('option')[0]).toBe(missing);
    expect(missing).toHaveTextContent('Open');
    fireEvent.click(missing);
    expect(onChoose).toHaveBeenCalledWith({
      instanceZuid: '8-missing',
      deployment: 'production',
      apiBaseUrl: 'https://8-missing.api.zesty.io/v1',
      managerBaseUrl: 'https://8-missing.manager.zesty.io',
      suggestedModelZuid: '6-stories123',
    });
  });

  it.each([
    { state: 'loading', isLoading: true, error: undefined },
    { state: 'failed', isLoading: false, error: { kind: 'network', message: 'Unavailable.' } },
  ] as const)('does not call the open instance unlisted while the list is $state', (state) => {
    renderList({
      list: undefined,
      isLoading: state.isLoading,
      error: state.error,
      current: instanceReferenceFor('8-missing', 'production'),
    });
    expect(screen.getByRole('option')).toHaveTextContent('8-missing8-missing Open');
  });

  it('offers Retry and the pasted URL fallback when the list fails', () => {
    const refresh = vi.fn(() => Promise.resolve(true));
    renderList({
      list: undefined,
      error: { kind: 'network', message: 'Instance list is unavailable.' },
      refresh,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Instance list is unavailable.');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Paste a Zesty URL above to open an instance directly.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry instance list' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reports omitted and truncated records together and points at the URL fallback', () => {
    renderList({
      list: {
        deployment: 'production',
        instances: entries,
        warning: {
          kind: 'decoding',
          message: 'Some instance records could not be understood and were omitted.',
        },
        truncated: { returned: 100, total: 140 },
      },
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Some instance records could not be understood and were omitted.Zesty returned 100 of 140 instances.Paste a Zesty URL above to open one that is missing.',
    );
    expect(screen.getByRole('button', { name: 'Technical details' })).toBeInTheDocument();
  });

  it('names the other deployments when this one lists no instances', () => {
    renderList({ list: { deployment: 'production', instances: [] } });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Zesty lists no Production instances for this session token. If you work in Stage or Development, use another session token or deployment. Or paste a Zesty URL.',
    );
  });

  it('opens a pasted URL straight away and shows what is wrong with it', () => {
    const onPasteUrl = vi.fn(() => 'This host is not an allowed Zesty deployment host.');
    const search = renderList({ onPasteUrl });
    fireEvent.input(search, {
      target: { value: 'https://example.com/content' },
      inputType: 'insertFromPaste',
    });
    expect(onPasteUrl).toHaveBeenCalledWith('https://example.com/content');
    expect(screen.getByRole('option')).toHaveTextContent(
      'Open this Zesty URLhttps://example.com/content',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This host is not an allowed Zesty deployment host.',
    );
  });

  it('opens a typed URL on Enter, not while it is typed', () => {
    const onPasteUrl = vi.fn(() => undefined);
    const search = renderList({ onPasteUrl });
    fireEvent.change(search, { target: { value: 'https://8-acme123.manager.zesty.io/' } });
    expect(onPasteUrl).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPasteUrl).toHaveBeenCalledWith('https://8-acme123.manager.zesty.io/');
  });
});
