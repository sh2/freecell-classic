# AGENTS.md — FreeCell テスト用ガイド

このドキュメントは、本プロジェクト (フリーセル) の動作をブラウザで確認する際に、
AI エージェントが正しくクリックやドラッグを操作するためのノウハウをまとめたものです。

## 1. テスト環境のセットアップ

ゲームは静的 HTML/CSS/JS のみで構成されるが、統合ブラウザは `file://` での
ローカルファイル読み込みを 403 で拒否するため、HTTP サーバー経由で配信する。

```bash
cd /home/taira/nfs/work/20260805_freecell && python3 -m http.server 8377 --bind 127.0.0.1
```

- 起動は `mode='async'` で行い、ターミナル ID を控えること。
- その後 `http://127.0.0.1:8377/` を `open_browser_page` で開く。
- 統合ブラウザはリモートポート転送により、ローカルアドレスでアクセス可能。

## 2. ページ構造の概要

- `#game` 配下に `.top-area`(フリーセル 4 + ホーム 4)と `#cascade-area`(カスケード 8)。
- 各カードは `.card` 要素。`data-card-id` 属性で一意に識別できる。
- カスケードのカードは重なっており、上のカード(= 山札の後ろ)が下を覆う。
  見えているのは最上位カードの全面と、それ以外のカードの上端の帯だけ。
- スロットは `.slot`。ホームは `#home-cells .slot`、フリーセルは `#free-cells .slot`。
- クリック/ドラッグはすべて `#game` への `pointerdown` と、`document` の
  `pointermove` / `pointerup` で処理される(Pointer Events ベース)。

## 3. クリック操作のノウハウ(検証済み)

### 3.1 クリック位置は必ず `elementFromPoint` で走査して決める

カードの矩形中央をクリックすると、重なっている他のカードにヒットすることが多い。
対象カード自体にヒットする座標を、グリッド走査で探すこと:

```js
// ページ側ヘルパー: cardId のカードにヒットする座標を返す(完全隠蔽なら null)
window.__clickPoint = function (cardId) {
  const el = document.querySelector(`#game .card[data-card-id="${cardId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  for (let fy = 0.04; fy <= 0.9; fy += 0.12) {
    for (let fx = 0.2; fx <= 0.8; fx += 0.3) {
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest && hit.closest(`.card[data-card-id="${cardId}"]`)) {
        return { x, y };
      }
    }
  }
  return null;
};
```

- 検証済み: この走査で得た点(例: 列末尾カードの上端付近)を
  `page.mouse.click()` すると正しく選択される。
- 隠れているカードでも上端の帯が見えていればヒット点が返る。
  その点をクリックすると「見えている方のカード」へのクリックとして扱われる
  (= 隠れたカードは選択されない)。これはゲームとして正しい挙動。

### 3.2 選択できるのは「つかめる(grabbable)カード」だけ

- カスケードで選択可能なのは、そこから末尾までが
  「ランク降順・色交互」になっているカードのみ(= 実際にまとめて動かせる列)。
- それ以外のカード(例: 上に同色のカードが乗っているカード)をクリックすると
  シェイクするだけで選択されない。これは仕様でありバグではない。
- テスト対象カードを選ぶときは、まず `window.__snap()` や DOM 確認で
  「つかめるカード」を特定してからクリックすること。

### 3.3 同じカードを 400ms 以内に再クリック = ダブルクリック自動移動

- **選択解除ではない**。400ms 以内の同一カード再クリックは
  `dblClickAutoMove` を発動する(ホームへ、無理なら空きフリーセルへ移動)。
- 検証済み: 列末尾カードを 2 回素早くクリックしたら、選択解除ではなく
  空きフリーセルへ自動移動した(手数が +1 される)。
- 選択解除したい場合は、`Escape` キーを押すか、400ms 以上空けてから再クリックする。

### 3.4 状態確認用スナップショットヘルパー

```js
window.__snap = function () {
  return {
    moves: document.getElementById('move-counter').textContent,
    selected: [...document.querySelectorAll('#game .card.selected')].map(e => e.dataset.cardId),
    free: [...document.querySelectorAll('#free-cells .slot')].map(s => s.querySelector('.card')?.dataset.cardId ?? null),
    home: [...document.querySelectorAll('#home-cells .slot')].map(s => s.querySelector('.card')?.dataset.cardId ?? null),
    cascadeLens: [...document.querySelectorAll('#game .cascade')].map(c => c.querySelectorAll('.card').length),
  };
};
```

- 各操作の前後で呼び、手数・選択・各ゾーンの枚数差分を検証する。
- ページを**リロード**すると注入済みヘルパーは消えるので再注入が必要。
  ただし `#restart-btn` や `#new-game-btn` による盤面リセットでは
  ページ自体はリロードされないため、ヘルパーはそのまま残る。

