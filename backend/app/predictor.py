from functools import lru_cache
from pathlib import Path

from PIL import Image


class PredictorUnavailableError(RuntimeError):
    pass


class _AestheticMLP:
    def __init__(self, torch_module: object) -> None:
        self._torch = torch_module
        self.layers = torch_module.nn.Sequential(
            torch_module.nn.Linear(768, 1024),
            torch_module.nn.Dropout(0.2),
            torch_module.nn.Linear(1024, 128),
            torch_module.nn.Dropout(0.2),
            torch_module.nn.Linear(128, 64),
            torch_module.nn.Dropout(0.1),
            torch_module.nn.Linear(64, 16),
            torch_module.nn.Linear(16, 1),
        )

    def __call__(self, tensor: object) -> object:
        return self.layers(tensor)

    def load_state_dict(self, state: object) -> object:
        return self.layers.load_state_dict(
            {
                key.removeprefix("layers."): value
                for key, value in state.items()
            }
        )

    def to(self, device: str) -> "_AestheticMLP":
        self.layers.to(device)
        return self

    def eval(self) -> "_AestheticMLP":
        self.layers.eval()
        return self


class AestheticPredictor:
    def __init__(self) -> None:
        try:
            import torch
            import open_clip
            from huggingface_hub import hf_hub_download
        except ImportError as exc:
            raise PredictorUnavailableError(
                "Aesthetics Predictor dependencies are not installed. Run `pip install -r backend/requirements.txt`."
            ) from exc

        self.torch = torch
        self.device = self._select_device(torch)
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            "ViT-L-14", pretrained="openai", device=self.device
        )
        self.model.eval()

        weights_path = hf_hub_download(
            repo_id="trl-lib/ddpo-aesthetic-predictor",
            filename="aesthetic-model.pth",
            cache_dir=str(Path.home() / ".cache" / "aesthetics-predictor"),
        )
        self.mlp = _AestheticMLP(torch)
        state = torch.load(weights_path, map_location=self.device)
        self.mlp.load_state_dict(state)
        self.mlp.to(self.device)
        self.mlp.eval()

    def score(self, image: Image.Image) -> float:
        return self.score_batch([image])[0]

    def score_batch(self, images: list[Image.Image]) -> list[float]:
        with self.torch.no_grad():
            tensors = [self.preprocess(image) for image in images]
            batch = self.torch.stack(tensors).to(self.device)
            features = self.model.encode_image(batch)
            features = features / features.norm(dim=-1, keepdim=True)
            raw = self.mlp(features).squeeze(-1)
            return [float(max(0, min(10, value.item()))) for value in raw]

    @staticmethod
    def _select_device(torch_module: object) -> str:
        if getattr(torch_module.backends, "mps", None) and torch_module.backends.mps.is_available():
            return "mps"
        if torch_module.cuda.is_available():
            return "cuda"
        return "cpu"


@lru_cache(maxsize=1)
def get_predictor() -> AestheticPredictor:
    return AestheticPredictor()
