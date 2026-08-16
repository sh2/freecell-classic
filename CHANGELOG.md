# 変更履歴

## 2026-08-16

### 機能追加

- 詰み(ゲームオーバー)検出を追加(`src/js/game-state.js` / `src/js/app.js` /
  `src/js/view.js` / `index.html` / `src/css/style.css`)。
  - 合法手が 1 つも残っていない状態を検出し、オーバーレイ「詰みました」を
    表示する。ボタンは「1手戻す」「新しいゲーム」の 2 つ(既存 `#overlay` を
    流用し、背景クリックで閉じられる)。
  - `game-state.js` に純粋関数 `hasAnyMove` と `checkStuck` を追加し、
    `createState` に `stuck` フラグを追加。単独カードの移動だけを確認すれば
    十分(複数枚移動は空きフリーセル/空きカスケードが必須で、その場合は
    必ず単独カードの移動も成立するため)。
  - 勝利(`won`)とは独立。詰みではタイマーを止めず、Undo で脱出できる。
    `undo` は `stuck` を解除する。
  - テスト API の `snapshot` に `stuck` を追加。

## 2026-08-15

### 機能追加

- カード移動アニメーションを追加(`src/js/view.js` / `src/js/app.js` /
  `src/js/interactions.js` / `src/css/style.css`)。
  - 成功した移動(クリック移動・ドラッグ&ドロップ・ダブルクリック自動移動・
    自動移動ボタン・「自動でホームへ送る」)で、カードが移動元の位置から
    目的地まで飛行する。描画(`render()`)は即座に完了した盤面を生成し、
    アニメーションは `#anim-layer` 上のクローンで表現する(実カードは飛行中
    `.anim-hidden` で隠す)。
  - 飛行時間は距離に比例(150〜400ms に clamp)。
  - 自動ホーム送りが複数枚動く場合は 1 枚ずつ順番に送る(はしご状)。
  - 不正なドロップ先へ落としたときは、ドラッグレイヤーが元の位置へ飛んで
    から消える戻りアニメーションを追加。
  - `prefers-reduced-motion: reduce` の環境では既定で無効。テスト API
    (`setAnimationsEnabled`)で切り替え可能。
  - `game-state.js` の `autoMoveHome` は移動したカードの配列(移動順)を
    返すように変更(アニメーションの移動元算出用)。

### 修正

- ホームへ自動移動する際、対象カードがホームセルに一瞬表示されてから
  消え、その後に元の場所から飛んで見える表示崩れを修正(`src/js/view.js`)。
  - 原因 1: 飛行アニメーションが非同期ループ内でカードを 1 ステップずつ
    隠していたため、後続ステップのカードが render 直後〜飛行開始までの間
    ホームセルに表示されたままになっていた。`render()` と同一タスク内で
    **全ステップのカードを同期的に隠す**よう変更し、チラつきを解消。
  - 原因 2: ホームセルが最上位カードしか描画しないため、同じホームへ
    連続移動(例: 2H → ホーム、直後に 3H → ホーム)すると先のカードの
    DOM 要素が存在せず飛行がスキップされていた。ホームの山札を**全カード
    重ねて描画**するよう変更し、各カードが個別に飛行できるようにした
    (見た目は最上位 1 枚と同じ)。
- 複数枚を移動する際、移動元の位置でカードが一瞬消えてから出現して
  動いて見える表示崩れを修正(`src/js/view.js`)。
  - 原因: 実カードの隠蔽は同期的に済ませていたが、クローンは非同期ループ
    内で 1 ステップずつ生成していたため、後続ステップのカードは先行カードの
    飛行中は「実体もクローンも無い」状態になり、移動元から消えて見えた。
    **全ステップのクローンを render と同一タスク内で元の位置に同期的に
    生成**し、飛行だけを順番に開始するよう変更。移動元の矩形取得時に
    元の z-index も保持し、重なったクローンの積み順を元の盤面と一致させる。