### 3.5 初期盤面の注意点

- Game #1 の初期配置では、どの A も列の途中に埋まっており、
  最初の一撃でホームへ送れるカードは存在しない。
- カスケード同士の合法手も最初の状態では存在しないため、
  ホーム/フリーセルへの移動からテストを組み立てること。
- 初期状態でカスケード間移動のテストをするなら、合法手のあるゲーム番号を使う。
  例: **Game 3**(列1トップの 4♠ → 列7トップの 5♥)、
  **Game 20**(列1トップの 1♦ → 列0トップの 2♠)など。
  2枚セット移動のテストには **Game 12**(列0トップが 9♦-8♣ のペア)。

### 3.6 内部状態・関数への直接アクセス(最重要テクニック)

game.js はクラシックスクリプト(`<script src>`、モジュールでない)のため、
トップレベルの `let`/`const` 変数や `function` は**グローバル語彙環境**に入り、
`page.evaluate` の中から識別子として直接参照できる(`window.` は不要・付けても不可)。

```js
const state = await page.evaluate(() => ({
  // 内部状態の直接参照
  cascades: cascades.map(p => p.map(c => c.rank + ['C','D','H','S'][c.suit])),
  freeCells, foundations, moveCount, won, selected,
  // 内部関数の直接呼び出し
  maxMovable: maxMovable(null),
  canMove: attemptMove({zone:'cascade', index:0, cardIndex:0}, 'cascade', 1).ok,
}));
```

- 検証済み: `cascades` `freeCells` `foundations` `moveCount` `selected` などの
  状態変数、`attemptMove` `maxMovable` `dealGame` `checkWin` `showToast` などの
  関数がすべて `page.evaluate` 内でそのまま使える。
- 検証済み: Game #1 のディール結果が Microsoft FreeCell #1 と完全一致。
- UI では再現が難しい盤面(全カードのホーム詰め、枚数超過など)を作るときは、
  この直接アクセスで状態を書き換えてから `render()` を呼ぶとよい。
- **注意**: 状態を書き換えたら必ず `render()` を呼ぶこと(DOM と同期されない)。
  `attemptMove` は内部で render まで行うため呼び分けに注意。

## 4. ドラッグ&ドロップ操作のノウハウ(検証済み)

### 4.1 ドラッグの再現方法

統合ブラウザの `click_element` ではなく、`page.mouse` API を使うこと:

```js
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move(to.x, to.y, { steps: 10 }); // 中間点を入れる
await page.mouse.up();
```

- 検証済み: この操作で実際にドラッグが開始され(`#drag-layer` が表示され)、
  ドロップ先で正しく移動する。
- **6px 未満の移動はクリック扱い**になる(`onPointerMove` の閾値)。
  ドラッグと判定させるには `from` から 30px 以上移動させてから目的地へ運ぶ。
- 起点は「つかめるカード」でないとドラッグにならない(3.2 参照)。
- マルチカードドラッグは、グループの**最上位(見える)カードを起点**にすると
  グループ全体が `#drag-layer` に複製される(検証済み: 2枚・8枚)。

### 4.2 ドロップ先の指定

- カスケードへのドロップ: 対象列の**現在のトップカード(か空きスロット)の中心**へ運ぶ。
  `window.__clickPoint(topCardId)` でトップカードの中心座標が得られる。
