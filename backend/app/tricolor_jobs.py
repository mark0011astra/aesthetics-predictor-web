from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock, Thread
from uuid import uuid4

from app.contracts import (
    ColorSwatch,
    ColorTripletExploreResponse,
    ColorTripletFeatures,
    ColorTripletSpectrum,
    ColorTripletVariant,
)
from app.predictor import PredictorUnavailableError, get_predictor
from app.tricolor_search import RGB_TRIPLET_PALETTE, TripletCandidate, explore_triplets, triplet_preview

_job_lock = Lock()
_jobs: dict[str, "TripletJobState"] = {}


@dataclass
class TripletJobState:
    job_id: str
    limit: int
    size: int = 1000
    status: str = "queued"
    total_combinations: int = len(RGB_TRIPLET_PALETTE) ** 3
    completed_combinations: int = 0
    current: str | None = None
    best_score: float | None = None
    variants: list[ColorTripletVariant] = field(default_factory=list)
    error: str | None = None
    device: str | None = None


def start_triplet_job(limit: int = 24, size: int = 1000) -> ColorTripletExploreResponse:
    job_id = uuid4().hex
    state = TripletJobState(job_id=job_id, limit=max(1, limit), size=size)
    with _job_lock:
        _jobs[job_id] = state
    Thread(target=_run_triplet_job, args=(job_id,), daemon=True).start()
    return _to_response(state)


def cancel_triplet_job(job_id: str) -> ColorTripletExploreResponse | None:
    state = _get_state(job_id)
    if state is None:
        return None
    _update_state(job_id, status="cancelled")
    return _to_response(_get_state(job_id) or state)


def get_triplet_job(job_id: str) -> ColorTripletExploreResponse | None:
    with _job_lock:
        state = _jobs.get(job_id)
        if state is None:
            return None
        return _to_response(state)


def _run_triplet_job(job_id: str) -> None:
    state = _get_state(job_id)
    if state is None:
        return

    _update_state(job_id, status="running", error=None)
    try:
        predictor = get_predictor()
        _update_state(job_id, device=getattr(predictor, "device", "cpu"))

        total, candidates = explore_triplets(
            predictor,
            limit=state.limit,
            size=state.size,
            palette=RGB_TRIPLET_PALETTE,
            progress_callback=lambda completed, total_count, current, best_score: _update_state(
                job_id,
                completed_combinations=completed,
                current=current,
                best_score=best_score,
            ),
        )
        variants = [_variant_from_candidate(candidate, index) for index, candidate in enumerate(candidates, start=1)]
        best_score = variants[0].score if variants else None
        _update_state(
            job_id,
            status="done",
            total_combinations=total,
            completed_combinations=total,
            best_score=best_score,
            current=None,
            variants=variants,
        )
    except (PredictorUnavailableError, RuntimeError) as exc:
        _update_state(job_id, status="error", error=str(exc))
    except Exception as exc:  # pragma: no cover - defensive guard for background thread
        _update_state(job_id, status="error", error=f"Triplet exploration failed: {exc}")


def _variant_from_candidate(candidate: TripletCandidate, rank: int) -> ColorTripletVariant:
    colors = [
        _swatch_from_def(candidate.left),
        _swatch_from_def(candidate.middle),
        _swatch_from_def(candidate.right),
    ]
    features = ColorTripletFeatures(
        leftLuminance=candidate.features.left_luminance,
        middleLuminance=candidate.features.middle_luminance,
        rightLuminance=candidate.features.right_luminance,
        meanLuminance=candidate.features.mean_luminance,
        luminanceContrast=candidate.features.luminance_contrast,
        saturationMean=candidate.features.saturation_mean,
        saturationRange=candidate.features.saturation_range,
        warmthMean=candidate.features.warmth_mean,
        hueSpread=candidate.features.hue_spread,
        rgbDistance=candidate.features.rgb_distance,
    )
    return ColorTripletVariant(
        id=f"triplet-{candidate.left.id}-{candidate.middle.id}-{candidate.right.id}",
        label=f"{candidate.left.label} / {candidate.middle.label} / {candidate.right.label}",
        score=candidate.score,
        delta=None,
        rank=rank,
        preview=triplet_preview(candidate, size=1000),
        colors=colors,
        features=features,
        tags=list(candidate.tags),
        summary=" / ".join(candidate.tags),
    )


def _swatch_from_def(swatch: object) -> ColorSwatch:
    return ColorSwatch(
        id=swatch.id,
        label=swatch.label,
        hex=swatch.hex,
        rgb=list(swatch.rgb),
        luminance=swatch.luminance,
        saturation=swatch.saturation,
        warmth=swatch.warmth,
    )


def _get_state(job_id: str) -> TripletJobState | None:
    with _job_lock:
        return _jobs.get(job_id)


def _update_state(job_id: str, **changes: object) -> None:
    with _job_lock:
        state = _jobs.get(job_id)
        if state is None:
            return
        for key, value in changes.items():
            setattr(state, key, value)


def _to_response(state: TripletJobState) -> ColorTripletExploreResponse:
    palette = [_swatch_from_def(swatch) for swatch in RGB_TRIPLET_PALETTE]
    return ColorTripletExploreResponse(
        jobId=state.job_id,
        status=state.status,
        canvasSize=state.size,
        palette=palette,
        totalCombinations=state.total_combinations,
        completedCombinations=state.completed_combinations,
        limit=state.limit,
        bestScore=state.best_score,
        current=state.current,
        device=state.device,
        variants=list(state.variants),
        error=state.error,
    )
