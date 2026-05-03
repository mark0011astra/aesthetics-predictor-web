import { ChangeEvent, useMemo, useState } from 'react';
import { ImagePlus, Loader2, Palette, RefreshCw, Star, UploadCloud } from 'lucide-react';
import { exploreColors, scoreImages } from './api';
import type { ColorExploreResponse, ImageScore } from './types';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type LocalImage = {
  file: File;
  url: string;
};

type ScoringProgress = {
  done: number;
  total: number;
  current: string;
};

type SortKey =
  | 'total'
  | 'balanced'
  | 'harmonic'
  | 'laion'
  | 'overall'
  | 'quality'
  | 'composition'
  | 'lighting'
  | 'color'
  | 'depthOfField'
  | 'content';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'total', label: '合計点' },
  { key: 'balanced', label: '安定補正' },
  { key: 'harmonic', label: '弱点重視' },
  { key: 'laion', label: 'LAION' },
  { key: 'overall', label: 'Overall' },
  { key: 'quality', label: 'Quality' },
  { key: 'composition', label: 'Composition' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'color', label: 'Color' },
  { key: 'depthOfField', label: 'Depth' },
  { key: 'content', label: 'Content' }
];

function imageKey(image: LocalImage): string {
  return `${image.file.name}-${image.file.lastModified}-${image.file.size}`;
}

function metricValue(result: ImageScore | undefined, key: SortKey): number | null {
  if (!result) return null;
  const metric = result.metrics?.[key];
  if (metric !== undefined && metric !== null) return metric;
  if (key === 'laion' && result.score !== null) return result.score / 2;
  return null;
}

