import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the scoring workbench', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '画像の美的スコアを比較' })).toBeInTheDocument();
    expect(screen.getByText('美しい判定しきい値')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /スコアリング/ })).toBeDisabled();
  });

  it('accepts supported image files and enables actions', async () => {
    const user = userEvent.setup();
    render(<App />);

    const file = new File(['image'], 'sample.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:sample'),
      revokeObjectURL: vi.fn()
    });

    await user.upload(input, file);

    expect(screen.getAllByText('sample.png')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'sample.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /スコアリング/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /色探索/ })).toBeEnabled();
  });
});
