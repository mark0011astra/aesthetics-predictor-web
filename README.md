# Aesthetics Predictor Web App

ローカルで画像の美的スコアを推定し、複数画像をスコア順に並び替えたり、色変更バリエーションを比較したりする実験用Webアプリです。

## Aesthetics Predictor が返すもの

このアプリでは、Aesthetics Predictor を「画像から抽出した CLIP 埋め込みをもとに、人間評価に近い美的スコアを返すモデル」として扱います。値が高いほど、モデルが学習した平均的な嗜好に照らして美的と推定されます。

LAION 系スコアは元モデルの `0-10` を `0-5` に換算して扱います。別 CLIP 系の `rsinema/aesthetic-scorer` が利用できる場合は、次の個別項目も `0-5` で返します。

- `overall`
- `quality`
- `composition`
- `lighting`
- `color`
- `depthOfField`
- `content`

ランキングは、LAION 換算点と各個別項目の平均である `total` を標準にしています。加えて、ばらつきが大きい画像を少し下げる `balanced`、低い項目を強く反映する調和平均 `harmonic` でも並び替えできます。UI の「並び替え」から、合計点、数学的指標、各個別項目を切り替えられます。

これは絶対的な美しさの判定ではありません。文化、用途、個人の好み、画像ジャンルによって評価は変わるため、UIではスコアと順位を主役にし、しきい値以上の場合だけ補助的に「美しい」ラベルを出します。

## 構成

- `backend/`: FastAPI API。画像検証、スコアリング、ランキング、色変更探索を担当します。
- `frontend/`: Vite + React + TypeScript UI。アップロード、進捗、ランキング、しきい値、色探索グリッドを提供します。

## セットアップ

### Backend

Python 3.12 を推奨します。Python 3.13 では PyTorch 系依存が不安定な場合があります。

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

### Frontend

```bash
cd frontend
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。

## テスト

```bash
cd backend
pytest
```

```bash
cd frontend
npm test
npm run build
```

## License

MIT License. See [LICENSE](./LICENSE).
