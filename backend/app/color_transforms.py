from dataclasses import dataclass
from io import BytesIO
import base64

from PIL import Image, ImageEnhance, ImageOps


@dataclass(frozen=True)
class ColorPreset:
    id: str
    label: str
    kind: str
    amount: float


PRESETS: tuple[ColorPreset, ...] = (
    ColorPreset("original", "Original", "original", 0),
    ColorPreset("brightness-075", "Brightness 0.75", "brightness", 0.75),
    ColorPreset("brightness-085", "Brightness 0.85", "brightness", 0.85),
    ColorPreset("brightness-095", "Brightness 0.95", "brightness", 0.95),
    ColorPreset("brightness-105", "Brightness 1.05", "brightness", 1.05),
    ColorPreset("brightness-115", "Brightness 1.15", "brightness", 1.15),
    ColorPreset("brightness-130", "Brightness 1.30", "brightness", 1.30),
    ColorPreset("saturation-060", "Saturation 0.60", "saturation", 0.60),
    ColorPreset("saturation-080", "Saturation 0.80", "saturation", 0.80),
    ColorPreset("saturation-120", "Saturation 1.20", "saturation", 1.20),
    ColorPreset("saturation-140", "Saturation 1.40", "saturation", 1.40),
    ColorPreset("contrast-085", "Contrast 0.85", "contrast", 0.85),
    ColorPreset("contrast-115", "Contrast 1.15", "contrast", 1.15),
    ColorPreset("contrast-130", "Contrast 1.30", "contrast", 1.30),
    ColorPreset("cool-085", "Cool 0.85", "temperature", 0.85),
    ColorPreset("cool-095", "Cool 0.95", "temperature", 0.95),
    ColorPreset("warm-105", "Warm 1.05", "temperature", 1.05),
    ColorPreset("warm-115", "Warm 1.15", "temperature", 1.15),
    ColorPreset("hue-minus-30", "Hue -30", "hue", -30),
    ColorPreset("hue-minus-15", "Hue -15", "hue", -15),
    ColorPreset("hue-plus-15", "Hue +15", "hue", 15),
    ColorPreset("hue-plus-30", "Hue +30", "hue", 30),
    ColorPreset("grayscale", "Grayscale", "grayscale", 0),
)


def refine_presets(top_presets: list[ColorPreset]) -> list[ColorPreset]:
    refinements: list[ColorPreset] = []
    for preset in top_presets:
        if preset.kind in {"original", "grayscale"}:
            continue
        if preset.kind == "hue":
            amounts = [preset.amount - 10, preset.amount - 5, preset.amount + 5, preset.amount + 10]
        else:
            amounts = [preset.amount - 0.08, preset.amount - 0.04, preset.amount + 0.04, preset.amount + 0.08]
        for amount in amounts:
            if preset.kind != "hue" and amount <= 0:
                continue
            normalized = int(round(amount * 100)) if preset.kind != "hue" else int(amount)
            sign = "plus" if normalized >= 0 else "minus"
            label_amount = f"{amount:.2f}" if preset.kind != "hue" else f"{amount:+.0f}"
            refinements.append(
                ColorPreset(
                    id=f"refine-{preset.kind}-{sign}-{abs(normalized)}",
                    label=f"Refine {preset.kind} {label_amount}",
                    kind=preset.kind,
                    amount=amount,
                )
            )
    return dedupe_presets(refinements)


def dedupe_presets(presets: list[ColorPreset] | tuple[ColorPreset, ...]) -> list[ColorPreset]:
    seen: set[tuple[str, float]] = set()
    deduped: list[ColorPreset] = []
    for preset in presets:
        key = (preset.kind, round(preset.amount, 4))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(preset)
    return deduped


def apply_preset(image: Image.Image, preset: ColorPreset) -> Image.Image:
    rgb = image.convert("RGB")
    if preset.kind == "original":
        return rgb.copy()
    if preset.kind == "brightness":
        return ImageEnhance.Brightness(rgb).enhance(preset.amount)
    if preset.kind == "saturation":
        return ImageEnhance.Color(rgb).enhance(preset.amount)
    if preset.kind == "contrast":
        return ImageEnhance.Contrast(rgb).enhance(preset.amount)
    if preset.kind == "temperature":
        return adjust_temperature(rgb, preset.amount)
    if preset.kind == "hue":
        return shift_hue(rgb, int(preset.amount))
    if preset.kind == "grayscale":
        return ImageOps.grayscale(rgb).convert("RGB")
    return rgb.copy()


def adjust_temperature(image: Image.Image, amount: float) -> Image.Image:
    red, green, blue = image.split()
    if amount >= 1:
        red = red.point(lambda value: min(255, int(value * amount)))
        blue = blue.point(lambda value: max(0, int(value / amount)))
    else:
        inverse = 1 / amount
        blue = blue.point(lambda value: min(255, int(value * inverse)))
        red = red.point(lambda value: max(0, int(value / inverse)))
    return Image.merge("RGB", (red, green, blue))


def shift_hue(image: Image.Image, degrees: int) -> Image.Image:
    hsv = image.convert("HSV")
    hue, saturation, value = hsv.split()
    offset = int(degrees / 360 * 255)
    hue = hue.point(lambda pixel: (pixel + offset) % 256)
    return Image.merge("HSV", (hue, saturation, value)).convert("RGB")


def preview_data_url(image: Image.Image, max_size: int = 360) -> str:
    preview = image.copy()
    preview.thumbnail((max_size, max_size))
    buffer = BytesIO()
    preview.save(buffer, format="WEBP", quality=86)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{encoded}"
