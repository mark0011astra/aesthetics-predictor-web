from dataclasses import replace
from typing import Protocol

from PIL import Image

from app.contracts import ImageScore


class Predictor(Protocol):
    def score(self, image: Image.Image) -> float:
        ...


def beautiful_label(score: float | None, threshold: float) -> bool | None:
    if score is None:
        return None
    return score >= threshold


def rank_scores(results: list[ImageScore], threshold: float) -> list[ImageScore]:
    successful = sorted(
        [item for item in results if item.score is not None and item.error is None],
        key=lambda item: item.score or 0,
        reverse=True,
    )
    ranked_by_id = {
        item.id: replace_model(item, rank=index, isBeautiful=beautiful_label(item.score, threshold))
        for index, item in enumerate(successful, start=1)
    }
    failed = [
        replace_model(item, rank=None, isBeautiful=None)
        for item in results
        if item.score is None or item.error is not None
    ]
    return list(ranked_by_id.values()) + failed


def replace_model(item: ImageScore, **updates: object) -> ImageScore:
    return item.model_copy(update=updates)

