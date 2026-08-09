# 変更履歴

## 2026-08-09

### 修正

- 小さいウィンドウでカードのデザインが崩れる問題を解消(`src/css/style.css`)。
  - 幅 600px 以下では中央のランク/スート(`.center-mark`)を非表示にし、コーナーの
    ランク/スートのみで判別できるようにした。
  - 601〜800px では、中央マークとコーナーのフォントサイズが 800px を境に基本
    デザイン(2.1rem/1.35rem、1.1rem/1.05rem)より逆に大きくなって崩れていた。
    カード幅に対する比率を基本デザインと同じ(中央 4vw/2.6vw、コーナー
    `clamp(0.9rem, 2.1vw, 1.1rem)` / `clamp(0.85rem, 2vw, 1.05rem)`)にして、
    境界での跳ね上がりをなくし、カード縮小に比例したスケールに修正した。
    コーナーは `clamp()` の下限で狭幅でも読めるサイズを保証する。
  - 幅 375px で横スクロールバーが出ていたため、600px 以下で盤面の幾何制約を
    viewport に収める調整を追加。`#game` の左右 padding を 12px → 6px、
    `.top-area` の gap を 16px → 8px、`.free-cells` / `.home-cells` /
    `.cascade-area` の gap を 10px → 5px に縮小し、375px・360px・320px
    でも `overflow: false` で収まることをブラウザ検証で確認した。

### リファクタリング

- ルール判定を `src/js/rules.js` へ抽出した(`docs/refactoring-and-testing-plan.md`
  の Phase 3)。
  - `src/js/rules.js` を新設。`isRed`、`isValidSequence`(色交互降順)、
    `foundationRank`、`foundationTargetFor`、`canDropOnHome`、`canDropOnCascade`、
    `maxMovable`、`canAutoHome`、`findCardLocation`、`isGrabbable` を純粋関数として
    移動し、暗黙のグローバル参照を引数へ置き換えた。DOM・時刻には触れない。
  - `src/js/game.js` は `import * as rules` で委譲する形にし、ルール判定の
    実装を削除。テスト API の `maxMovable` は従来と同じ 1 引数を受け取る
    ラッパーを残した。
  - `tests/unit/rules.test.js` を追加(29 件)。色・配列判定、ホーム、カスケード、
    最大移動枚数、安全な自動移動、カード探索、つかみ判定を検証。

- ES Modules への切り替えと定数・ディールの抽出(`docs/refactoring-and-testing-plan.md`
  の Phase 2)。
  - `index.html` を `<script type="module" src="src/js/main.js">` へ切り替え。
  - `src/js/main.js` を新設。`game.js` の `init()` を 1 回だけ呼び出し、
    E2E テスト用の公開 API(`getTestApi`)を再 export する。
  - `src/js/game.js` を ES Module へ変更。末尾の自動 `init()` を削除し、
    `init`、読み取り専用スナップショット(`snapshot`)、検証付き fixture 読み込み
    (`setBoard` / `setWinBoard`)を export。fixture はカード id の一意性と各ゾーンの
    形式(列数・セル数・id 範囲)を検証してから適用し、内部配列の可変参照は返さない。
  - `src/js/constants.js` を新設。`SUITS`、`RANKS`、各セル数、`MAX_GAME_NUMBER` を
    名前付き export。
  - `src/js/deal.js` を新設。`msRng` と `dealGame(gameNumber)` を移動。
    `dealGame` はグローバル状態を変更せず新しい初期盤面を返す。
  - `tests/e2e/helpers.js` の内部状態アクセスを、クラシックスクリプトのグローバル
    直接参照から `main.js` の公開テスト API(`window.__testApi`)へ差し替え。
    同じ URL の dynamic import でモジュールキャッシュが働き、`init()` は
    二重実行されない。
  - `tests/unit/deal.test.js` を追加。Game #1 の既知配置、52 枚の一意性、
    列長、決定性、配列参照の非共有、`msRng` の決定性を検証。

### 改善

