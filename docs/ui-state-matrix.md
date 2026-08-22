# UI状態遷移表（フリーセル）

## 1. 目的

本ドキュメントは、ゲームの状態に対して各UIコントロールを Enable / Disable すべきかを
一貫した方針で整理することを目的とする。

もともとは以下の不整合を起点として洗い出しを行った。

- 自動解答トグルをONにすると「高速探索中…」→「自動解答中…」へ表示が遷移するが、
  トグルをOFFにしてもラベルが「自動解答」に戻らない
- 自動解答中（盤面操作がブロックされる状態）にもかかわらず「自動でホームへ送る」
  チェックボックスを操作できてしまい、意味のないUIになっている

これらの不整合は `view.js: syncControls()` の導入(2026-08-20)で解消済みであり、
本ドキュメントは現在の実装と一致する「生きた仕様」として維持する。
「どの状態でどの操作が可能か」を表として明文化し、今後の変更の基準とする。

## 2. 状態定義

### 2.1 3層の状態モデル

ゲームの見かけ上の状態は、以下の3層の組合せで決まる。

| 層 | 責務 | 主な保持場所 | 代表的な値 |
| --- | --- | --- | --- |
| ゲーム状態 | 盤面と勝敗 | `src/js/game-state.js` | `won`, `stuck`, `historyStack`, `selected` |
| アプリ排他状態 | 手動操作のブロックと自動ホーム送り | `src/js/app.js` | `autoSolving`, `autoMoveEnabled` |
| ソルバー派生状態 | Worker計算と解答再生 | `src/js/solver-client.js` / `src/js/view.js` | `activeRequest` (`autoPlay` 真偽), `replayMoves`, `solverMode` |

### 2.2 ゲーム状態（正準状態）

`src/js/game-state.js` が所有する状態。

- **通常進行中** (`!won && !stuck`)
  - `historyStack.length === 0`（初手前）と `> 0` で Undo 可否が分かれる
  - `selected !== null` は一時的な選択状態だが、Enable/Disableには影響しない
- **詰み** (`stuck === true`, `!won`)
  - `hasAnyMove(state) === false` のとき `checkStuck()` が `stuck = true` にする
  - `undo()` で `stuck = false` に戻る
- **勝利** (`won === true`)
  - `isWon()`（全52枚が `foundations`）で `checkWin()` が `won = true` にする
  - 以降は `attemptMove()` が `reason: "finished"` で拒否される

タイマー（`app.js: timerStart / timerHandle`）は Enable/Disable に直接影響しない。
勝利時に停止されるのみである。

### 2.3 アプリ排他状態

`src/js/app.js` が所有する状態。

- `autoSolving: boolean`
  - `true` の間、`attemptMove()` / `undo()` / `autoMoveHome()` /
    `dblClickAutoMove()` がガードされ、`interactions.js: isBlocked()` が
    盤面操作を抑止する
  - `view.setAutoSolving()` で `#game.auto-solving` クラスが付与される
- `autoMoveEnabled: boolean`
  - 手動移動成功後の `chainAutoNext()` を実行するか否か
  - `solver-client.js: startAnimatedReplay()` 中は一時的に `false` にされる

### 2.4 ソルバー派生状態

`src/js/solver-client.js` と `src/js/view.js` の協調で決まる状態。

| 派生状態 | 条件 | `view.setSolverBusy()` の mode | ラベル表示 |
| --- | --- | --- | --- |
| アイドル | `!activeRequest && !autoSolving` | `null` | 自動解答 |
| ヒント計算中 | `activeRequest && !autoPlay` | `hint` | 変化なし |
| 自動解答 計算中 | `activeRequest && autoPlay` | `auto` | 計算中… → 高速探索中… / 安全探索中… |
| 自動解答 再生中 | `replayMoves !== null && autoSolving` | `auto`（`setSolverStage("replay")`） | 自動解答中… |

補足:

- ヒント計算中は `hint-btn` を `disabled` にし、自動解答トグルを `disabled` にする
  （`view.js: setSolverBusy()` の `hint` 分岐）
- 自動解答 計算中は `hint-btn` を `disabled` にするが、自動解答トグルは
  `disabled = false` のまま（OFFでキャンセル可能にする意図）
- 再生中は `activeRequest` は既に `null` だが `autoSolving` が `true` のまま残る

### 2.5 状態遷移図