- フリーセル経由の 2 段階移動(例: ♠2 をダブルクリック → ♠2 をフリーセルへ
  → 露出した ♠1 をホームへ → ♠2 をフリーセルからホームへ)で、2 回目の
  ♠2 の移動元が山札の位置になってしまう表示崩れを修正(`src/js/app.js` /
  `src/js/game-state.js` / `src/js/view.js`)。
  - 原因: 手動移動と自動移動を 1 回の描画にまとめており、自動移動の移動元
    矩形を「state は更新済み・DOM は未描画」のタイミングで収集していたため、
    手動移動で動いたカードの自動移動の移動元が古い DOM 位置(山札)になっていた。
  - 自動ホーム送りを「1 枚ずつ描画 → 飛行」の連鎖方式に変更し、各ステップの
    移動元を前の描画が終わった DOM から毎回収集するようにした。これにより
    フリーセル経由の連鎖でも正しい位置から飛ぶ。`game-state.js` に
    `findAutoMoveCard` / `autoMoveOne` / `hasAutoMove` を追加し、`view.js` に
    飛行完了後の連鎖コールバック(`runAfterAnimations`)を追加。
- トグルのラベル「毎手自動移動」を「自動でホームへ送る」へ改名。
  「毎手自動移動」は日本語として不自然(直訳調)なため、動作内容を表す
  自然な表現に統一した。`index.html` のラベルと `title` 属性、README、
  テストの describe / test 名、`src/js/app.js` のコメントを追従。
  挙動に変更はない。

## 2026-08-14

### 機能追加

- 「毎手自動移動」トグルを追加(既定オン)。成功手(クリック移動・ドラッグ移動・
  ダブルクリック移動)の直後に、`rules.canAutoHome` で安全と判定できるカードを
  自動でホームへ送る。Microsoft FreeCell の「Auto move to home cells」に相当する
  挙動で、`index.html` のチェックボックスからオン/オフを切り替えられる。
  - 自動発動時は、動かせるカードが無くてもトーストを表示しない(手動の
    「自動移動」ボタンのみ表示)。
  - 配布直後は自動移動を実行しない(最初の手動操作以降のみ)。
  - 自動移動は 1 枚ずつ `attemptMove` を通るため、Undo は引き続き 1 手単位。
  - アプリ層(`src/js/app.js`)に `runAutoMove` / `setAutoMoveEnabled` を追加し、
    `main.js` のテスト API にも `setAutoMoveEnabled` を公開した。

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

