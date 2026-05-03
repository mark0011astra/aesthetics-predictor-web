from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.color_transforms import PRESETS, apply_preset, preview_data_url, refine_presets
from app.contracts import ColorExploreResponse, ColorVariant, ImageScore, ScoreResponse
from app.image_io import ImageValidationError, load_image_bytes, validate_file_count
from app.multi_scorer import build_metric_scores, get_para_scorer, ParaAestheticScorer
from app.predictor import AestheticPredictor, PredictorUnavailableError, get_predictor
from app.ranking import beautiful_label, rank_scores


app = FastAPI(title="Aesthetics Predictor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/score", response_model=ScoreResponse)
async def score_images(
    files: list[UploadFile] = File(...),
    threshold: float = Form(6.0),
) -> ScoreResponse:
    try:
        validate_file_count(len(files))
    except ImageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    predictor: AestheticPredictor | None
    predictor_error: str | None = None
    try:
        predictor = get_predictor()
    except (PredictorUnavailableError, RuntimeError) as exc:
        predictor = None
        predictor_error = str(exc)
    para_scorer: ParaAestheticScorer | None
    try:
        para_scorer = get_para_scorer()
    except Exception as exc:
        para_scorer = None
        if predictor_error is None:
            predictor_error = str(exc)

    results: list[ImageScore] = []
    for index, file in enumerate(files):
        image_id = f"image-{index}"
        try:
            data = await file.read()
            image = load_image_bytes(data, file.content_type)
            if predictor is None:
                raise PredictorUnavailableError(predictor_error or "Aesthetics Predictor is unavailable.")
            score = predictor.score(image)
            try:
                para_scores = para_scorer.score(image) if para_scorer is not None else None
            except Exception:
                para_scores = None
            results.append(
                ImageScore(
                    id=image_id,
                    filename=file.filename or image_id,
                    score=score,
                    metrics=build_metric_scores(score, para_scores),
                    width=image.width,
                    height=image.height,
                    isBeautiful=beautiful_label(score, threshold),
                )
            )
        except (ImageValidationError, PredictorUnavailableError, RuntimeError) as exc:
            results.append(ImageScore(id=image_id, filename=file.filename or image_id, error=str(exc)))

    return ScoreResponse(threshold=threshold, results=rank_scores(results, threshold))


@app.post("/api/color-explore", response_model=ColorExploreResponse)
async def color_explore(
    file: UploadFile = File(...),
    threshold: float = Form(6.0),
) -> ColorExploreResponse:
    try:
        data = await file.read()
        image = load_image_bytes(data, file.content_type)
    except ImageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    predictor: AestheticPredictor | None
    predictor_error: str | None = None
    try:
        predictor = get_predictor()
    except (PredictorUnavailableError, RuntimeError) as exc:
        predictor = None
        predictor_error = str(exc)

    variants: list[ColorVariant] = []
    base_score: float | None = None
    for preset in PRESETS:
        transformed = apply_preset(image, preset)
        try:
            if predictor is None:
                raise PredictorUnavailableError(predictor_error or "Aesthetics Predictor is unavailable.")
            score = predictor.score(transformed)
            if preset.id == "original":
                base_score = score
            variants.append(
                ColorVariant(
                    id=preset.id,
                    label=preset.label,
                    score=score,
                    delta=None,
                    preview=preview_data_url(transformed),
                )
            )
        except (PredictorUnavailableError, RuntimeError) as exc:
            variants.append(ColorVariant(id=preset.id, label=preset.label, error=str(exc)))

    successful = sorted(
        [variant for variant in variants if variant.score is not None and variant.error is None],
        key=lambda variant: variant.score or 0,
        reverse=True,
    )
    scored_presets = {variant.id: preset for variant, preset in zip(variants, PRESETS)}
    refinement_presets = refine_presets(
        [scored_presets[variant.id] for variant in successful if variant.id in scored_presets][:3]
    )
    existing_ids = {variant.id for variant in variants}
    for preset in refinement_presets:
        if preset.id in existing_ids:
            continue
        transformed = apply_preset(image, preset)
        try:
            if predictor is None:
                raise PredictorUnavailableError(predictor_error or "Aesthetics Predictor is unavailable.")
            score = predictor.score(transformed)
            variants.append(
                ColorVariant(
                    id=preset.id,
                    label=preset.label,
                    score=score,
                    delta=None,
                    preview=preview_data_url(transformed),
                )
            )
        except (PredictorUnavailableError, RuntimeError) as exc:
            variants.append(ColorVariant(id=preset.id, label=preset.label, error=str(exc)))

    successful = sorted(
        [variant for variant in variants if variant.score is not None and variant.error is None],
        key=lambda variant: variant.score or 0,
        reverse=True,
    )
    ranked = {
        variant.id: variant.model_copy(
            update={
                "rank": index,
                "delta": None if base_score is None or variant.score is None else variant.score - base_score,
            }
        )
        for index, variant in enumerate(successful, start=1)
    }
    ordered = list(ranked.values()) + [variant for variant in variants if variant.id not in ranked]
    return ColorExploreResponse(
        filename=file.filename or "image",
        baseScore=base_score,
        threshold=threshold,
        variants=ordered,
    )
