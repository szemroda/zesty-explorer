import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('application shell', () => {
  it('introduces the collection-opening workflow', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Zesty Explorer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Open a Zesty collection' })).toBeInTheDocument();
  });
});