export function App() {
  const [images, setImages] = useState<LocalImage[]>([]);
  const [threshold, setThreshold] = useState(6);
  const [scores, setScores] = useState<ImageScore[]>([]);
  const [colorResult, setColorResult] = useState<ColorExploreResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [busy, setBusy] = useState<'score' | 'color' | null>(null);
  const [progress, setProgress] = useState('');
  const [scoringProgress, setScoringProgress] = useState<ScoringProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scoreMap = useMemo(() => new Map(scores.map((score) => [score.id, score])), [scores]);
  const sortedImages = useMemo(() => {
    return [...images].sort((left, right) => {
      const leftScore = metricValue(scoreMap.get(imageKey(left)), sortKey) ?? -1;
      const rightScore = metricValue(scoreMap.get(imageKey(right)), sortKey) ?? -1;
      return rightScore - leftScore;
    });
  }, [images, scoreMap, sortKey]);
  const selectedImage = sortedImages.find((image) => imageKey(image) === selectedKey) ?? sortedImages[0] ?? images[0];
  const selectedScore = selectedImage ? scoreMap.get(imageKey(selectedImage)) : undefined;
  const selectedSortOption = SORT_OPTIONS.find((option) => option.key === sortKey) ?? SORT_OPTIONS[0];

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    const valid = picked.filter((file) => ACCEPTED_TYPES.includes(file.type));

    setError(null);
    setScores([]);
    setColorResult(null);
    setProgress('');
    setScoringProgress(null);

    if (picked.length !== valid.length) {
      setError('JPEG / PNG / WebP のみ対応しています。');
    }

    images.forEach((image) => URL.revokeObjectURL(image.url));
    const nextImages = valid.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setImages(nextImages);
    setSelectedKey(nextImages[0] ? imageKey(nextImages[0]) : null);
  }

  async function runScoring() {
    if (images.length === 0) return;
    setBusy('score');
    setError(null);
    setScores([]);
    setProgress(`${images.length} 枚を解析しています...`);
    setScoringProgress({ done: 0, total: images.length, current: images[0]?.file.name ?? '' });

    try {
      const collected: ImageScore[] = [];
      for (const [index, image] of images.entries()) {
        setScoringProgress({ done: index, total: images.length, current: image.file.name });
        const response = await scoreImages([image.file], threshold);
        const result = response.results[0]?.id
          ? response.results[0]
          : {
              id: imageKey(image),
              filename: image.file.name,
              score: null,
              rank: null,
              isBeautiful: null,
              width: null,
              height: null,
              metrics: {},
              error: 'No result returned.'
            };
        collected.push({ ...result, id: imageKey(image) });
        setScores([...collected]);
      }
      setScoringProgress({ done: images.length, total: images.length, current: '' });
      setProgress(`${collected.filter((item) => item.score !== null).length} 枚をスコアリングしました。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'スコアリングに失敗しました。');
      setProgress('');
    } finally {
      setBusy(null);
      setScoringProgress(null);
    }
  }

  async function runColorExplore() {
    if (!selectedImage) return;
    setBusy('color');
    setError(null);
    setProgress(`${selectedImage.file.name} の色変更候補を探索しています...`);

    try {
      const response = await exploreColors(selectedImage.file, threshold);
      setColorResult(response);
      setProgress(`${response.variants.filter((item) => item.score !== null).length} 個の色候補を比較しました。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '色探索に失敗しました。');
      setProgress('');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local Aesthetics Predictor</p>
            <h1>画像の美的スコアを比較</h1>
          </div>
          <div className="threshold-control">
            <label htmlFor="threshold">美しい判定しきい値</label>
            <div>
              <input
                id="threshold"
                type="range"
                min="0"
                max="10"
                step="0.1"
                value={threshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
              <strong>{threshold.toFixed(1)}</strong>
            </div>
          </div>
        </header>

        <div className="toolbar">
          <label className="upload-button">
            <UploadCloud aria-hidden="true" size={20} />
            <span>画像を選択</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleFiles} />
          </label>
          <button type="button" onClick={runScoring} disabled={images.length === 0 || busy !== null}>
            {busy === 'score' ? <Loader2 className="spin" size={18} /> : <Star size={18} />}
            スコアリング
          </button>
          <button type="button" onClick={runColorExplore} disabled={images.length === 0 || busy !== null}>
            {busy === 'color' ? <Loader2 className="spin" size={18} /> : <Palette size={18} />}
            色探索
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setScores([]);
              setColorResult(null);
              setProgress('');
              setScoringProgress(null);
              setError(null);
            }}
            disabled={busy !== null}
          >
            <RefreshCw size={18} />
            結果をクリア
          </button>
        </div>

        <div className="sort-toolbar">
          <label htmlFor="sort-key">並び替え</label>
          <select id="sort-key" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {progress && <p className="status">{progress}</p>}
        {scoringProgress && (
          <div className="progress-panel" aria-label="スコアリング進捗">
            <div>
              <strong>
                {scoringProgress.done} / {scoringProgress.total}
              </strong>
              <span>{scoringProgress.current || '完了'}</span>
            </div>
            <progress value={scoringProgress.done} max={scoringProgress.total} />
          </div>
        )}
        {error && <p className="error">{error}</p>}

        <section className="selected-preview">
          {selectedImage ? (
            <>
              <img src={selectedImage.url} alt={selectedImage.file.name} />
              <div className="selected-preview-meta">
                <span>選択中</span>
                <strong>{selectedImage.file.name}</strong>
                <p>
                  {metricValue(selectedScore, sortKey) !== null
                    ? `${selectedSortOption.label}: ${metricValue(selectedScore, sortKey)?.toFixed(2)} / 5`
                    : selectedScore?.error
                      ? '解析エラー'
                      : '未解析'}
                </p>
                {selectedScore?.metrics && <MetricStrip result={selectedScore} />}
              </div>
            </>
          ) : (
            <div className="selected-preview-empty">画像を選択するとここにプレビューします。</div>
          )}
        </section>

        <section className="content-stack">
          <div className="panel">
            <div className="panel-title">
              <h2>ランキング</h2>
              <span>{images.length} 枚</span>
            </div>
            {images.length === 0 ? (
              <div className="empty-state">
                <ImagePlus size={36} />
                <p>JPEG / PNG / WebP をまとめて選択できます。</p>
              </div>
            ) : (
              <div className="ranking-grid">
                {sortedImages.map((image, index) => {
                  const result = scoreMap.get(imageKey(image));
                  return (
                    <button
                      className={imageKey(image) === (selectedImage ? imageKey(selectedImage) : '') ? 'image-card selected' : 'image-card'}
                      type="button"
                      key={`${image.file.name}-${image.file.lastModified}`}
                      onClick={() => setSelectedKey(imageKey(image))}
                    >
                      <img src={image.url} alt="" />
                      <div className="image-card-meta">
                        <strong>{metricValue(result, sortKey) !== null ? `#${index + 1}` : '--'}</strong>
                        <span title={image.file.name}>{image.file.name}</span>
                        {result?.error && <small className="row-error">{result.error}</small>}
                      </div>
                      <ScoreBadge result={result} sortKey={sortKey} label={selectedSortOption.label} />
                      {result?.metrics && <MetricStrip result={result} compact />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-title">
              <h2>色変更探索</h2>
              <span>初期約20候補 + 上位を再探索</span>
            </div>
            {!colorResult ? (
              <div className="empty-state">
                <Palette size={36} />
                <p>ランキングから対象を選び、色探索を実行すると候補がスコア順に並びます。</p>
              </div>
            ) : (
              <div className="variant-grid">
                {colorResult.variants.map((variant) => (
                  <article className="variant-card" key={variant.id}>
                    {variant.preview && <img src={variant.preview} alt="" />}
                    <div className="variant-meta">
                      <strong>{variant.rank ? `#${variant.rank} ${variant.label}` : variant.label}</strong>
                      {variant.score === null ? (
                        <span className="bad">{variant.error}</span>
                      ) : (
                        <span>
                          {variant.score?.toFixed(2)} / 10
                          {variant.delta !== null && (
                            <em className={variant.delta >= 0 ? 'up' : 'down'}>
                              {variant.delta >= 0 ? '+' : ''}{variant.delta.toFixed(2)}
                            </em>
                          )}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function ScoreBadge({ result, sortKey, label }: { result?: ImageScore; sortKey: SortKey; label: string }) {
  if (!result) {
    return <span className="score-badge muted">未解析</span>;
  }
  if (result.error) {
    return <span className="score-badge bad">Error</span>;
  }
  const value = metricValue(result, sortKey);
  return (
    <span className={result.isBeautiful ? 'score-badge good' : 'score-badge'}>
      {label}: {value === null ? '--' : value.toFixed(2)}
    </span>
  );
}

function MetricStrip({ result, compact = false }: { result: ImageScore; compact?: boolean }) {
  const metrics = [
    ['L', result.metrics?.laion],
    ['O', result.metrics?.overall],
    ['Q', result.metrics?.quality],
    ['C', result.metrics?.composition],
    ['Li', result.metrics?.lighting],
    ['Co', result.metrics?.color],
    ['D', result.metrics?.depthOfField],
    ['Ct', result.metrics?.content]
  ];
  return (
    <div className={compact ? 'metric-strip compact' : 'metric-strip'}>
      {metrics.map(([label, value]) => (
        <span key={label as string}>
          <b>{label}</b>
          {typeof value === 'number' ? value.toFixed(1) : '--'}
        </span>
      ))}
    </div>
  );
}