```mermaid
graph TD
    Idle["アイドル（通常）<br/>!won && !stuck && !autoSolving"]
    Stuck["詰み<br/>stuck && !won"]
    Won["勝利<br/>won"]
    HintCalc["ヒント計算中<br/>activeRequest && !autoPlay"]
    AutoCalc["自動解答 計算中<br/>activeRequest && autoPlay"]
    Replay["自動解答 再生中<br/>replayMoves && autoSolving"]

    Idle -- 合法手なし --> Stuck
    Stuck -- undo --> Idle
    Idle -- 全52枚ホーム --> Won
    Idle -- ヒント押下 --> HintCalc
    HintCalc -- 完了/失敗 --> Idle
    Idle -- 自動解答ON --> AutoCalc
    AutoCalc -- 解あり --> Replay
    AutoCalc -- 解なし/エラー/キャンセル --> Idle
    Replay -- 全手再生/勝利/失敗/キャンセル --> Idle
    Won -- 新しいゲーム/やり直す/開始 --> Idle
    Stuck -- 新しいゲーム/やり直す/開始 --> Idle

    HintCalc -.->|"盤面は触れるが<br/>hint/autoトグルのみ制御"| Idle
    AutoCalc -.->|"盤面ブロック<br/>(autoSolving)"| Idle
    Replay -.->|"盤面ブロック<br/>(autoSolving)"| Idle
```

到達不能な組合せ:

- 勝利中にヒント/自動解答の計算・再生は開始しない（`boardSnapshot` 不一致で破棄される）
- 詰みと勝利は排他（`game-state.js: checkStuck()` は `won` なら詰みにしない）

## 3. コントロール一覧

`index.html` のツールバーと盤面・オーバーレイに存在する操作の一覧。
「現在の制御箇所」はコード上の `disabled` 制御やガードの位置を指す。

| ID / 領域 | 表示名 | 役割 | 現在の制御箇所 |
| --- | --- | --- | --- |
| `new-game-btn` | 新しいゲーム | ランダム番号で `startGame()` | `view.js: syncControls()` で `autoSolving` 時に `disabled` |
| `restart-btn` | やり直す | 同じ番号で `startGame(state.gameNumber)` | `view.js: syncControls()` で `autoSolving` 時に `disabled` |
| `undo-btn` | 元に戻す | `gameState.undo()` | `view.js: syncControls()` で `won \|\| !hasHistory \|\| autoSolving` 時に `disabled` |
| `auto-move-btn` | 自動移動 | `gameState.hasAutoMove()` があれば `chainAutoNext()` | `view.js: syncControls()` で `won \|\| autoSolving \|\| busyHint \|\| !hasAutoMove` 時に `disabled` |
| `hint-btn` | ヒント | `solverClient.requestSolution({autoPlay:false})` | `view.js: syncControls()` で `won \|\| busyHint \|\| busyAuto` 時に `disabled` |
| `auto-solve-toggle` | 自動解答 | ONで `requestSolution({autoPlay:true})`、OFFで `cancelAutoSolve()` | `view.js: syncControls()` で `won \|\| busyHint` 時に `disabled` |
| `auto-move-toggle` | 自動でホームへ送る | `autoMoveEnabled` を切替 | `view.js: syncControls()` で `won \|\| autoSolving` 時に `disabled` |
| `seed-input` | No. | ゲーム番号入力 | `view.js: syncControls()` で `autoSolving` 時に `disabled` |
| `start-game-btn` | 開始 | `normalizeGameNumber()` して `startGame()` | `view.js: syncControls()` で `autoSolving` 時に `disabled` |
| `#game` 盤面 | 盤面操作 | クリック / ドラッグ&ドロップ / ダブルクリック | `interactions.js: isBlocked()` と `app.js: attemptMove()` の `autoSolving` ガード、`game-state.js: attemptMove()` の `won` ガード |
| `#overlay` | オーバーレイ | 詰み/勝利の通知。背景クリックで閉じる | `view.js: showWin()` / `showStuck()` / `hideOverlay()` |
| `overlay-undo` | 1手戻す | 詰み時のみ表示される Undo | `view.js: showWin()` で `hidden`、 `showStuck()` で表示 |
| `overlay-new-game` | 新しいゲーム | オーバーレイ内の新規ゲーム | 制御なし |
| `solution-panel` | 解答手順パネル | 自動解答完了後に全手順を表示 | `view.js: showSolution()` / `hideSolution()` |

`move-counter` / `timer` は表示のみで操作対象外のため表から除外する。

## 4. 状態 × コントロール対応表

**凡例**: ◎ 有効 / × 無効（`disabled` または操作が拒否されるべき） / △ 条件付き

「あるべき姿」を示す。現状との差異は 5章で扱う。

