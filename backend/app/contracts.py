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
