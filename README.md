# Aesthetics Predictor Web App

ローカルで画像の美的スコアを推定し、複数画像をスコア順に並び替えたり、色変更バリエーションを比較したりする実験用Webアプリです。

This is a local experimental web app for estimating image aesthetics, ranking multiple images by score, and comparing color-adjusted variants.

## Aesthetics Predictor が返すもの / What the Predictor Returns

このアプリでは、Aesthetics Predictor を「画像から抽出した CLIP 埋め込みをもとに、人間評価に近い美的スコアを返すモデル」として扱います。値が高いほど、モデルが学習した平均的な嗜好に照らして美的と推定されます。

In this app, Aesthetics Predictor is treated as a model that returns a human-like aesthetic score based on CLIP embeddings extracted from the image. Higher values indicate a stronger match with the model's learned average preferences.

LAION 系スコアは元モデルの `0-10` を `0-5` に換算して扱います。別 CLIP 系の `rsinema/aesthetic-scorer` が利用できる場合は、次の個別項目も `0-5` で返します。

LAION-style scores are converted from the original `0-10` range to `0-5`. If the CLIP-based `rsinema/aesthetic-scorer` model is available, the app also returns these per-metric scores on the same `0-5` scale.

- `overall`
- `quality`
- `composition`
- `lighting`
- `color`
- `depthOfField`
- `content`

ランキングは、LAION 換算点と各個別項目の平均である `total` を標準にしています。加えて、ばらつきが大きい画像を少し下げる `balanced`、低い項目を強く反映する調和平均 `harmonic` でも並び替えできます。UI の「並び替え」から、合計点、数学的指標、各個別項目を切り替えられます。

The default ranking uses `total`, which is the mean of the normalized LAION score and the individual metrics. You can also sort by `balanced`, which slightly penalizes uneven scores, and `harmonic`, which emphasizes weak metrics through the harmonic mean. The UI sort control lets you switch between total score, mathematical indices, and individual metrics.

これは絶対的な美しさの判定ではありません。文化、用途、個人の好み、画像ジャンルによって評価は変わるため、UIではスコアと順位を主役にし、しきい値以上の場合だけ補助的に「美しい」ラベルを出します。

This is not an absolute beauty judgment. Evaluations vary by culture, use case, personal taste, and image category, so the UI centers score and rank, and only shows a supplemental "beautiful" label above the threshold.

## 構成 / Structure

- `backend/`: FastAPI API。画像検証、スコアリング、ランキング、色変更探索を担当します。/ FastAPI API for image validation, scoring, ranking, and color exploration.
- `frontend/`: Vite + React + TypeScript UI。アップロード、進捗、ランキング、しきい値、色探索グリッドを提供します。/ Vite + React + TypeScript UI for uploads, progress, ranking, threshold control, and color exploration grids.

## セットアップ / Setup

### Backend

Python 3.12 を推奨します。Python 3.13 では PyTorch 系依存が不安定な場合があります。

Python 3.12 is recommended. PyTorch-related dependencies can be unstable on Python 3.13.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Windows PowerShell:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

初回推論時に CLIP / aesthetic predictor 関連のモデルファイルをローカルキャッシュへ取得します。モデルが取得できない場合、APIは偽スコアを返さず明示エラーを返します。

On the first inference run, the app downloads the CLIP / aesthetic predictor model files into a local cache. If the model cannot be fetched, the API returns an explicit error instead of a fake score.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。

Open `http://localhost:5173` in your browser.

## テスト / Tests

```bash
cd backend
pytest
```

```bash
cd frontend
npm test
npm run build
```

## License / ライセンス

MIT License. See [LICENSE](./LICENSE).