### 4.1 ツールバー（主要ボタン）

| 状態 | 新しいゲーム | やり直す | 元に戻す | 自動移動 | ヒント | 自動解答トグル | 自動でホームへ送る |
| --- | --- | --- | --- | --- | --- | --- | --- |
| アイドル（通常・履歴なし） | ◎ | ◎ | × 履歴なし | △ 送れるカードがあれば◎ | ◎ | ◎ OFF | ◎ |
| アイドル（通常・履歴あり） | ◎ | ◎ | ◎ | △ 同上 | ◎ | ◎ OFF | ◎ |
| 詰み | ◎ | ◎ | ◎ | × 合法手なしのため | ◎ | ◎ OFF | ◎ |
| 勝利 | ◎ | ◎ | × `won` のため | × 完了済み | × 完了済み | × 完了済み | × 完了済み |
| ヒント計算中 | ◎ | ◎ | △ 履歴があれば◎ | × 計算中 | × 計算中 | × 計算中 | ◎ |
| 自動解答 計算中 | × 中断はトグルOFFで | × 同左 | × ブロック中 | × ブロック中 | × 計算中 | ◎ ON（OFFでキャンセル） | × ブロック中 |
| 自動解答 再生中 | × 中断はトグルOFFで | × 同左 | × ブロック中 | × ブロック中 | × 再生中 | ◎ ON（OFFでキャンセル） | × ブロック中 |

### 4.2 入力欄・盤面・オーバーレイ

| 状態 | No.入力 | 開始 | 盤面操作（クリック/ドラッグ/ダブルクリック） | オーバーレイ |
| --- | --- | --- | --- | --- |
| アイドル（通常・履歴なし） | ◎ | ◎ | ◎ | 非表示 |
| アイドル（通常・履歴あり） | ◎ | ◎ | ◎ | 非表示 |
| 詰み | ◎ | ◎ | × 詰み（合法手なし）だが盤面クリック自体は可能。移動は失敗する | 表示（詰み）・「1手戻す」◎ |
| 勝利 | ◎ | ◎ | × `won` のため拒否 | 表示（クリア）・「1手戻す」× |
| ヒント計算中 | ◎ | ◎ | ◎（ヒント計算は盤面をブロックしない） | 非表示 |
| 自動解答 計算中 | × ブロック中 | × ブロック中 | × `autoSolving` のためブロック | 非表示 |
| 自動解答 再生中 | × ブロック中 | × ブロック中 | × `autoSolving` のためブロック | 非表示 |

### 4.3 補足

- 「新しいゲーム」「やり直す」「開始」「No.入力」を自動解答中に × とする理由:
  現在の `main.js: clearSolutionOnNewGame` は新しいゲーム開始時に
  `cancelAutoSolve()` を呼ぶが、自動解答トグルがONのまま計算・再生が
  走っている間に新規ゲームを始めると `boardSnapshot` 不一致で破棄される
  競合が起きる。トグルOFFによる明示的な中断を経由させる方が一貫する。
- 詰み状態の盤面操作は「×」としたが、厳密には `hasAnyMove()===false` のため
  どの移動も失敗する。UI上は盤面クリック自体は受け付けるが結果が変わらない。
- 勝利状態の「自動でホームへ送る」は全カードがホームにあるため操作の意味がない。
  `disabled` にして意図を明示すべきである。
- ヒントのハイライト(`hint-source` / `hint-target`)は 10 秒で自動消去される
  (2026-08-21 追加)。手動操作(移動・Undo・自動解答開始・新規ゲーム)でも解除される。

## 5. 解決済みの不整合

以下は本ドキュメント作成時点で存在した不整合であり、`view.js: syncControls()` の
導入(2026-08-20)とその後の修正で解消済みである。履歴として残す。

### 5.1 自動解答トグルOFFでもラベルが「自動解答」に戻らない

| 項目 | 内容 |
| --- | --- |
| 現象 | 自動解答ON → 「計算中…」→「高速探索中…」→「自動解答中…」と遷移するが、トグルをOFFにしてもラベルが「自動解答」に戻らない場合がある |
| 解決 | `solver-client.js: finishAutoSolve()` / `cancelAutoSolve()` の全パスで `view.setSolverBusy(false, "auto")` を経由し、`label.dataset.prevText` を確実にクリアするよう修正。`setSolverBusy()` は `solverMode` を `null` に戻し、ラベルを「自動解答」へ復元する |
| 関連コード | `src/js/view.js: setSolverBusy()` / `setSolverStage()` / `solverMode` / `label.dataset.prevText`, `src/js/solver-client.js: cancelAutoSolve()` / `finishAutoSolve()` / `setBusy()` |

