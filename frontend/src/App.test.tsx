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

  it('runs the triplet search and shows the best combination', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            jobId: 'job-123',
            status: 'done',
            canvasSize: 1000,
            palette: [
              { id: 'ivory', label: 'Ivory', hex: '#f1ede3', rgb: [241, 237, 227], luminance: 0.94, saturation: 0.25, warmth: 0.06 },
              { id: 'teal', label: 'Teal', hex: '#2f7f7a', rgb: [47, 127, 122], luminance: 0.44, saturation: 0.63, warmth: -0.29 },
              { id: 'blue', label: 'Blue', hex: '#4c6fd8', rgb: [76, 111, 216], luminance: 0.51, saturation: 0.65, warmth: -0.55 }
            ],
            totalCombinations: 2197,
            completedCombinations: 2197,
            limit: 24,
            bestScore: 8.9,
            current: null,
            device: 'mps',
            variants: [
              {
                id: 'triplet-ivory-teal-blue',
                label: 'Ivory / Teal / Blue',
                score: 8.9,
                delta: 0,
                rank: 1,
                preview: 'data:image/webp;base64,abc',
                colors: [
                  { id: 'ivory', label: 'Ivory', hex: '#f1ede3', rgb: [241, 237, 227], luminance: 0.94, saturation: 0.25, warmth: 0.06 },
                  { id: 'teal', label: 'Teal', hex: '#2f7f7a', rgb: [47, 127, 122], luminance: 0.44, saturation: 0.63, warmth: -0.29 },
                  { id: 'blue', label: 'Blue', hex: '#4c6fd8', rgb: [76, 111, 216], luminance: 0.51, saturation: 0.65, warmth: -0.55 }
                ],
                features: {
                  leftLuminance: 0.94,
                  middleLuminance: 0.44,
                  rightLuminance: 0.51,
                  meanLuminance: 0.63,
                  luminanceContrast: 0.5,
                  saturationMean: 0.51,
                  saturationRange: 0.38,
                  warmthMean: -0.26,
                  hueSpread: 0.72,
                  rgbDistance: 0.49
                },
                tags: ['High contrast', 'Moderate saturation', 'Cool', 'Wide hue spread'],
                summary: 'High contrast / Moderate saturation / Cool / Wide hue spread',
                error: null
              }
            ],
            error: null
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /3分割探索/ }));

    expect(await screen.findByText('2197 通り / 1000×1000')).toBeInTheDocument();
    expect(screen.getAllByText('RGB(241, 237, 227)')).toHaveLength(3);
    expect(screen.getAllByRole('img', { name: 'Ivory / Teal / Blue' })).toHaveLength(2);
    expect(screen.getAllByText('High contrast / Moderate saturation / Cool / Wide hue spread')).toHaveLength(2);
  });
});
