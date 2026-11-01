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
- やり直し確認(進行がある状態で「やり直す」を押すと確認ダイアログを表示。
  Enter で実行、Esc・キャンセル・背景クリックで中止できる。
  進行がないときや勝利後は確認せずに即座にリセットする)
- ヒント(次の一手の移動元カードと移動先をハイライトし、トーストで手順を表示。
  10 秒で自動的に消えるほか、移動などの操作でも解除される。
  求めた解のパス上でプレイしている間はキャッシュを再利用するため、
  2 回目以降のヒントは探索なしで即座に表示される。
  探索に時間がかかる場合はボタン内にスピナーと探索段階
  (高速探索中…/安全探索中…)を表示する)
- 自動解答(トグル ON で解を探索し、1 手ずつ飛行アニメーションで自動再生。
  完了後に解答手順パネルを表示。探索中・再生中は盤面操作をブロックし、
  トグル OFF で中断できる。解のキャッシュがあれば再探索せずに再生する)
- 詰み検出(合法手がなくなると「詰みました」オーバーレイを表示。
  「1手戻す」で Undo して脱出できる)
- 内蔵ソルバー(IDA\* 探索 + Zobrist ハッシュ置換表。Web Worker 上で
  fast → safe の二段階探索を行い、全 32,000 配布のうち 31,999 を解決)
- ゲーム番号指定(1〜32000)・ランダムゲーム
- 勝利オーバーレイ
- ドパモード(ツールバーのチェックボックスで ON/OFF。カード選択・移動・
  ホーム送り・失敗・ヒント・詰み・勝利に、光・粒子・紙吹雪・花火と
  Web Audio API の合成サウンドを追加する演出設定。デフォルト OFF で、
  設定は保存しない。`prefers-reduced-motion` 環境でも ON なら演出する。
  音声ファイル・外部ライブラリは使わず、音量調整や個別ミュートは持たない。
  OFF はドパモードの演出だけを止め、既存のカード飛行には影響しない)
  - 増強版では固定 ID の 56 演出(A カード系 / B 攻撃系 / C 画面系 /
    D テロップ系 / E 世界観系 / F 節目系 / G 失敗系)を実装。通常移動は
    A+B+C からランダムに 1 件(直前と同一は回避)＋50% で D を重ね、
    ホーム移動は B+E から 1 件＋D、ヒント・アンドゥ・配布・失敗・詰み・
    勝利にも専用の割り当てがある。スート完成は f01+e02、K の初配置は
    f02、残り 10 枚以下は f03、勝利は f04→f05→f06 の順で再生する。
  - 画面全体の transform / filter は同時 2 件まで、DOM 演出ノードは
    同時 200(モバイル 100)まで。勝利 Canvas は最大 800 粒子を目安にし、
    各演出は 2.5 秒以内、勝利シーケンスは 8 秒以内で終了する。
    OFF・新規ゲーム・オーバーレイを閉じる操作で即座に停止し、
    盤面に transform / filter を残さない。
  - 実機フィードバック反映: 効果音は爆発・重火器・魔法・ライトセーバー風の
    攻撃的な合成音へ強化し、B/E 群の低域と音量を底上げした。オノマトペは
    英語プール＋ハードロック風のシステムフォントで表示する。局所演出は
    2.4 倍に拡大し、爆発系では盤面のティルトと背景爆発を重ねる。
  - 追加フィードバック反映: 演出内の表示文字をすべて英語プールに統一し、
    書体は Times New Roman 先頭の Serif スタック＋斜体へ変更した。
    カード位置に紐づかないテキストは上下左右の安全なアンカーから
    発火ごとに位置を変え、カットイン／一文字フラッシュ／拡大パンチの
    3 種の文字アニメーションを使い分ける。演出時間は 0.8〜1.3 倍に
    ジッターし、C/D/E 群は約 12%（e02・f01・f02・combo 8 以上は確定）で
    3 倍の epic になる。
  - 追加フィードバック第3弾: 枠付きテキストは文字と枠を 1 つのラッパーに
    統合し、アンカー移動時のずれを解消した。軽いチャイム・BEEP・音階／
    アルペジオ系のレシピを廃止し、サブベース・ランブル・低域ノイズ中心の
    音へ付け替えた。選択・移動・ホーム送り・トグルなどの基本操作音も
    実音から低域中心へ作り直している。テキストは
    「入る→静止 120〜250ms→流れる」の 3 相、爆発などのインパクト系は
    盤面を 80〜160ms（epic は最大 300ms）止めるヒットストップを入れた。
  - 追加フィードバック第4弾: テロップはビューポート幅に合わせて
    フォントサイズを自動縮小し、390px 幅でもはみ出さない。
    e01-magic は低域ドローン「ブォーーーン」と魔法陣画像
    （`src/img/magic-circle.png`、アルファ付き PNG・screen 合成・回転）を
    表示し、e06-space は星雲背景（`nebula-backdrop.jpg`）と宇宙猫
    （`space-cat.jpg`）を漂わせる。画像は ON 時にプリロードする。
    c10-felt の炎上（inferno）はビューポート全体を燃やす。
- 画面下端にコピーライトと GitHub リポジトリへのリンクを常時表示
  (盤面が画面を超えて伸びたときのみ下へ押し出され、スクロールで到達できる)
- ブラウザータブにゲームのアイコンを表示
  (フェルト緑 × カードの SVG ファビコン `src/img/favicon.svg`)

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
  - `src/js/solution-cache.js`: ソルバーの解のキャッシュ(盤面スナップ照合による再利用)
  - `src/js/solver-client.js`: Worker との通信とヒント / 自動解答の制御
  - `src/js/dopa.js`: ドパモードの状態・イベント→演出レシピ・連続ホームの combo
  - `src/js/dopa-effects.js`: 56 演出 ID のレジストリと実プレイへの割り当て表
  - `src/js/dopa-effects-a.js` 〜 `dopa-effects-g.js`: カテゴリ別の演出ハンドラー
  - `src/js/dopa-audio.js`: Web Audio API による合成サウンド(AudioContext のライフサイクル)
  - `src/js/dopa-visuals.js`: DOM / Web Animations / Canvas による視覚効果と粒子の掃除
  - `src/js/view.js`: DOM 構築・描画・トースト・ヒントハイライト・勝利 / 詰みオーバーレイ
  - `src/js/interactions.js`: クリック・Pointer Events・ドラッグ&ドロップ
  - `src/js/app.js`: ゲーム開始・モデルと View の調停・タイマー
  - `src/js/main.js`: エントリポイント(初期化とテスト API の公開)
- テストは Vitest(単体)+ Playwright(ブラウザー E2E)。

## ドキュメント

- UI の状態遷移とコントロールの有効 / 無効対応表:
  [`docs/ui-state-matrix.md`](./docs/ui-state-matrix.md)
- ソルバーの改善記録と評価データ(アーカイブ):
  [`docs/archive/solver-insights-and-improvement-plan.md`](./docs/archive/solver-insights-and-improvement-plan.md)
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

## ライセンス

[MIT License](./LICENSE)
