from io import BytesIO
from PIL import Image, UnidentifiedImageError


SUPPORTED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP", "MPO"}


class ImageValidationError(ValueError):
    pass


def validate_file_count(count: int) -> None:
    if count < 1:
        raise ImageValidationError("At least one image is required.")


def load_image_bytes(data: bytes, content_type: str | None = None) -> Image.Image:
    try:
        image = Image.open(BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ImageValidationError("Invalid image file.") from exc

    if image.format not in SUPPORTED_FORMATS and content_type not in SUPPORTED_CONTENT_TYPES:
        detected = image.format or "unknown"
        raise ImageValidationError(f"Unsupported image type ({detected}). Use JPEG, PNG, or WebP.")

    return image.convert("RGB")
