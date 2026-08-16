# 詰み(ゲームオーバー)検出の実装計画

> 対応状況: 2026-08-16 に実装済み(`npm test` 単体 115 / E2E 58 が
> すべて成功)。実装の詳細は [CHANGELOG.md](../CHANGELOG.md) を参照。

## 背景

- 現在は勝利判定(`game-state.js` の `isWon` / `checkWin`)のみで、
  合法手が 1 つもない「詰み」状態の検出がない。
- Microsoft FreeCell は詰みを検出し、「1手戻す / 新しいゲーム」を案内する。
- 本実装はこの「詰み」検出を追加する。

## 目的

- 合法手が尽きた状態を検出し、オーバーレイで「詰みました」+
  「1手戻す」「新しいゲーム」を提示する。
- 勝利判定(`won`)と独立させ、undo による脱出を妨げない。

## 対象外

- 「盤面が解けるか」のゲーム木探索は行わない。あくまで「今、合法手が
  1 つもないか」の即時判定。
- 勝敗記録・統計・ランキング等の追加。
- 詰み時のタイマー停止(タイマーは継続。undo で続行できるため)。

## 現行挙動の基準(変更しない)

- 勝利判定・勝利オーバーレイ(`view.showWin`)の挙動。
- 移動ルール・自動ホーム送り(`chainAutoNext`)・Undo の挙動。
- タイマーは勝利時のみ停止し、詰みでは停止しない。

## 設計

### 判定ロジック(`game-state.js`)

- `hasAnyMove(state)` を純粋関数として追加し、合法手の有無を判定する。
- 確認する合法手は次のみで十分:
  1. ホームへ置けるカードがある(カスケード先頭 + フリーセル)。
  2. カスケード先頭 1 枚 → 空きフリーセル。
  3. フリーセルのカード → カスケード。
  4. カスケード先頭 1 枚 → 別カスケード。
- 複数枚グループ移動は「空きフリーセルまたは空きカスケード」が必須であり、
  その場合は必ず単独カードの移動も成立するため、単独カードの確認だけで
  全合法手の有無を判定できる(`maxMovable` 判定は不要)。
- フリーセル→フリーセル移動は無意味なシャッフルのため合法手に数えない。

### 状態フラグ(`game-state.js`)

- `createState` に `stuck: false` を追加。
- `checkStuck(state)` を追加。`state.won` のときは `stuck = false` を返し、
  それ以外は `stuck = !hasAnyMove(state)` を設定して返す
  (`checkWin` と対称)。
- `undo(state)` は復元後に `state.stuck = false` を設定
  (1手戻すと必ず手が残るため)。

### アプリ層(`app.js`)

- `onMoveSucceeded()` の `checkWin()` 直後に `checkStuck()` を追加。
  `gameState.checkStuck(state)` が true なら `view.showStuck()` を呼ぶ。
- `undo()` は成功時に `view.hideOverlay()` を追加。
- `setBoard` に `state.stuck = false` を追加。
- `snapshot()` に `stuck: state.stuck` を追加。
- `mount()` に `#overlay-undo` のクリックで `undo()` を登録。

### ビュー層(`view.js`)と `index.html`

- `view.showStuck()` を追加: `#overlay-title` に「詰みました」、
  `#overlay-message` に案内文、`#overlay` を表示。`#overlay-undo` を表示。
- `view.showWin()` では `#overlay-undo` を非表示(勝利画面に出さない)。
- `index.html` の `#overlay-card` に
  `<button id="overlay-undo">1手戻す</button>` を追加
  (既存 `#overlay-new-game` の前)。
- `src/css/style.css` に `.overlay-card button.hidden { display: none; }`
  を追加。

## 変更ファイル

- `src/js/game-state.js` — `hasAnyMove` / `checkStuck` / `createState` の
  `stuck` / `undo` の `stuck` 解除。
- `src/js/app.js` — `checkStuck` / `onMoveSucceeded` / `undo` / `setBoard` /
  `snapshot` / `mount`。
- `src/js/view.js` — `showStuck` / `showWin` のボタン制御 / 公開 API。
- `index.html` — `#overlay-undo` ボタン追加。
- `src/css/style.css` — ボタン非表示用 CSS。
- `tests/unit/game-state.test.js` — `hasAnyMove` / `checkStuck` /
  `createState` / `undo` のテスト。
- `tests/unit/app.test.js` — モック view に `showStuck` を追加。
- `tests/e2e/freecell.spec.js` — 詰み検出・オーバーレイ・1手戻すの E2E。
  既存の自動移動テスト 1 件は、部分盤面 fixture で詰みオーバーレイが出る
  ため、背景クリックで閉じてから Undo を検証するよう調整。
- `CHANGELOG.md` — 追記。

## テスト計画

### 単体(`tests/unit/game-state.test.js`)

既存の `stateWith({...})` fixture を流用する。

- `hasAnyMove`:
  - 詰み盤面で false。
  - ホームへ置ける / 空きフリーセルあり / カスケード→カスケード /
    フリーセル→カスケード で true。
  - `won` 状態で false。
- `checkStuck`:
  - 詰み盤面で true を返し `stuck` が true。
  - `won` 状態で false を返し `stuck` は false。
- `createState` が `stuck: false` を初期化。
- `undo` が `stuck` を false に戻す。

### E2E(`tests/e2e/freecell.spec.js`)

1手前の盤面を `h.setBoard` で注入し、実操作で詰み検出を検証する。

- 1手前盤面(全カード黒・非エース、foundations 空):
  - freeCells: 10♣(id 36), J♠(43), Q♣(44), K♠(51)
  - cascades: [3♠=11], [4♣=12], [5♠=19], [6♣=20], [7♠=27], [8♣=28],
    [9♠=35], [2♠=7, A♣=0](先頭 A♣)
- この盤面の合法手は A♣→ホームのみ。`h.clickCard(page, 0)` →
  `h.clickSlot(page, "home", 0)` で A♣ をホームへ。
- 検証: `(await h.state(page)).stuck === true`、`#overlay` 表示、
  `#overlay-title` が「詰みました」。
- `#overlay-undo` をクリック → オーバーレイ非表示、`stuck === false`、
  A♣ が col7 先頭へ戻る、手数 0。
- 通常の手ではオーバーレイが出ない(`stuck === false`)。

## 検証手順

1. `npm run test:unit`(単体)。
2. `npm run test:e2e`(E2E)。
3. `npm test`(全体)。
4. 必要に応じブラウザで実操作確認
   (スキル `.agents/skills/freecell-playwright-testing/SKILL.md`)。

## CHANGELOG

- `## 2026-08-16` セクションに「### 機能追加」として詰み検出を追記。
