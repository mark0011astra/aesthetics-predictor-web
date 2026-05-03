import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { ImagePlus, Loader2, Palette, RefreshCw, Star, UploadCloud } from 'lucide-react';
import { exploreColors, exploreTriplets, getTripletExplore, scoreImages } from './api';
import type { ColorExploreResponse, ColorTripletExploreResponse, ColorTripletFeatures, ColorSwatch, ImageScore } from './types';

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
  const [tripletJob, setTripletJob] = useState<ColorTripletExploreResponse | null>(null);
  const [tripletResult, setTripletResult] = useState<ColorTripletExploreResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedTripletId, setSelectedTripletId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [busy, setBusy] = useState<'score' | 'color' | 'triplet' | null>(null);
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
  const selectedTriplet = tripletResult
    ? tripletResult.variants.find((variant) => variant.id === selectedTripletId) ?? tripletResult.variants[0] ?? null
    : null;
  const selectedTripletScore = selectedTriplet?.score ?? null;
  const selectedTripletDelta = selectedTriplet?.delta ?? null;
  const tripletError = tripletResult?.error ?? tripletJob?.error ?? null;
  const tripletProgress = tripletJob ? tripletJob.completedCombinations / Math.max(1, tripletJob.totalCombinations) : 0;

  useEffect(() => {
    const jobId = tripletJob?.jobId;
    const status = tripletJob?.status;
    if (!jobId || status === 'done' || status === 'error') {
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const next = await getTripletExplore(jobId);
        if (!active) return;
        setTripletJob(next);
        setProgress(
          `${next.completedCombinations} / ${next.totalCombinations} 通りを評価中${next.current ? ` · ${next.current}` : ''}${next.device ? ` · ${next.device}` : ''}`
        );
        if (next.status === 'done') {
          setTripletResult(next);
          setSelectedTripletId(next.variants[0]?.id ?? null);
          setProgress(`${next.totalCombinations} 通りを評価しました。`);
          setBusy(null);
        } else if (next.status === 'error') {
          setError(next.error ?? '三分割色探索に失敗しました。');
          setProgress('');
          setBusy(null);
        }
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : '三分割色探索の進捗取得に失敗しました。');
        setProgress('');
        setBusy(null);
      }
    }, 650);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [tripletJob?.jobId, tripletJob?.status, tripletJob?.completedCombinations, tripletJob?.current, tripletJob?.device]);

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

  async function runTripletExplore() {
    setBusy('triplet');
    setError(null);
    setProgress('1000x1000 の三分割色パターンを全探索しています...');
    setTripletJob(null);
    setTripletResult(null);
    setSelectedTripletId(null);

    try {
      const response = await exploreTriplets(24);
      setTripletJob(response);
      if (response.status === 'done') {
        setTripletResult(response);
        setSelectedTripletId(response.variants[0]?.id ?? null);
        setProgress(`${response.totalCombinations} 通りを評価しました。`);
        setBusy(null);
      } else {
        setProgress(`${response.completedCombinations} / ${response.totalCombinations} 通りを評価中...`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '三分割色探索に失敗しました。');
      setProgress('');
      setBusy(null);
    } finally {
      // busy state is cleared when the job finishes or fails in the polling loop.
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
          <button type="button" onClick={runTripletExplore} disabled={busy !== null}>
            {busy === 'triplet' ? <Loader2 className="spin" size={18} /> : <Palette size={18} />}
            3分割探索
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setScores([]);
              setColorResult(null);
              setTripletResult(null);
              setSelectedTripletId(null);
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

          <div className="panel">
            <div className="panel-title">
              <h2>三分割色探索</h2>
              <span>{tripletJob ? `${tripletJob.totalCombinations} 通り / 1000×1000` : 'RGB 2197 通りを評価'}</span>
            </div>
            {!tripletJob && !tripletResult ? (
              <div className="empty-state">
                <Palette size={36} />
                <p>1000×1000 の正方形を 3 分割して、RGB パレット 2197 通りを探索します。</p>
              </div>
            ) : (
              <>
                <div className="job-progress">
                  <div className="job-progress-head">
                    <div>
                      <strong>
                        {(tripletJob?.completedCombinations ?? tripletResult?.completedCombinations ?? 0)}/
                        {tripletJob?.totalCombinations ?? tripletResult?.totalCombinations ?? 0}
                      </strong>
                      <span>{tripletJob?.current ?? tripletResult?.current ?? 'waiting'}</span>
                    </div>
                    <div className="job-progress-meta">
                      <span>{Math.round(tripletProgress * 100)}%</span>
                      {(tripletJob?.device ?? tripletResult?.device) && (
                        <span>{tripletJob?.device ?? tripletResult?.device}</span>
                      )}
                      {(tripletJob?.status ?? tripletResult?.status) && (
                        <span>{tripletJob?.status ?? tripletResult?.status}</span>
                      )}
                    </div>
                  </div>
                  <progress
                    value={tripletJob?.completedCombinations ?? tripletResult?.completedCombinations ?? 0}
                    max={tripletJob?.totalCombinations ?? tripletResult?.totalCombinations ?? 1}
                  />
                </div>
                {tripletError ? (
                  <div className="empty-state">
                    <Palette size={36} />
                    <p>{tripletError}</p>
                  </div>
                ) : null}
                <section className="triplet-preview">
                  {selectedTriplet?.preview ? (
                    <img src={selectedTriplet.preview} alt={selectedTriplet.label} />
                  ) : (
                    <div className="selected-preview-empty">
                      {tripletJob?.status === 'done' ? '結果を選ぶとここに大きく表示します。' : '探索中です。'}
                    </div>
                  )}
                  <div className="triplet-preview-meta">
                    <span>選択中</span>
                    <strong>{selectedTriplet?.label ?? '未選択'}</strong>
                    <p>
                      {selectedTripletScore !== null
                        ? `Score: ${selectedTripletScore.toFixed(2)} / 10`
                        : '未解析'}
                      {selectedTripletDelta !== null && (
                        <em className={selectedTripletDelta >= 0 ? 'up' : 'down'}>
                          {selectedTripletDelta >= 0 ? '+' : ''}
                          {selectedTripletDelta.toFixed(2)}
                        </em>
                      )}
                    </p>
                    <TripletSwatchRow colors={selectedTriplet?.colors ?? []} />
                    <TripletFeaturePanel
                      features={selectedTriplet?.features ?? null}
                      tags={selectedTriplet?.tags ?? []}
                      summary={selectedTriplet?.summary ?? null}
                    />
                  </div>
                </section>
                <div className="palette-strip">
                  {(tripletResult?.palette ?? tripletJob?.palette ?? []).map((color) => (
                    <span key={color.id} className="palette-chip" title={color.label}>
                      <i style={{ backgroundColor: color.hex }} />
                      <span className="palette-label">
                        {color.label}
                        <small>{formatRgb(color.rgb)}</small>
                      </span>
                    </span>
                  ))}
                </div>
                <div className="triplet-grid">
                  {(tripletResult?.variants ?? []).map((variant) => (
                    <button
                      className={variant.id === selectedTriplet?.id ? 'triplet-card selected' : 'triplet-card'}
                      type="button"
                      key={variant.id}
                      onClick={() => setSelectedTripletId(variant.id)}
                    >
                      {variant.preview ? <img src={variant.preview} alt={variant.label} /> : <div className="triplet-fallback" />}
                      <div className="variant-meta">
                        <strong>{variant.rank ? `#${variant.rank}` : '--'}</strong>
                        <span title={variant.label}>{variant.label}</span>
                        {variant.summary && <small className="variant-summary">{variant.summary}</small>}
                        {variant.error ? (
                          <small className="row-error">{variant.error}</small>
                        ) : (
                          <span>
                            {variant.score !== null ? `${variant.score.toFixed(2)} / 10` : '--'}
                            {variant.delta !== null && (
                              <em className={variant.delta >= 0 ? 'up' : 'down'}>
                                {variant.delta >= 0 ? '+' : ''}
                                {variant.delta.toFixed(2)}
                              </em>
                            )}
                          </span>
                        )}
                      </div>
                      <TripletSwatchRow colors={variant.colors} compact />
                      <TripletFeatureBars features={variant.features} />
                    </button>
                  ))}
                </div>
              </>
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

function TripletSwatchRow({ colors, compact = false }: { colors: ColorSwatch[]; compact?: boolean }) {
  if (colors.length === 0) {
    return null;
  }

  return (
    <div className={compact ? 'triplet-swatch-row compact' : 'triplet-swatch-row'}>
      {colors.map((color) => (
        <span key={color.id} className="triplet-swatch">
          <i style={{ backgroundColor: color.hex }} />
          <span>
            {color.label}
            <small>{formatRgb(color.rgb)}</small>
          </span>
        </span>
      ))}
    </div>
  );
}

function TripletFeaturePanel({
  features,
  tags,
  summary
}: {
  features: ColorTripletFeatures | null;
  tags: string[];
  summary: string | null;
}) {
  if (!features) {
    return null;
  }

  return (
    <div className="triplet-feature-panel">
      {summary && <p className="triplet-summary">{summary}</p>}
      <div className="triplet-feature-grid">
        <span>
          <b>Contrast</b>
          {features.luminanceContrast.toFixed(2)}
        </span>
        <span>
          <b>Brightness</b>
          {features.meanLuminance.toFixed(2)}
        </span>
        <span>
          <b>Saturation</b>
          {features.saturationMean.toFixed(2)}
        </span>
        <span>
          <b>Warmth</b>
          {features.warmthMean.toFixed(2)}
        </span>
        <span>
          <b>Hue spread</b>
          {features.hueSpread.toFixed(2)}
        </span>
        <span>
          <b>RGB dist</b>
          {features.rgbDistance.toFixed(2)}
        </span>
      </div>
      <div className="triplet-band-bars" aria-label="band luminance">
        <BandBar label="L" value={features.leftLuminance} />
        <BandBar label="M" value={features.middleLuminance} />
        <BandBar label="R" value={features.rightLuminance} />
      </div>
      <div className="triplet-tags">
        {tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    </div>
  );
}

function TripletFeatureBars({ features }: { features: ColorTripletFeatures | null }) {
  if (!features) {
    return null;
  }

  return (
    <div className="triplet-bars">
      <BandBar label="L" value={features.leftLuminance} compact />
      <BandBar label="M" value={features.middleLuminance} compact />
      <BandBar label="R" value={features.rightLuminance} compact />
      <div className="triplet-chipline">
        <span title="Contrast">
          C {features.luminanceContrast.toFixed(2)}
        </span>
        <span title="Saturation">
          S {features.saturationMean.toFixed(2)}
        </span>
        <span title="Warmth">
          W {features.warmthMean.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function BandBar({ label, value, compact = false }: { label: string; value: number; compact?: boolean }) {
  return (
    <div className={compact ? 'band-bar compact' : 'band-bar'}>
      <span>{label}</span>
      <div className="band-track">
        <i style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <small>{value.toFixed(2)}</small>
    </div>
  );
}

function formatRgb(rgb: number[]): string {
  if (rgb.length !== 3) {
    return 'RGB(--)';
  }
  return `RGB(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
