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

  it('renders the RGB spectrum after scoring images', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              threshold: 6,
              results: [
                {
                  id: 'image-0',
                  filename: 'warm.png',
                  score: 8.9,
                  metrics: {
                    total: 4.5,
                    balanced: 4.2,
                    harmonic: 4.0,
                    laion: 4.3,
                    overall: 4.7,
                    quality: 4.6,
                    composition: 4.5,
                    lighting: 4.2,
                    color: 4.9,
                    depthOfField: 4.0,
                    content: 4.1
                  },
                  rank: 1,
                  isBeautiful: true,
                  width: 12,
                  height: 8,
                  averageRgb: [241, 237, 227],
                  error: null
                }
              ]
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              threshold: 6,
              results: [
                {
                  id: 'image-0',
                  filename: 'dark.png',
                  score: 2.1,
                  metrics: {
                    total: 1.8,
                    balanced: 1.5,
                    harmonic: 1.2,
                    laion: 1.0,
                    overall: 1.4,
                    quality: 1.7,
                    composition: 1.6,
                    lighting: 1.2,
                    color: 1.5,
                    depthOfField: 1.4,
                    content: 1.3
                  },
                  rank: 1,
                  isBeautiful: false,
                  width: 12,
                  height: 8,
                  averageRgb: [38, 49, 61],
                  error: null
                }
              ]
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
    );

    render(<App />);

    const fileOne = new File(['image'], 'warm.png', { type: 'image/png' });
    const fileTwo = new File(['image'], 'dark.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    vi.stubGlobal('URL', {
      createObjectURL: vi
        .fn()
        .mockImplementationOnce(() => 'blob:warm')
        .mockImplementationOnce(() => 'blob:dark'),
      revokeObjectURL: vi.fn()
    });

    await user.upload(input, [fileOne, fileTwo]);
    await user.click(screen.getByRole('button', { name: /スコアリング/ }));

    expect(await screen.findByText('RGB spectrum')).toBeInTheDocument();
    expect(screen.getByText('good / bad の点群を俯瞰')).toBeInTheDocument();

    const spectrum = document.querySelector('.spectrum-panel');
    expect(spectrum).not.toBeNull();
    expect(spectrum?.querySelectorAll('.spectrum-point')).toHaveLength(2);
    expect(spectrum?.querySelectorAll('.spectrum-cluster')).toHaveLength(2);
    expect(spectrum?.querySelectorAll('.spectrum-summary > div')).toHaveLength(2);
  });

  it('renders triplet search results after starting exploration', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobId: 'job-123',
            status: 'done',
            canvasSize: 1000,
            palette: [],
            totalCombinations: 2197,
            completedCombinations: 2197,
            limit: 24,
            bestScore: 9.72,
            current: null,
            device: 'mps',
            spectrum: null,
            variants: [
              {
                id: 'triplet-ink-ivory-green',
                label: 'Ink / Ivory / Green',
                score: 9.72,
                delta: null,
                rank: 1,
                preview: 'data:image/webp;base64,triplet',
                colors: [
                  { id: 'ink', label: 'Ink', hex: '#101418', rgb: [16, 20, 24], luminance: 0.1, saturation: 0.1, warmth: -0.1 },
                  { id: 'ivory', label: 'Ivory', hex: '#f1ede3', rgb: [241, 237, 227], luminance: 0.9, saturation: 0.1, warmth: 0.1 },
                  { id: 'green', label: 'Green', hex: '#4c9b64', rgb: [76, 155, 100], luminance: 0.5, saturation: 0.4, warmth: -0.1 }
                ],
                features: null,
                tags: ['Balanced contrast'],
                summary: 'Balanced contrast',
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

    expect(document.querySelector('.job-progress')).toBeInTheDocument();
    expect(document.querySelector('.triplet-grid')).toBeInTheDocument();
    expect(document.querySelectorAll('.triplet-card')).toHaveLength(1);
    expect(screen.getByText('9.72 / 10')).toBeInTheDocument();
    expect(screen.getByText('Balanced contrast')).toBeInTheDocument();
  });
});