### 5.2 自動解答中に「自動でホームへ送る」を操作できてしまう

| 項目 | 内容 |
| --- | --- |
| 現象 | 自動解答中（`autoSolving===true`、盤面操作はブロック）に「自動でホームへ送る」チェックボックスをON/OFFできる。終了後に意図しない `autoMoveEnabled` が残る |
| 解決 | `view.js: syncControls()` が `autoSolving` 中に `auto-move-toggle` を `disabled` にする。`solver-client.js: startAnimatedReplay()` で `savedAutoMoveEnabled` に現在値を保存し、`finishAutoSolve()` で保存値へ復元する(`true` 固定にしない) |
| 関連コード | `src/js/solver-client.js: startAnimatedReplay()` / `finishAutoSolve()`、`src/js/view.js: syncControls()`、`src/js/app.js: setAutoMoveEnabled()` |

### 5.3 その他の一貫性の欠け(参考)

| 項目 | 現状 | 解決 |
| --- | --- | --- |
| `undo-btn` 以外のボタンの `disabled` 制御 | `view.js: updateStatus()` は `undo-btn` のみ制御していた | `syncControls()` が全ボタン・トグル・入力欄の `disabled` を一元管理するようになった |
| ヒント計算中の新規ゲーム操作 | 可能（`clearSolutionOnNewGame` でキャンセルされる） | 許容するが、計算中であることを示すために `hint-btn` は `disabled` のままにする(現状通り) |
| 詰み時の `auto-move-btn` | 有効だが押してもトースト「ホームへ移動できるカードはありません」 | `syncControls()` が `!hasAutoMove` 時に `disabled` にする(詰みなら `hasAutoMove()===false` が保証される) |

## 6. 推奨ポリシー

今後の修正で統一すべき Enable/Disable の原則。

1. **実行できない操作は `disabled` で示す**
   - `app.js` の早期returnだけでなく、`view.js` で `button.disabled = true` を付与する。
     見た目（`style.css: .controls button:disabled`）と操作可否を一致させる。

2. **排他状態ではトグルを `disabled` にする**
   - ヒント計算中は自動解答トグルを `disabled`
   - 自動解答 計算中・再生中は「自動でホームへ送る」トグルを `disabled`
   - 自動解答トグル自体は計算中・再生中に `disabled=false` を維持し、OFFでキャンセルできる唯一の手段とする

3. **盤面操作のブロックは `autoSolving` と `won` で一元化する**
   - `interactions.js: isBlocked()` と `app.js: attemptMove()` の `autoSolving` ガードを正とする
   - `won` は `game-state.js: attemptMove()` の `finished` ガードで拒否する

4. **ラベル表示は `solverMode` で厳密に管理する**
   - `solverMode` が `null` のときのみ「自動解答」
   - `auto` のときのみ「計算中…」「高速探索中…」「安全探索中…」「自動解答中…」を許可
   - `finishAutoSolve()` / `cancelAutoSolve()` の全パスで
     `setSolverBusy(false, "auto")` を経由し、`label.dataset.prevText` を
     確実にクリアする

5. **新規ゲーム系操作は自動解答中に `disabled` にする**
   - 「新しいゲーム」「やり直す」「開始」「No.入力」は自動解答 計算中・再生中に `disabled`
   - 中断したい場合は自動解答トグルOFFを経由させる

6. **自動ホーム送りの保存・復元を正確に行う**
   - `startAnimatedReplay()` で `savedAutoMoveEnabled = autoMoveEnabled` の現在値を保存
   - `finishAutoSolve()` / `cancelAutoSolve()` で保存値へ復元する（`true` 固定にしない）

## 7. 参考

- `src/js/game-state.js` — 状態遷移の正準実装
- `src/js/app.js` — `autoSolving` / `autoMoveEnabled` と操作ガード
- `src/js/view.js` —
  `syncControls()` / `setSolverBusy()` / `setSolverStage()` / `setAutoSolving()`
- `src/js/solver-client.js` —
  `requestSolution()` / `startAnimatedReplay()` / `finishAutoSolve()` /
  `cancelAutoSolve()`
- `src/js/main.js` — `clearSolutionOnNewGame` とイベント配線
- `src/js/interactions.js` — `isBlocked()` による盤面ブロック
- `index.html` — コントロールIDの一覧
- `AGENTS.md` — 品質チェック（`npm test` / markdownlint）の規約