- View・入力・アプリケーション制御を抽出し、`src/js/game.js` を削除した
  (`docs/refactoring-and-testing-plan.md` の Phase 5)。
  - `src/js/view.js` を新設。`createView` が DOM 構築(`buildBoard`)、描画
    (`render` / `updateHighlights` / `updateStatus`)、タイマー表示
    (`setTimerLabel`)、トースト・シェイク、勝利画面(`showWin` / `hideOverlay`)、
    ドラッグレイヤー・ドロップヒント操作を提供する。DOM 参照はすべて
    View 内へ閉じ込めた。
  - `src/js/interactions.js` を新設。`createInteractions` がクリック
    (`handleClick`)と Pointer Events / ドラッグ&ドロップのハンドラを提供する。
    ダブルクリック判定用の `lastClick` と `dragState` を保持し、移動の実行は
    app 層の `attemptMove` / `dblClickAutoMove` へ委譲する。成功後の副作用
    (タイマー・描画・勝利処理)は app 側が担当する。
  - `src/js/app.js` を新設。`createApp` が state の保持、タイマー管理、モデル
    操作後の副作用順(`onMoveSucceeded`: lastClick リセット → タイマー開始 →
    描画 → 勝利処理)の調停、`mount` でのイベント登録、E2E テスト API
    (`snapshot` / `setBoard` / `setWinBoard` / `maxMovable`)を提供する。
    現在時刻・interval・乱数は `deps` で差し替え可能にし、既定値は
    ブラウザーの `Date.now` / `setInterval` / `clearInterval` / `Math.random`。
    勝利メッセージの経過時間は DOM の時刻テキストを読まず、タイマー状態から
    生成して View へ渡す(計画書 Phase 5 の要件)。
  - `src/js/main.js` を本格的なエントリへ拡張。`createView` → `createApp` →
    `createInteractions` を配線して `app.mount()` を 1 回呼び、`getTestApi()`
    を公開する。`init()` の二重実行はモジュールキャッシュで回避される。
  - `src/js/game.js` を削除。残っていた責務(描画・入力・アプリ制御)が
    上記 3 モジュールへ移り、計画書の目標ディレクトリ構成へ到達した。
  - `.github/workflows/deploy-pages.yml` の構文チェックを
    `node --check src/js/game.js` から `src/js/*.js` のループへ追従
    (game.js 削除で壊れるため)。
  - `tests/unit/app.test.js` を追加(10 件)。最初の成功手でタイマーが 1 回だけ
    開始されること、失敗手では開始しないこと、新規ゲーム・やり直し・勝利で
    interval が停止すること、経過時間が `M:SS` 形式で View に渡されること、
    無効なゲーム番号で注入した乱数が使われること、勝利メッセージへ経過時間が
    渡されること(タイマー未開始は `0:00`)を検証。

- 状態遷移を `src/js/game-state.js` へ抽出した(`docs/refactoring-and-testing-plan.md`
  の Phase 4)。
  - `src/js/game-state.js` を新設。`createState`(状態生成)、`groupFrom` /
    `selectedGroup`(グループ取得)、`attemptMove`(移動)、`undo`(履歴巻き戻し)、
    `autoMoveHome`(自動移動)、`dblClickAutoMove`(ダブルクリック移動)、
    `isWon` / `checkWin`(勝利判定)、`normalizeGameNumber`(番号補正)を純粋関数として
    移動。DOM・時刻・表示には触れず、state オブジェクトをその場で更新する。
    失敗手では状態・履歴・手数を変更せず、成功手では履歴と手数を 1 増やして
    選択を解除する。描画・タイマー・トースト・勝利オーバーレイ・勝利判定は
    呼び出し側(アプリ層)の責務とした。
  - `src/js/game.js` はモジュール変数(`gameNumber` / `cascades` / `freeCells` /
    `foundations` / `moveCount` / `historyStack` / `selected` / `won`)を単一の
    `state` オブジェクトへ統合し、状態遷移を `game-state.js` へ委譲する形に変更。
    成功手の副作用(`lastClick` リセット → タイマー開始 → 描画 → 勝利処理)を
    `onMoveSucceeded()` に集約し、クリック移動・ドラッグ移動・自動移動・
    ダブルクリック移動の 4 経路すべてで連続クリック判定がリセットされるようにした
    (リセットは従来 `attemptMove` 内にあったが、入力状態 `lastClick` の所有責務に
    合わせて入力・アプリ層へ移動)。`newGameFromInput` は `normalizeGameNumber` を
    使い、無効な入力はランダム番号で開始する。
  - `tests/unit/game-state.test.js` を追加(38 件)。移動の合法・不正・枚数上限、
    複数枚移動、既知の 1 枚移動(Game #1 / #12)、Undo(盤面・手数・履歴・won 不変)、
    自動移動(安全判定・カード 1 枚単位の履歴)、ダブルクリック(ホーム優先・次に
    フリーセル)、勝利判定、`normalizeGameNumber`(整数・小数・空値・非数値・範囲外)
    を検証。
  - `tests/e2e/freecell.spec.js` に、クリック移動・ドラッグ移動・自動移動の直後に
    同じカードをクリックしても自動移動が連鎖しないことを検証するテストを 3 件追加。

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