- フリーセル/ホームへのドロップ: `window.__slotPoint('#free-cells .slot', i)` や
  `window.__slotPoint('#home-cells .slot', i)` でスロット中心を得る。
- 置ける場所はドラッグ中に `.drop-hint`、運んだ先が `.drop-target` になる。
  検証時に `document.querySelectorAll('#game .drop-hint')` を読むと、
  どのゾーン/インデックスが受け入れ可能か事前確認できる。

### 4.3 ドラッグの成否の検証ポイント

- 成功時: 手数が +1、`cascades`/`freeCells` の内容変化、`#drag-layer` が非表示化。
- 失敗時(無効な場所): 手数は変わらず、`render()` で元位置にスナップバック。
- 枚数超過時: `attemptMove` が `{ok:false, reason:'too-many'}` を返し、
  トースト「一度に移動できるのは最大 N 枚です…」が表示される(5.2 の課題参照)。

## 5. 検証済み動作一覧(2026-08-05 時点)

- [x] ディールが Microsoft FreeCell 互換(Game #1 の配置一致)。
- [x] カードのクリック選択/選択解除(3.1〜3.3)。
- [x] クリック→クリックでフリーセル・ホーム・カスケードへ移動。
- [x] 不正な移動は拒否され、移動先カードがつかめるなら選択が切り替わる。
- [x] ダブルクリックでホームへ(無理なら空きフリーセルへ)。
- [x] ドラッグ&ドロップ(1枚・複数枚・フリーセル・ホーム・空き列)。
- [x] 移動枚数上限 `maxMovable` がドラッグ/クリック両方で効く。
- [x] 自動移動ボタン、Escape、Ctrl+Z(undo)、自動トースト。
- [x] 勝利オーバーレイ表示、背景クリックで閉じる、新規ゲーム再開。
- [x] シード値の不正入力(0/空/小数/範囲外)は乱数ゲーム or 切捨てで処理。

## 6. 発見した課題と修正履歴

### 6.1 修正済み(2026-08-06)

- [x] **トーストに中国語「更多」が混入** → `toManyMessage()` ヘルパーを新設し
  「一度に移動できるのは最大 N 枚です(空きセル・空き列が増えるとさらに増えます)」に修正。
  クリック経路(`failFeedback`)とドラッグ経路(`onPointerUp`)の両方でこのヘルパーを使用し、
  メッセージの重複も排除した。
- [x] **シード値の範囲チェック不足** → `MAX_GAME_NUMBER = 32000` 定数を追加。
  `newGameFromInput` で 1〜32000 の範囲外は乱数化(範囲内は維持)。
  初期 `gameNumber`・`randomGameNumber`・`newGameFromInput` ですべて同じ定数を使用。
- [x] **`startGame` / `newGameFromInput` の重複** → `newGameFromInput` から
  冗長な `input.value = num` を削除(`startGame` 内で seedInput へ反映する責務を一本化)。

### 6.2 任意改善案の対応(2026-08-06 実施済み)

以下の実害のない簡潔化案も洗い出し時に片付けた:

- [x] **`foundationTargetFor` と `canDropOnHome` のロジック重複**
  → `foundationTargetFor` を `for (i) if (canDropOnHome(card, i)) return i` の形に書き直し、
     `canDropOnHome` を単一の真実源として再利用(検証済み: A♥→空きホーム、
     K♠ は積み上がるまで -1、積み上がれば正しいインデックスを返す)。
- [x] **`updateHighlights` 内の `cardElById()` 毎回 `querySelector` 走査**
  → `render()` 時に `cardElMap` (`Map<cardId, el>`) を構築し、`cardElById` が
     それを優先して返すよう変更(52 枚でも無害だが高速化・簡潔化を達成)。
- [x] **`#restart-btn` の `won` 後の盤面リセット**
  → 改めて検証し、問題なしと確認。`startGame` 経由で `won` フラグも降りるため
     コメントで意図を明記した(実装変更は不要)。
