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

export type ColorSwatch = {
  id: string;
  label: string;
  hex: string;
  rgb: number[];
  luminance: number;
  saturation: number;
  warmth: number;
};

export type ColorTripletVariant = {
  id: string;
  label: string;
  score: number | null;
  delta: number | null;
  rank: number | null;
  preview: string | null;
  colors: ColorSwatch[];
  features: ColorTripletFeatures | null;
  tags: string[];
  summary: string | null;
  error: string | null;
};

export type ColorTripletExploreResponse = {
  jobId: string | null;
  status: string;
  canvasSize: number;
  palette: ColorSwatch[];
  totalCombinations: number;
  completedCombinations: number;
  limit: number;
  bestScore: number | null;
  current: string | null;
  device: string | null;
  variants: ColorTripletVariant[];
  error: string | null;
};

export type ColorTripletFeatures = {
  leftLuminance: number;
  middleLuminance: number;
  rightLuminance: number;
  meanLuminance: number;
  luminanceContrast: number;
  saturationMean: number;
  saturationRange: number;
  warmthMean: number;
  hueSpread: number;
  rgbDistance: number;
};