- ローカルテスト基盤を導入した(`docs/refactoring-and-testing-plan.md` の Phase 1)。
  - `package.json`(type: module)、Vitest、Playwright Test を追加。`npm test` で
    単体テストと E2E テストをまとめて実行できる。
  - `tests/unit/smoke.test.js`: Vitest 環境の動作確認用スモークテスト。
  - `tests/e2e/helpers.js`: カード座標探索(`elementFromPoint` 走査)、内部状態への
    直接アクセス、盤面 fixture(`setBoard` / `setWinBoard`)を集約。ESM 移行後の
    公開テスト API へ差し替えやすい構成にした。
  - `tests/e2e/freecell.spec.js`: ディール互換(Game #1 全配置)、クリック・ドラッグ
    移動、複数枚移動(Game #12)、移動枚数上限、ダブルクリック自動移動、自動移動の
    安全性と 1 枚単位 Undo、ドラッグの 6px 閾値、勝利オーバーレイ、指定ホームの
    誘導、ゲーム番号入力補正、タイマーの開始・停止を検証(計 41 件)。
  - `playwright.config.js`: `node:net` でランダムな空きポートを選び webServer /
    baseURL へ埋め込む。config はメインプロセスとワーカーで別々に評価されるため、
    最初に決めたポートを環境変数へ書き戻して共有する(環境変数
    `FREECELL_E2E_PORT` で固定ポートにも変更可能)。

## 2026-08-08

### 修正

- ドラッグ&ドロップで移動枚数上限を超えるグループをドロップしてもトーストが
  表示されない問題を修正。`getValidDropTargets` が枚数超過の候補を除外するため
  `onPointerUp` の too-many 分岐に到達しなかった。ドロップ位置の列が
  「ランク/色は合うが枚数超過」の場合に、クリック操作と同じトーストを表示する
  判定(`tooManyLimitAt`)を追加した。

### 改善

- カード中央の大きなスート単独表示(♠ などが「1」に見える誤認の原因)を廃止し、
  MS FreeCell 風に中央へランクを大きく・その下にスートを小さく表示するデザインに
  変更(J/Q/K も同じレイアウト)。`centerMarkHtml()` を追加。

### リファクタリング

- `src/js/game.js` のブレースなし制御文 65 箇所をすべてブロック `{}` 形式に統一。
  あわせて AGENTS.md に「制御文は必ずブロックを使う」規約を追加。
- CHANGELOG の日付セクション形式(「### 修正」「### リファクタリング」の繰り返し)で
  markdownlint MD024 が出るため、`.markdownlint.json` に `MD024: siblings_only` を設定。

## 2026-08-06

### 修正

- トーストに中国語「更多」が混入していた問題を修正。`toManyMessage()` ヘルパーを新設し、
  「一度に移動できるのは最大 N 枚です(空きセル・空き列が増えるとさらに増えます)」に修正。
  クリック経路(`failFeedback`)とドラッグ経路(`onPointerUp`)の両方でこのヘルパーを使用し、
  メッセージの重複も排除した。
- シード値の範囲チェック不足を修正。`MAX_GAME_NUMBER = 32000` 定数を追加し、
  `newGameFromInput` で 1〜32000 の範囲外は乱数化(範囲内は維持)。
  初期 `gameNumber`・`randomGameNumber`・`newGameFromInput` ですべて同じ定数を使用。
- `startGame` / `newGameFromInput` の重複を整理。`newGameFromInput` から
  冗長な `input.value = num` を削除(`startGame` 内で seedInput へ反映する責務を一本化)。

### リファクタリング

- `foundationTargetFor` と `canDropOnHome` のロジック重複を解消。
  `foundationTargetFor` を `for (i) if (canDropOnHome(card, i)) return i` の形に書き直し、
  `canDropOnHome` を単一の真実源として再利用(検証済み: A♥→空きホーム、
  K♠ は積み上がるまで -1、積み上がれば正しいインデックスを返す)。
- `updateHighlights` 内の `cardElById()` の毎回の `querySelector` 走査を改善。
  `render()` 時に `cardElMap` (`Map<cardId, el>`) を構築し、`cardElById` が
  それを優先して返すよう変更(52 枚でも無害だが高速化・簡潔化を達成)。
- `#restart-btn` の `won` 後の盤面リセットを再検証し、問題なしと確認。
  `startGame` 経由で `won` フラグも降りるためコメントで意図を明記した(実装変更は不要)。
