from pydantic import BaseModel, Field


class ImageScore(BaseModel):
    id: str
    filename: str
    score: float | None = Field(default=None, ge=0, le=10)
    metrics: dict[str, float | None] = Field(default_factory=dict)
    rank: int | None = Field(default=None, ge=1)
    isBeautiful: bool | None = None
    width: int | None = Field(default=None, ge=1)
    height: int | None = Field(default=None, ge=1)
    averageRgb: list[int] | None = None
    error: str | None = None


class ScoreResponse(BaseModel):
    threshold: float
    results: list[ImageScore]


class ColorVariant(BaseModel):
    id: str
    label: str
    score: float | None = Field(default=None, ge=0, le=10)
    delta: float | None = None
    rank: int | None = Field(default=None, ge=1)
    preview: str | None = None
    error: str | None = None


class ColorExploreResponse(BaseModel):
    filename: str
    baseScore: float | None
    threshold: float
    variants: list[ColorVariant]


class ColorSwatch(BaseModel):
    id: str
    label: str
    hex: str
    rgb: list[int] = Field(default_factory=list)
    luminance: float = Field(default=0, ge=0, le=1)
    saturation: float = Field(default=0, ge=0, le=1)
    warmth: float = Field(default=0, ge=-1, le=1)


class ColorTripletFeatures(BaseModel):
    leftLuminance: float = Field(ge=0, le=1)
    middleLuminance: float = Field(ge=0, le=1)
    rightLuminance: float = Field(ge=0, le=1)
    meanLuminance: float = Field(ge=0, le=1)
    luminanceContrast: float = Field(ge=0, le=1)
    saturationMean: float = Field(ge=0, le=1)
    saturationRange: float = Field(ge=0, le=1)
    warmthMean: float = Field(ge=-1, le=1)
    hueSpread: float = Field(ge=0, le=1)
    rgbDistance: float = Field(ge=0, le=1)


class ColorTripletVariant(BaseModel):
    id: str
    label: str
    score: float | None = Field(default=None, ge=0, le=10)
    delta: float | None = None
    rank: int | None = Field(default=None, ge=1)
    preview: str | None = None
    colors: list[ColorSwatch] = Field(default_factory=list)
    features: ColorTripletFeatures | None = None
    tags: list[str] = Field(default_factory=list)
    summary: str | None = None
    error: str | None = None


class ColorSpectrumBin(BaseModel):
    scoreFrom: float | None = None
    scoreTo: float | None = None
    count: int = Field(default=0, ge=0)
    averageRgb: list[int] = Field(default_factory=list)
    averageScore: float | None = None


class ColorTripletSpectrum(BaseModel):
    bins: list[ColorSpectrumBin] = Field(default_factory=list)
    topAverageRgb: list[int] | None = None
    bottomAverageRgb: list[int] | None = None
    goodLabels: list[str] = Field(default_factory=list)
    badLabels: list[str] = Field(default_factory=list)


class ColorTripletExploreResponse(BaseModel):
    jobId: str | None = None
    status: str = Field(default="done")
    canvasSize: int = Field(default=1000, ge=1)
    palette: list[ColorSwatch] = Field(default_factory=list)
    totalCombinations: int = Field(default=0, ge=0)
    completedCombinations: int = Field(default=0, ge=0)
    limit: int = Field(default=24, ge=1)
    bestScore: float | None = Field(default=None, ge=0, le=10)
    current: str | None = None
    device: str | None = None
    spectrum: ColorTripletSpectrum | None = None
    variants: list[ColorTripletVariant] = Field(default_factory=list)
    error: str | None = None
