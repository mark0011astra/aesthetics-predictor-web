from functools import lru_cache
from pathlib import Path
from statistics import fmean, pstdev

from PIL import Image

from app.predictor import PredictorUnavailableError


METRIC_KEYS = (
    "laion",
    "overall",
    "quality",
    "composition",
    "lighting",
    "color",
    "depthOfField",
    "content",
)


class MultiMetricScores(dict[str, float | None]):
    pass


def clamp(value: float, lower: float = 0, upper: float = 5) -> float:
    return max(lower, min(upper, value))


def build_metric_scores(
    laion_score: float | None,
    para_scores: dict[str, float] | None = None,
) -> dict[str, float | None]:
    scores: dict[str, float | None] = {
        "laion": None if laion_score is None else clamp(laion_score / 2),
        "overall": None,
        "quality": None,
        "composition": None,
        "lighting": None,
        "color": None,
        "depthOfField": None,
        "content": None,
    }
    if para_scores:
        scores.update({key: clamp(value) for key, value in para_scores.items()})

    values = [value for key, value in scores.items() if key in METRIC_KEYS and value is not None]
    if values:
        total = fmean(values)
        deviation = pstdev(values) if len(values) > 1 else 0
        harmonic = len(values) / sum(1 / max(value, 0.05) for value in values)
        scores["total"] = clamp(total)
        scores["balanced"] = clamp(total - deviation * 0.35)
        scores["harmonic"] = clamp(harmonic)
    else:
        scores["total"] = None
        scores["balanced"] = None
        scores["harmonic"] = None
    return scores


class ParaAestheticScorer:
    def __init__(self) -> None:
        try:
            import torch
            import torch.nn as nn
            from huggingface_hub import hf_hub_download
            from transformers import CLIPImageProcessor, CLIPVisionConfig, CLIPVisionModel
        except ImportError as exc:
            raise PredictorUnavailableError(
                "Multi-metric aesthetic dependencies are not installed. Run `pip install -r backend/requirements.txt`."
            ) from exc

        self.torch = torch
        self.device = self._select_device(torch)
        self.processor = CLIPImageProcessor(
            do_resize=True,
            size={"shortest_edge": 224},
            do_center_crop=True,
            crop_size={"height": 224, "width": 224},
            do_rescale=True,
            rescale_factor=1 / 255,
            do_normalize=True,
            image_mean=[0.48145466, 0.4578275, 0.40821073],
            image_std=[0.26862954, 0.26130258, 0.27577711],
        )
        config = CLIPVisionConfig(
            hidden_size=768,
            intermediate_size=3072,
            num_hidden_layers=12,
            num_attention_heads=12,
            image_size=224,
            patch_size=32,
            projection_dim=512,
        )
        backbone = CLIPVisionModel(config)
        self.model = _AestheticScorer(nn, backbone)
        weights_path = hf_hub_download(
            repo_id="rsinema/aesthetic-scorer",
            filename="model.pt",
            cache_dir=str(Path.home() / ".cache" / "aesthetics-predictor"),
        )
        state = torch.load(weights_path, map_location=self.device, weights_only=True)
        self.model.load_state_dict(state)
        self.model.to(self.device)
        self.model.eval()

    def score(self, image: Image.Image) -> dict[str, float]:
        inputs = self.processor(images=image, return_tensors="pt")
        pixel_values = inputs["pixel_values"].to(self.device)
        with self.torch.no_grad():
            outputs = self.model(pixel_values)
        values = [clamp(float(output.squeeze().item())) for output in outputs]
        return {
            "overall": values[0],
            "quality": values[1],
            "composition": values[2],
            "lighting": values[3],
            "color": values[4],
            "depthOfField": values[5],
            "content": values[6],
        }

    @staticmethod
    def _select_device(torch_module: object) -> str:
        if getattr(torch_module.backends, "mps", None) and torch_module.backends.mps.is_available():
            return "mps"
        if torch_module.cuda.is_available():
            return "cuda"
        return "cpu"


class _AestheticScorer:
    def __init__(self, nn_module: object, backbone: object) -> None:
        self._nn = nn_module
        self._model = _AestheticScorerModule(nn_module, backbone)

    def __call__(self, pixel_values: object) -> object:
        return self._model(pixel_values)

    def load_state_dict(self, state: object) -> object:
        return self._model.load_state_dict(state)

    def to(self, device: str) -> "_AestheticScorer":
        self._model.to(device)
        return self

    def eval(self) -> "_AestheticScorer":
        self._model.eval()
        return self


def _linear_head(nn_module: object, hidden_dim: int) -> object:
    return nn_module.Sequential(nn_module.Linear(hidden_dim, 1))


class _AestheticScorerModule:
    def __new__(cls, nn_module: object, backbone: object) -> object:
        class Model(nn_module.Module):
            def __init__(self) -> None:
                super().__init__()
                self.backbone = backbone
                hidden_dim = backbone.config.hidden_size
                self.aesthetic_head = _linear_head(nn_module, hidden_dim)
                self.quality_head = _linear_head(nn_module, hidden_dim)
                self.composition_head = _linear_head(nn_module, hidden_dim)
                self.light_head = _linear_head(nn_module, hidden_dim)
                self.color_head = _linear_head(nn_module, hidden_dim)
                self.dof_head = _linear_head(nn_module, hidden_dim)
                self.content_head = _linear_head(nn_module, hidden_dim)

            def forward(self, pixel_values: object) -> object:
                features = self.backbone(pixel_values).pooler_output
                return (
                    self.aesthetic_head(features),
                    self.quality_head(features),
                    self.composition_head(features),
                    self.light_head(features),
                    self.color_head(features),
                    self.dof_head(features),
                    self.content_head(features),
                )

        return Model()


@lru_cache(maxsize=1)
def get_para_scorer() -> ParaAestheticScorer:
    return ParaAestheticScorer()
