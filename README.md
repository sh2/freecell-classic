# freecell-classic

クラシックルール(標準ルール)のフリーセル (FreeCell) です。

## 遊び方

- すべてのカードをホーム(右上の 4 つの土台)へ A から K までスートごとに積み上げればクリアです。
- カスケード(中央の 8 列)には、赤黒交互・ランク降順でカードを重ねられます。
- フリーセル(左上の 4 つの空き)には 1 枚ずつカードを一時退避できます。
- カードはクリック(選択 → 移動先をクリック)またはドラッグ&ドロップで操作できます。
- ゲーム番号 (No.) は Microsoft 版 FreeCell と互換の配置を生成します。

## オンラインで遊ぶ

インストール不要です。GitHub Pages で公開しています。

<https://sh2.github.io/freecell-classic/>

## 起動方法

ゲーム本体の実行には依存ライブラリはありません。静的ファイルを HTTP
サーバーで配信してブラウザで開きます。テスト実行時のみ Node.js / npm が
必要です(「開発」を参照)。

```bash
python3 -m http.server 8000
# → http://localhost:8000/ をブラウザで開く
```

## 機能

- クリック / ドラッグ&ドロップ操作
- ダブルクリックでの自動移動(ホーム → フリーセル)
- カード移動アニメーション(移動元の位置から目的地までクローンが飛行。
  自動ホーム送りは 1 枚ずつ順番に送る。`prefers-reduced-motion` 環境では無効)
- 「ホームへ送る」ボタン・「自動で送る」トグル・アンドゥ (Ctrl+Z)・タイマー・手数表示
- ヒント(次の一手の移動元カードと移動先をハイライトし、トーストで手順を表示。
  10 秒で自動的に消えるほか、移動などの操作でも解除される)
- 自動解答(トグル ON で解を探索し、1 手ずつ飛行アニメーションで自動再生。
  完了後に解答手順パネルを表示。探索中・再生中は盤面操作をブロックし、
  トグル OFF で中断できる)
- 詰み検出(合法手がなくなると「詰みました」オーバーレイを表示。
  「1手戻す」で Undo して脱出できる)
- 内蔵ソルバー(IDA\* 探索 + Zobrist ハッシュ置換表。Web Worker 上で
  fast → safe の二段階探索を行い、全 32,000 配布のうち 31,999 を解決)
- ゲーム番号指定(1〜32000)・ランダムゲーム
- 勝利オーバーレイ

## 技術構成

- HTML / CSS / JavaScript (vanilla、本番は依存ライブラリ・ビルドなし)
- 静的な 1 ページ構成(`index.html` + `src/css/style.css` + `src/js/*.js`)。
- ブラウザーコードはネイティブ ES Modules で責務を分割している。
  - `src/js/constants.js`: 定数(スート、ランク、各セル数、最大ゲーム番号)
  - `src/js/deal.js`: ディール生成(Microsoft FreeCell 互換)
  - `src/js/rules.js`: 移動ルール・最大移動枚数・安全な自動移動の判定
  - `src/js/game-state.js`: 状態遷移・履歴・Undo・勝利判定・番号補正
  - `src/js/solver.js`: ソルバー本体(IDA\* 探索 + Zobrist ハッシュ置換表、二段階探索)
  - `src/js/solver.worker.js`: ソルバーを Web Worker で実行するワーカー
  - `src/js/solver-client.js`: Worker との通信とヒント / 自動解答の制御
  - `src/js/view.js`: DOM 構築・描画・トースト・ヒントハイライト・勝利 / 詰みオーバーレイ
  - `src/js/interactions.js`: クリック・Pointer Events・ドラッグ&ドロップ
  - `src/js/app.js`: ゲーム開始・モデルと View の調停・タイマー
  - `src/js/main.js`: エントリポイント(初期化とテスト API の公開)
- テストは Vitest(単体)+ Playwright(ブラウザー E2E)。

## ドキュメント

- UI の状態遷移とコントロールの有効 / 無効対応表:
  [`docs/ui-state-matrix.md`](./docs/ui-state-matrix.md)
- ソルバーの改善記録と評価データ:
  [`docs/solver-insights-and-improvement-plan.md`](./docs/solver-insights-and-improvement-plan.md)
- ソルバーベンチマークの使い方と計測結果:
  [`docs/benchmark/README.md`](./docs/benchmark/README.md)

## 開発

### 必要環境

- Node.js (LTS) と npm。GitHub Pages への配信は静的ファイルのみで、ビルドは
  不要。npm はテストとベンチマークの実行にのみ使用する。

### 依存の導入

```bash
npm install
```

E2E テストの初回実行前に、ブラウザー本体が必要になる場合があります。

```bash
npx playwright install chromium
```

### ローカルテスト

```bash
npm test                # 単体テスト + E2E テストをまとめて実行
npm run test:unit       # 単体テスト (Vitest) を 1 回だけ実行
npm run test:unit:watch # 単体テストを watch で実行
npm run test:e2e        # E2E テスト (Playwright) を実行
npm run test:e2e:ui     # E2E テストを UI モードで実行
```

- Playwright は `playwright.config.js` の `webServer` 設定でローカル HTTP
  サーバーを自動起動する。ポートは `node:net` で選んだランダムな空きポートを
  使い、環境変数 `FREECELL_E2E_PORT` で固定もできる。
- ブラウザーでの手動確認は「起動方法」の HTTP サーバーを立ち上げて行う。
  クリック・ドラッグ操作の再現方法は
  [`.agents/skills/freecell-playwright-testing/`](./.agents/skills/freecell-playwright-testing/SKILL.md)
  を参照。

### ソルバーベンチマーク

内蔵ソルバーの性能計測用ハーネス。使い方と計測結果の詳細は
[`docs/benchmark/README.md`](./docs/benchmark/README.md) を参照。

```bash
npm run benchmark        # 次の未計測バッチ (1,000 ゲーム) を計測
npm run benchmark:all    # 残り全バッチを順に計測 (シリアルで時間がかかる)
npm run benchmark:report # 計測結果から自己完結型 HTML レポートを生成
```
