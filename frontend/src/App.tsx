import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, Palette, RefreshCw, Star, UploadCloud } from 'lucide-react';
import { cancelTripletExplore, exploreColors, getTripletExplore, scoreImages, startTripletExplore } from './api';
import type { ColorExploreResponse, ColorTripletExploreResponse, ColorTripletVariant, ImageScore } from './types';

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

type SpectrumPoint = {
  id: string;
  filename: string;
  score: number;
  rgb: number[];
  x: number;
  y: number;
  size: number;
  opacity: number;
  color: string;
  label: string;
  kind: 'good' | 'bad' | 'mid';
};

type SpectrumCluster = {
  label: string;
  count: number;
  averageScore: number;
  averageRgb: number[] | null;
  averageX: number;
  averageY: number;
};

type TripletProgress = {
  done: number;
  total: number;
  current: string;
  bestScore: number | null;
  device: string | null;
};

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
  const [tripletResult, setTripletResult] = useState<ColorTripletExploreResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [busy, setBusy] = useState<'score' | 'color' | null>(null);
  const [progress, setProgress] = useState('');
  const [scoringProgress, setScoringProgress] = useState<ScoringProgress | null>(null);
  const [tripletBusy, setTripletBusy] = useState(false);
  const [tripletError, setTripletError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tripletTimerRef = useRef<number | null>(null);

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
  const spectrumPoints = useMemo(() => {
    if (tripletResult?.variants?.length) {
      return buildTripletSpectrumPoints(tripletResult.variants);
    }
    return buildSpectrumPoints(scores, sortedImages);
  }, [scores, sortedImages, tripletResult]);
  const spectrumClusters = useMemo(() => buildSpectrumClusters(spectrumPoints), [spectrumPoints]);
  const tripletProgress = useMemo<TripletProgress | null>(() => {
    if (!tripletResult) return null;
    return {
      done: tripletResult.completedCombinations,
      total: tripletResult.totalCombinations,
      current: tripletResult.current ?? '',
      bestScore: tripletResult.bestScore,
      device: tripletResult.device
    };
  }, [tripletResult]);

  useEffect(() => {
    return () => {
      if (tripletTimerRef.current !== null) {
        window.clearTimeout(tripletTimerRef.current);
      }
    };
  }, []);

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
              averageRgb: null,
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

  async function runTripletExplore() {
    if (tripletBusy) return;
    setTripletBusy(true);
    setTripletError(null);
    setTripletResult(null);
    setProgress('3分割探索を開始しています...');

    try {
      const initial = await startTripletExplore(24);
      setTripletResult(initial);
      if (!isTripletFinished(initial.status)) {
        scheduleTripletPolling(initial.jobId);
      } else {
        setTripletBusy(false);
        setProgress('');
      }
    } catch (caught) {
      setTripletError(caught instanceof Error ? caught.message : '3分割探索に失敗しました。');
      setTripletBusy(false);
      setProgress('');
    }
  }

  async function stopTripletExplore() {
    if (!tripletResult?.jobId) return;
    try {
      const cancelled = await cancelTripletExplore(tripletResult.jobId);
      setTripletResult(cancelled);
    } catch (caught) {
      setTripletError(caught instanceof Error ? caught.message : '3分割探索の停止に失敗しました。');
    } finally {
      if (tripletTimerRef.current !== null) {
        window.clearTimeout(tripletTimerRef.current);
        tripletTimerRef.current = null;
      }
      setTripletBusy(false);
    }
  }

  function scheduleTripletPolling(jobId: string | null) {
    if (!jobId) return;
    if (tripletTimerRef.current !== null) {
      window.clearTimeout(tripletTimerRef.current);
    }
    tripletTimerRef.current = window.setTimeout(async () => {
      try {
        const latest = await getTripletExplore(jobId);
        setTripletResult(latest);
        if (!isTripletFinished(latest.status)) {
          scheduleTripletPolling(jobId);
        } else {
          setTripletBusy(false);
          tripletTimerRef.current = null;
          setProgress('');
        }
      } catch (caught) {
        setTripletError(caught instanceof Error ? caught.message : '3分割探索の進捗取得に失敗しました。');
        setTripletBusy(false);
        tripletTimerRef.current = null;
      }
    }, 500);
  }

  function isTripletFinished(status: string): boolean {
    return status === 'done' || status === 'error' || status === 'cancelled';
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local aesthetics predictor</p>
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
            <UploadCloud size={18} />
            <span>画像を選択</span>
            <input type="file" accept={ACCEPTED_TYPES.join(',')} multiple onChange={handleFiles} />
          </label>
          <button type="button" onClick={runScoring} disabled={busy !== null || images.length === 0}>
            {busy === 'score' ? <Loader2 className="spin" size={18} /> : <Star size={18} />}
            スコアリング
          </button>
          <button type="button" onClick={runColorExplore} disabled={busy !== null || !selectedImage}>
            <Palette size={18} />
            色探索
          </button>
          <button type="button" onClick={runTripletExplore} disabled={tripletBusy}>
            {tripletBusy ? <Loader2 className="spin" size={18} /> : <Palette size={18} />}
            3分割探索
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              images.forEach((image) => URL.revokeObjectURL(image.url));
              setImages([]);
              setScores([]);
              setColorResult(null);
              setTripletResult(null);
              setTripletError(null);
              setSelectedKey(null);
              setProgress('');
              setError(null);
              setScoringProgress(null);
              if (tripletTimerRef.current !== null) {
                window.clearTimeout(tripletTimerRef.current);
                tripletTimerRef.current = null;
              }
              setTripletBusy(false);
            }}
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

        {progress && (
          <p className="status" aria-live="polite">
            {progress}
          </p>
        )}
        {scoringProgress && (
          <div className="progress-panel" aria-label="スコアリング進捗">
            <div>
              <strong>
                {scoringProgress.done}/{scoringProgress.total}
              </strong>
              <span>{scoringProgress.current}</span>
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
              <h2>RGB spectrum</h2>
              <span>good / bad の点群を俯瞰</span>
            </div>
            {spectrumPoints.length === 0 ? (
              <div className="empty-state">
                <Palette size={36} />
                <p>スコアリングすると RGB の分布と評価の偏りを点で見られます。</p>
              </div>
            ) : (
              <SpectrumPanel points={spectrumPoints} clusters={spectrumClusters} />
            )}
          </div>

          <div className="panel">
            <div className="panel-title">
              <h2>3分割探索</h2>
              <span>3色の組み合わせを総当たり</span>
            </div>
            {!tripletResult ? (
              <div className="empty-state">
                <Palette size={36} />
                <p>ボタンを押すと 3 色の組み合わせを評価して、スコア順に並べます。</p>
              </div>
            ) : (
              <>
                <div className="job-progress">
                  <div className="job-progress-head">
                    <div>
                      <strong>
                        {tripletProgress?.done}/{tripletProgress?.total}
                      </strong>
                      <span>{tripletResult.status === 'done' ? '完了' : tripletResult.status}</span>
                    </div>
                    <div className="job-progress-meta">
                      {tripletProgress?.current && <span>{tripletProgress.current}</span>}
                      {tripletProgress?.device && <span>{tripletProgress.device}</span>}
                      {typeof tripletProgress?.bestScore === 'number' && <span>best {tripletProgress.bestScore.toFixed(2)}</span>}
                      {tripletBusy && (
                        <button type="button" className="inline-stop" onClick={stopTripletExplore}>
                          中止
                        </button>
                      )}
                    </div>
                  </div>
                  <progress value={tripletProgress?.done ?? 0} max={tripletProgress?.total ?? 1} />
                </div>
                {tripletError && <p className="error">{tripletError}</p>}
                {tripletResult.variants.length === 0 ? (
                  <div className="empty-state">
                    <Palette size={36} />
                    <p>進捗のあとに上位候補がここへ表示されます。</p>
                  </div>
                ) : (
                  <div className="triplet-grid">
                    {tripletResult.variants.map((variant) => (
                      <article className="triplet-card" key={variant.id}>
                        {variant.preview ? (
                          <img src={variant.preview} alt="" />
                        ) : (
                          <div className="triplet-fallback" aria-hidden="true" />
                        )}
                        <div className="variant-meta">
                          <strong>{variant.rank ? `#${variant.rank} ${variant.label}` : variant.label}</strong>
                          {variant.score === null ? (
                            <span className="bad">{variant.error}</span>
                          ) : (
                            <span>
                              {variant.score.toFixed(2)} / 10
                              {variant.summary ? <em>{variant.summary}</em> : null}
                            </span>
                          )}
                        </div>
                        <div className="swatch-row">
                          {variant.colors.map((color) => (
                            <span className="swatch-chip tiny" key={color.id} title={`${color.label} RGB(${color.rgb.join(', ')})`}>
                              <i style={{ backgroundColor: color.hex }} />
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
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
                              {variant.delta >= 0 ? '+' : ''}
                              {variant.delta.toFixed(2)}
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

  function isTripletFinished(status: string): boolean {
    return status === 'done' || status === 'error' || status === 'cancelled';
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

function SpectrumPanel({ points, clusters }: { points: SpectrumPoint[]; clusters: SpectrumCluster[] }) {
  return (
    <section className="spectrum-panel">
      <div className="spectrum-stage">
        <div className="spectrum-backdrop" aria-hidden="true" />
        {points.map((point) => (
          <span
            key={point.id}
            className={`spectrum-point ${point.kind}`}
            title={`${point.filename}\n${point.label}\n${point.rgb.join(', ')}`}
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              width: `${point.size}px`,
              height: `${point.size}px`,
              backgroundColor: point.color,
              opacity: point.opacity
            }}
          />
        ))}
        {clusters.map((cluster) => (
          <span
            key={cluster.label}
            className={`spectrum-cluster ${cluster.label}`}
            title={`${cluster.label} / ${cluster.count} 枚 / RGB(${cluster.averageRgb?.join(', ') ?? '--'})`}
            style={{
              left: `${cluster.averageX}%`,
              top: `${cluster.averageY}%`
            }}
          >
            <i style={{ backgroundColor: cluster.label === 'good' ? '#86f3c6' : '#ff8f7d' }} />
          </span>
        ))}
      </div>
      <div className="spectrum-legend" aria-label="RGB mapping">
        <span className="legend-title">RGB mapping</span>
        <span>x: hue</span>
        <span>y: brightness / saturation</span>
        <span>dot color: score</span>
        <span>R</span>
        <span>Y</span>
        <span>G</span>
        <span>C</span>
        <span>B</span>
        <span>M</span>
      </div>
      <div className="spectrum-summary">
        {clusters.map((cluster) => (
          <div key={cluster.label}>
            <span>{cluster.label}</span>
            <p>
              {cluster.count} 枚 · score {cluster.averageScore.toFixed(2)} · RGB
              {cluster.averageRgb ? `(${cluster.averageRgb.join(', ')})` : '--'}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildSpectrumPoints(scores: ImageScore[], images: LocalImage[]): SpectrumPoint[] {
  const entries = images
    .map((image) => {
      const result = scores.find((score) => score.id === imageKey(image));
      const score = result?.score ?? null;
      const rgb = result?.averageRgb ?? null;
      return {
        image,
        result,
        score,
        rgb
      };
    })
    .filter((entry): entry is { image: LocalImage; result: ImageScore | undefined; score: number; rgb: number[] } => {
      return typeof entry.score === 'number' && Array.isArray(entry.rgb) && entry.rgb.length === 3;
    });

  if (entries.length === 0) {
    return [];
  }

  const sorted = [...entries].sort((left, right) => right.score - left.score);
  const minScore = Math.min(...sorted.map((entry) => entry.score));
  const maxScore = Math.max(...sorted.map((entry) => entry.score));
  const topCutoff = Math.max(3, Math.ceil(sorted.length * 0.2));
  const bottomCutoff = Math.max(3, Math.ceil(sorted.length * 0.2));
  const topIds = new Set(sorted.slice(0, topCutoff).map((entry) => imageKey(entry.image)));
  const bottomIds = new Set(sorted.slice(-bottomCutoff).map((entry) => imageKey(entry.image)));

  return entries.map(({ image, result, score, rgb }) => {
    const { hue, saturation, value } = rgbToHsv(rgb);
    const normalizedScore = maxScore === minScore ? 0.5 : (score - minScore) / (maxScore - minScore);
    const x = clamp(hue / 360) * 100;
    const y = clamp(1 - value) * 85 + clamp(1 - saturation) * 15;
    const kind = topIds.has(imageKey(image)) ? 'good' : bottomIds.has(imageKey(image)) ? 'bad' : 'mid';
    return {
      id: imageKey(image),
      filename: result?.filename ?? image.file.name,
      score,
      rgb,
      x,
      y,
      size: kind === 'good' ? 12 : kind === 'bad' ? 10 : 8,
      opacity: kind === 'mid' ? 0.82 : 1,
      color: scoreToColor(normalizedScore),
      label: `${result?.filename ?? image.file.name} · ${score.toFixed(2)}`,
      kind
    };
  });
}

function buildTripletSpectrumPoints(variants: ColorTripletVariant[]): SpectrumPoint[] {
  const entries = variants
    .map((variant) => {
      const score = variant.score ?? null;
      const rgb = variant.colors.length
        ? [
            Math.round(variant.colors.reduce((sum, color) => sum + color.rgb[0], 0) / variant.colors.length),
            Math.round(variant.colors.reduce((sum, color) => sum + color.rgb[1], 0) / variant.colors.length),
            Math.round(variant.colors.reduce((sum, color) => sum + color.rgb[2], 0) / variant.colors.length)
          ]
        : null;
      return {
        variant,
        score,
        rgb
      };
    })
    .filter((entry): entry is { variant: ColorTripletVariant; score: number; rgb: number[] } => {
      return typeof entry.score === 'number' && Array.isArray(entry.rgb) && entry.rgb.length === 3;
    });

  if (entries.length === 0) {
    return [];
  }

  const sorted = [...entries].sort((left, right) => right.score - left.score);
  const minScore = Math.min(...sorted.map((entry) => entry.score));
  const maxScore = Math.max(...sorted.map((entry) => entry.score));
  const topCutoff = Math.max(3, Math.ceil(sorted.length * 0.2));
  const bottomCutoff = Math.max(3, Math.ceil(sorted.length * 0.2));
  const topIds = new Set(sorted.slice(0, topCutoff).map((entry) => entry.variant.id));
  const bottomIds = new Set(sorted.slice(-bottomCutoff).map((entry) => entry.variant.id));

  return entries.map(({ variant, score, rgb }) => {
    const { hue, saturation, value } = rgbToHsv(rgb);
    const normalizedScore = maxScore === minScore ? 0.5 : (score - minScore) / (maxScore - minScore);
    const x = clamp(hue / 360) * 100;
    const y = clamp(1 - value) * 85 + clamp(1 - saturation) * 15;
    const kind = topIds.has(variant.id) ? 'good' : bottomIds.has(variant.id) ? 'bad' : 'mid';
    return {
      id: variant.id,
      filename: variant.label,
      score,
      rgb,
      x,
      y,
      size: kind === 'good' ? 12 : kind === 'bad' ? 10 : 8,
      opacity: kind === 'mid' ? 0.82 : 1,
      color: scoreToColor(normalizedScore),
      label: `${variant.label} · ${score.toFixed(2)}`,
      kind
    };
  });
}

function buildSpectrumClusters(points: SpectrumPoint[]): SpectrumCluster[] {
  if (points.length === 0) {
    return [];
  }
  const sorted = [...points].sort((left, right) => right.score - left.score);
  const groupSize = Math.max(3, Math.ceil(sorted.length * 0.2));
  return [
    makeCluster('good', sorted.slice(0, groupSize)),
    makeCluster('bad', sorted.slice(-groupSize))
  ];
}

function makeCluster(label: 'good' | 'bad', points: SpectrumPoint[]): SpectrumCluster {
  const averageScore = points.reduce((sum, point) => sum + point.score, 0) / Math.max(1, points.length);
  const averageRgb = points.length
    ? [
        Math.round(points.reduce((sum, point) => sum + point.rgb[0], 0) / points.length),
        Math.round(points.reduce((sum, point) => sum + point.rgb[1], 0) / points.length),
        Math.round(points.reduce((sum, point) => sum + point.rgb[2], 0) / points.length)
      ]
    : null;
  const averageX = points.length ? points.reduce((sum, point) => sum + point.x, 0) / points.length : 50;
  const averageY = points.length ? points.reduce((sum, point) => sum + point.y, 0) / points.length : 50;
  return {
    label,
    count: points.length,
    averageScore,
    averageRgb,
    averageX,
    averageY
  };
}

function rgbToHsv(rgb: number[]): { hue: number; saturation: number; value: number } {
  const [red, green, blue] = rgb.map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }
  if (hue < 0) {
    hue += 360;
  }

  const saturation = max === 0 ? 0 : delta / max;
  const value = max;

  return { hue, saturation, value };
}

function scoreToColor(ratio: number): string {
  const clamped = clamp(ratio);
  const hue = 8 + clamped * 118;
  return `hsl(${hue} 82% 58%)`;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}
