from dataclasses import dataclass
from itertools import product
import colorsys
from math import sqrt
from typing import Callable

from PIL import Image, ImageColor

from app.color_transforms import preview_data_url


@dataclass(frozen=True)
class ColorSwatchDef:
    id: str
    label: str
    hex: str
    rgb: tuple[int, int, int]
    luminance: float
    saturation: float
    warmth: float
    hue: float


@dataclass(frozen=True)
class TripletFeatures:
    left_luminance: float
    middle_luminance: float
    right_luminance: float
    mean_luminance: float
    luminance_contrast: float
    saturation_mean: float
    saturation_range: float
    warmth_mean: float
    hue_spread: float
    rgb_distance: float


@dataclass(frozen=True)
class TripletCandidate:
    left: ColorSwatchDef
    middle: ColorSwatchDef
    right: ColorSwatchDef
    score: float
    features: TripletFeatures
    tags: tuple[str, ...]


def _relative_luminance(rgb: tuple[int, int, int]) -> float:
    red, green, blue = (channel / 255 for channel in rgb)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _rgb_to_hsv(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    red, green, blue = (channel / 255 for channel in rgb)
    return colorsys.rgb_to_hsv(red, green, blue)


def _warmth(rgb: tuple[int, int, int]) -> float:
    red, blue = rgb[0], rgb[2]
    return max(-1.0, min(1.0, (red - blue) / 255.0))


def _build_swatch(identifier: str, label: str, hex_value: str) -> ColorSwatchDef:
    rgb = ImageColor.getrgb(hex_value)
    hue, saturation, _ = _rgb_to_hsv(rgb)
    return ColorSwatchDef(
        id=identifier,
        label=label,
        hex=hex_value,
        rgb=rgb,
        luminance=_relative_luminance(rgb),
        saturation=saturation,
        warmth=_warmth(rgb),
        hue=hue,
    )


RGB_TRIPLET_PALETTE: tuple[ColorSwatchDef, ...] = (
    _build_swatch("ink", "Ink", "#101418"),
    _build_swatch("charcoal", "Charcoal", "#26313d"),
    _build_swatch("ivory", "Ivory", "#f1ede3"),
    _build_swatch("stone", "Stone", "#8f9498"),
    _build_swatch("red", "Red", "#d94b4b"),
    _build_swatch("orange", "Orange", "#d98b45"),
    _build_swatch("gold", "Gold", "#d4b24a"),
    _build_swatch("green", "Green", "#4c9b64"),
    _build_swatch("teal", "Teal", "#2f7f7a"),
    _build_swatch("cyan", "Cyan", "#3da9c7"),
    _build_swatch("blue", "Blue", "#4c6fd8"),
    _build_swatch("indigo", "Indigo", "#6e54d8"),
    _build_swatch("rose", "Rose", "#dd6a93"),
)


def build_triplet_image(
    colors: tuple[ColorSwatchDef, ColorSwatchDef, ColorSwatchDef],
    size: int = 1000,
) -> Image.Image:
    image = Image.new("RGB", (size, size))
    band_widths = [size // 3, size // 3, size - 2 * (size // 3)]
    x = 0
    for swatch, band_width in zip(colors, band_widths):
        band = Image.new("RGB", (band_width, size), ImageColor.getrgb(swatch.hex))
        image.paste(band, (x, 0))
        x += band_width
    return image


def _score_images(predictor: object, images: list[Image.Image]) -> list[float]:
    if hasattr(predictor, "score_batch"):
        return [float(score) for score in predictor.score_batch(images)]
    return [float(predictor.score(image)) for image in images]


def _circular_distance(left: float, right: float) -> float:
    delta = abs(left - right)
    return min(delta, 1 - delta)


def _rgb_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    distance = sqrt(sum((left[index] - right[index]) ** 2 for index in range(3)))
    return distance / (sqrt(3) * 255)


def _triplet_features(colors: tuple[ColorSwatchDef, ColorSwatchDef, ColorSwatchDef]) -> TripletFeatures:
    swatches = list(colors)
    luminances = [swatch.luminance for swatch in swatches]
    saturations = [swatch.saturation for swatch in swatches]
    warmths = [swatch.warmth for swatch in swatches]
    hues = [swatch.hue for swatch in swatches]
    pairwise = [
        _rgb_distance(left.rgb, right.rgb)
        for index, left in enumerate(swatches)
        for right in swatches[index + 1 :]
    ]
    hue_spread = max(
        (_circular_distance(left, right) for index, left in enumerate(hues) for right in hues[index + 1 :]),
        default=0.0,
    )
    return TripletFeatures(
        left_luminance=luminances[0],
        middle_luminance=luminances[1],
        right_luminance=luminances[2],
        mean_luminance=sum(luminances) / 3,
        luminance_contrast=max(luminances) - min(luminances),
        saturation_mean=sum(saturations) / 3,
        saturation_range=max(saturations) - min(saturations),
        warmth_mean=sum(warmths) / 3,
        hue_spread=hue_spread,
        rgb_distance=sum(pairwise) / len(pairwise) if pairwise else 0.0,
    )


def _triplet_tags(features: TripletFeatures) -> tuple[str, ...]:
    tags: list[str] = []
    if features.luminance_contrast >= 0.45:
        tags.append("High contrast")
    elif features.luminance_contrast <= 0.16:
        tags.append("Low contrast")
    else:
        tags.append("Balanced contrast")

    if features.saturation_mean >= 0.62:
        tags.append("Vivid")
    elif features.saturation_mean <= 0.22:
        tags.append("Muted")
    else:
        tags.append("Moderate saturation")

    if features.warmth_mean >= 0.12:
        tags.append("Warm")
    elif features.warmth_mean <= -0.12:
        tags.append("Cool")
    else:
        tags.append("Neutral temperature")

    if features.hue_spread <= 0.18:
        tags.append("Analogous")
    elif features.hue_spread >= 0.48:
        tags.append("Wide hue spread")
    else:
        tags.append("Moderate hue spread")
    return tuple(tags[:4])


def _make_candidate(
    colors: tuple[ColorSwatchDef, ColorSwatchDef, ColorSwatchDef],
    score: float,
) -> TripletCandidate:
    features = _triplet_features(colors)
    return TripletCandidate(
        left=colors[0],
        middle=colors[1],
        right=colors[2],
        score=score,
        features=features,
        tags=_triplet_tags(features),
    )


def explore_triplets(
    predictor: object,
    *,
    limit: int = 24,
    size: int = 1000,
    batch_size: int = 48,
    palette: tuple[ColorSwatchDef, ...] = RGB_TRIPLET_PALETTE,
    progress_callback: Callable[[int, int, str, float | None], None] | None = None,
) -> tuple[int, list[TripletCandidate]]:
    candidates: list[TripletCandidate] = []
    batch_colors: list[tuple[ColorSwatchDef, ColorSwatchDef, ColorSwatchDef]] = []
    batch_images: list[Image.Image] = []
    completed = 0
    best_score: float | None = None

    total = len(palette) ** 3
    for left, middle, right in product(palette, repeat=3):
        colors = (left, middle, right)
        batch_colors.append(colors)
        batch_images.append(build_triplet_image(colors, size=size))
        if len(batch_images) < batch_size:
            continue

        scores = _score_images(predictor, batch_images)
        for colors, score in zip(batch_colors, scores):
            candidates.append(_make_candidate(colors, score))
            best_score = score if best_score is None else max(best_score, score)
        completed += len(batch_images)
        if progress_callback is not None:
            progress_callback(completed, total, f"{batch_colors[-1][0].label} / {batch_colors[-1][1].label} / {batch_colors[-1][2].label}", best_score)
        batch_colors = []
        batch_images = []

    if batch_images:
        scores = _score_images(predictor, batch_images)
        for colors, score in zip(batch_colors, scores):
            candidates.append(_make_candidate(colors, score))
            best_score = score if best_score is None else max(best_score, score)
        completed += len(batch_images)
        if progress_callback is not None and batch_colors:
            progress_callback(completed, total, f"{batch_colors[-1][0].label} / {batch_colors[-1][1].label} / {batch_colors[-1][2].label}", best_score)

    candidates.sort(key=lambda item: item.score, reverse=True)
    return total, candidates[: max(1, min(limit, total))]


def triplet_preview(candidate: TripletCandidate, *, size: int = 1000) -> str:
    image = build_triplet_image((candidate.left, candidate.middle, candidate.right), size=size)
    return preview_data_url(image)
