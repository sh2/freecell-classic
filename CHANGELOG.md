# 変更履歴

## 2026-08-08

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
