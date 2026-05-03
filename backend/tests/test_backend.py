from io import BytesIO

import pytest
from PIL import Image
from fastapi.testclient import TestClient

from app.color_transforms import PRESETS, apply_preset, preview_data_url, refine_presets
from app.image_io import ImageValidationError, load_image_bytes, validate_file_count
from app.multi_scorer import build_metric_scores
from app.ranking import beautiful_label, rank_scores
from app.contracts import ImageScore
from app.main import app


def make_image_bytes(fmt: str = "PNG") -> bytes:
    image = Image.new("RGB", (12, 8), (120, 80, 200))
    buffer = BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def test_load_image_accepts_supported_formats() -> None:
    image = load_image_bytes(make_image_bytes("PNG"), "image/png")
    assert image.size == (12, 8)
    assert image.mode == "RGB"


def test_load_image_sniffs_supported_format_when_browser_mime_is_generic() -> None:
    image = load_image_bytes(make_image_bytes("PNG"), "application/octet-stream")
    assert image.size == (12, 8)
    assert image.mode == "RGB"


def test_load_image_allows_supported_browser_mime_after_decode() -> None:
    image = load_image_bytes(make_image_bytes("PNG"), "image/jpeg")
    assert image.size == (12, 8)
    assert image.mode == "RGB"


def test_load_image_rejects_invalid_bytes() -> None:
    with pytest.raises(ImageValidationError, match="Invalid image"):
        load_image_bytes(b"not an image", "image/png")


def test_validate_file_count_allows_more_than_100_images() -> None:
    validate_file_count(101)
    validate_file_count(1000)


def test_validate_file_count_rejects_empty_batches() -> None:
    with pytest.raises(ImageValidationError, match="At least one image"):
        validate_file_count(0)


def test_rank_scores_orders_successes_and_keeps_failures_last() -> None:
    results = [
        ImageScore(id="a", filename="a.png", score=4.5),
        ImageScore(id="b", filename="b.png", score=8.1),
        ImageScore(id="c", filename="c.png", error="bad"),
    ]

    ranked = rank_scores(results, threshold=6)

    assert [item.id for item in ranked] == ["b", "a", "c"]
    assert [item.rank for item in ranked] == [1, 2, None]
    assert [item.isBeautiful for item in ranked] == [True, False, None]


def test_build_metric_scores_normalizes_laion_and_adds_rank_indices() -> None:
    metrics = build_metric_scores(
        8.0,
        {
            "overall": 3.5,
            "quality": 4.0,
            "composition": 3.0,
            "lighting": 4.5,
            "color": 5.0,
            "depthOfField": 2.5,
            "content": 3.5,
        },
    )

    assert metrics["laion"] == 4.0
    assert metrics["total"] is not None
    assert metrics["balanced"] is not None
    assert metrics["harmonic"] is not None
    assert metrics["harmonic"] <= metrics["total"]


def test_beautiful_label_uses_configurable_threshold() -> None:
    assert beautiful_label(6.0, 6.0) is True
    assert beautiful_label(5.9, 6.0) is False
    assert beautiful_label(None, 6.0) is None


def test_color_presets_create_previewable_variants() -> None:
    image = Image.open(BytesIO(make_image_bytes())).convert("RGB")
    variants = [apply_preset(image, preset) for preset in PRESETS]

    assert len(variants) >= 20
    assert all(variant.size == image.size for variant in variants)
    assert preview_data_url(variants[0]).startswith("data:image/webp;base64,")


def test_refine_presets_expands_top_color_candidates() -> None:
    refinements = refine_presets([PRESETS[1], PRESETS[8], PRESETS[18]])

    assert len(refinements) >= 10
    assert all(preset.id.startswith("refine-") for preset in refinements)


def test_score_endpoint_returns_explicit_predictor_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def unavailable() -> object:
        raise RuntimeError("model unavailable")

    monkeypatch.setattr("app.main.get_predictor", unavailable)
    client = TestClient(app)

    response = client.post(
        "/api/score",
        files=[("files", ("sample.png", make_image_bytes("PNG"), "image/png"))],
        data={"threshold": "6.0"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["results"][0]["score"] is None
    assert payload["results"][0]["error"] == "model unavailable"


def test_score_endpoint_returns_combined_and_individual_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    class StubPredictor:
        def score(self, image: Image.Image) -> float:
            return 8.0

    class StubParaScorer:
        def score(self, image: Image.Image) -> dict[str, float]:
            return {
                "overall": 3.5,
                "quality": 4.0,
                "composition": 3.0,
                "lighting": 4.5,
                "color": 5.0,
                "depthOfField": 2.5,
                "content": 3.5,
            }

    monkeypatch.setattr("app.main.get_predictor", lambda: StubPredictor())
    monkeypatch.setattr("app.main.get_para_scorer", lambda: StubParaScorer())
    client = TestClient(app)

    response = client.post(
        "/api/score",
        files=[("files", ("sample.png", make_image_bytes("PNG"), "image/png"))],
        data={"threshold": "6.0"},
    )

    assert response.status_code == 200
    metrics = response.json()["results"][0]["metrics"]
    assert metrics["laion"] == 4.0
    assert metrics["overall"] == 3.5
    assert metrics["total"] is not None
    assert metrics["balanced"] is not None
    assert metrics["harmonic"] is not None
