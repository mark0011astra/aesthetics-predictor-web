export type ImageScore = {
  id: string;
  filename: string;
  score: number | null;
  metrics: Record<string, number | null>;
  rank: number | null;
  isBeautiful: boolean | null;
  width: number | null;
  height: number | null;
  error: string | null;
};

export type ScoreResponse = {
  threshold: number;
  results: ImageScore[];
};

export type ColorVariant = {
  id: string;
  label: string;
  score: number | null;
  delta: number | null;
  rank: number | null;
  preview: string | null;
  error: string | null;
};

export type ColorExploreResponse = {
  filename: string;
  baseScore: number | null;
  threshold: number;
  variants: ColorVariant[];
};
