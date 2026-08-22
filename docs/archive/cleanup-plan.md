# コードベース整理・メンテナンス性改善計画

> 対応状況: フェーズ 0〜5 完了(2026-08-22)。実施後は本ドキュメントの各チェックボックスを更新し、
> ソースを変更した場合は [CHANGELOG.md](../CHANGELOG.md) へ追記する。

## 1. 目的と方針

アドホックな機能追加を繰り返した結果、使われなくなった関数・フラグ・後方互換コードや、ドキュメント・計測データなどの非コード資産が蓄積してきた。今後のメンテナンスコストを下げるため、以下を目的とする。

- 未使用の関数・フラグ・エクスポート・後方互換コードを特定して削除する。
- 非コード資産(実験スクリプト・計測データ・古いドキュメント参照)を棚卸しして整理する。
- 挙動(機能・UI・操作)は**変更しない**。見た目と操作感は現状を維持する。

方針は次のとおり。

1. **挙動を変えない**ことを最優先にする。リファクタリングは機械的に安全なものに限定し、挙動が変わる変更は行わない。
2. **テストで守りながら進める**。各フェーズ完了ごとに `npm run test:unit` を
   実行し、フェーズの最後に `npm test`(単体 + E2E)で全件成功を確認する。
3. **小さく分けてコミットする**。1 コミット = 1 関心事とし、失敗時に戻しやすくする。
4. **判断が必要な項目(計測データの圧縮など)は選択肢を提示し、既定案を明記**する。実施前に合意を取る。

## 2. 現状調査の結果(整理対象の一覧)

調査は 2026-08-22 時点の `src/js/*.js` / `tests/` / `scripts/` / `docs/` を対象に行った。分類と根拠を以下に示す。

### 2.1 明確なデッドコード(削除してよいもの)

| # | 対象 | 位置 | 根拠(使用状況) |
| --- | --- | --- | --- |
| D1 | `autoMoveHome()`(バッチ版) | `src/js/game-state.js` | 本体は未使用。`app.js` は `autoMoveOne()` を 1 枚ずつ連鎖させる方式へ移行済み。単体テストのみが呼ぶ |
| D2 | `solutionPanelEl()` | `src/js/view.js` | 返り値オブジェクトに含まれるだけで呼び出し元なし |
| D3 | テスト API の `requestSolution` / `replaySolution` / `hasSolverSolution` / `isAutoSolving` / `cancelAutoSolve` | `src/js/main.js: getTestApi()` | E2E テストから未使用(ソルバー系 E2E は UI 操作 + MockWorker で検証) |
| D4 | `replaySolution()`(旧 API 互換の即時再生) | `src/js/solver-client.js` | 上記テスト API 経由のみで未使用 |
| D5 | `hasSolution()` | `src/js/solver-client.js` | 上記テスト API 経由のみで未使用(`clearSolution()` は `main.js` で使用中のため残す) |
| D6 | `SOLVER_PROFILES.safeRetry` + `solveWithFallback()` の `safeRetry` / `safeRetryOptions` + `attempts.safe2` | `src/js/solver.js` | 旧三本構成の後方互換。既定は無効で、単体テスト以外に通るパスなし |
| D7 | ワーカーメッセージの `fastOptions` / `safeOptions` 受け取り | `src/js/solver.worker.js` | `solver-client.js` は `type` / `requestId` / `board` / `strategy` しか送らないため常に undefined |
| D8 | 常に真になる防御的 `typeof` チェック | `src/js/main.js`、`src/js/solver-client.js` | `typeof solverClient.cancelAutoSolve === "function"` など。対象は常に定義されるため不要 |

### 2.2 エクスポート過多(非公開化してよいもの)

| # | 対象 | 位置 | 根拠 |
| --- | --- | --- | --- |
| E1 | `findAutoMoveCard()` | `src/js/game-state.js` | `autoMoveOne()` / `hasAutoMove()` 内部からのみ使用。単体テストからも未 import |
| E2 | `makeCardEl()` | `src/js/view.js` | モジュール内部のみで使用。返り値オブジェクトに含める必要なし |
| E3 | `newRandomGame()` | `src/js/app.js` | `mount()` 内からのみ使用。返り値オブジェクトに含める必要なし(単体テストは使わない) |
| E4 | `foundationRank()` / `isWon()` | `src/js/rules.js` / `src/js/game-state.js` | 内部利用 + 単体テストからの直接 import のみ。削除はしないが、公開範囲を見直す(5.3 参照) |

### 2.3 構造の複雑さ(低優先のリファクタリング候補)

| # | 対象 | 位置 | 内容 |
| --- | --- | --- | --- |
| S1 | `cancelAutoSolve()` の分岐 | `src/js/solver-client.js` | 到達しない「保険」分岐と `cancel()` との重複。状態遷移(autoSolving × activeRequest × 再生中)の整理で簡素化できる |
| S2 | `syncControls()` 周りの状態変数 | `src/js/view.js` | `_lastState` / `_autoSolvingFlag` / `_solverBusyFlag` / `solverMode` の 4 変数が分散。命名・集約の改善余地 |
| S3 | `stats.unsafeHome*` カウンタ群 | `src/js/solver.js` | 探索検証用の統計。UI では不使用。ベンチマーク・プロファイリングで参照するため残置判断 |

### 2.4 テストの整理

| # | 対象 | 位置 | 内容 |
| --- | --- | --- | --- |
| T1 | `autoMoveHome`(バッチ版)のテスト群 | `tests/unit/game-state.test.js` | D1 削除時に合わせて削除。連鎖方式のテスト(`autoMoveOne`)は残る |
| T2 | `safeRetry` 後方互換のテスト | `tests/unit/solver.test.js` | D6 削除時に合わせて削除 |
| T3 | スモークテスト | `tests/unit/smoke.test.js` | 「Vitest が動作する」だけの Phase 1 名残。他テストが充実したため削除候補(保守的に残してもよい) |

### 2.5 非コード資産の棚卸し

| # | 対象 | 位置 | 現状 |
| --- | --- | --- | --- |
| A1 | ドキュメントリンクの古いパス | `README.md` | `docs/ui-state-matrix.md` / `docs/solver-insights-and-improvement-plan.md` を参照するが、実体は `docs/archive/` 配下 |
| A2 | コメント内の古いパス参照 | `src/js/view.js` | `syncControls()` のコメントが `docs/ui-state-matrix.md 4章` を参照(実体は `docs/archive/`) |
| A3 | UI 状態表の陳腐化 | `docs/archive/ui-state-matrix.md` | 「生きた仕様」(実装の根拠)だが archive に置かれ、5 章「既知の不整合」と 7 章「今後の修正方針」は実装済み。ヒント 10 秒自動消去(2026-08-21)も未反映 |
| A4 | 実験スクリプト 4 本 | `scripts/benchmark/`(`profile.js`、`analyze-profile.js`、`sample-bench.js`、`fast-cap-sensitivity.js`) | npm スクリプト未登録・`docs/benchmark/README.md` 未記載のワンオフ実験ツール(フェーズ A〜D の遺物) |
| A5 | 計測データの重量 | `docs/benchmark/data/`(約 29 MB)と `docs/benchmark/report.html`(約 4.5 MB) | 全 32,000 ゲームの計測結果がコミット済み。`report.html` はデータ埋め込み済みで自己完結 |
| A6 | 歴史的コメント | `.github/workflows/deploy-pages.yml` | 削除済み `game.js` への言及が残る |

## 3. 実施フェーズ

優先度順に 5 フェーズ + 任意の 1 フェーズで構成する。各タスクは独立しており、前のフェーズが完了しなくても安全なものから着手できる。

### フェーズ 0: ベースラインの確認

- [x] `npm test` を実行し、現状の全テストが成功することを確認する。
- [x] ブラウザで手動確認し、現在の見た目・操作感を記録しておく(回帰確認の基準)。

#### 実施記録(2026-08-22)

- `npm test` 成功: 単体 142 件(6 ファイル)+ E2E 65 件。
- ブラウザ手動確認(HTTP サーバー 8377 で配信、ゲーム番号 25702 / 12 / 7882):
  - 初期配布: 52 枚(7,7,7,7,6,6,6,6)、手数 0、タイマー停止、オーバーレイ非表示。
  - クリック選択 → クリック移動: 選択(zone/index/cardIndex)と移動(手数 1、選択解除)が正常。
  - タイマー: 初手成功後に開始(0:03 表示)。
  - アンドゥ: 盤面復元(手数 0、履歴クリア)。
  - 新しいゲーム / ゲーム番号指定: #12 開始、ランダム #7882 開始、入力欄が同期。
  - ヒント: 移動元・移動先ハイライト + トースト「ヒント: ♦6 → 列8」。
  - 自動解答トグル: ON でラベル「自動解答中…」、OFF で「自動解答」へ復元(キャンセル)。
  - ドラッグ&ドロップ: カード 49 をフリーセルへ移動(手数 2、選択解除)。
- 回帰確認の基準: 上記の操作結果(状態遷移・表示)をフェーズ 1〜5 の前後で比較する。

### フェーズ 1: デッドコード削除(低リスク)

このフェーズは挙動に影響しない機械的な削除のみを行う。

- [x] **D2** `view.js` の `solutionPanelEl()` を削除する。
- [x] **D8** 常に真になる `typeof` チェックを削除する(`main.js` の
  `typeof solverClient.cancelAutoSolve === "function"` など)。
- [x] **D3 + D4 + D5** `main.js: getTestApi()` から未使用の 5 エントリ
  (`requestSolution` / `replaySolution` / `hasSolverSolution` /
  `isAutoSolving` / `cancelAutoSolve`)を削除し、`solver-client.js` の
  `replaySolution()` と `hasSolution()` を削除する。
- [x] **D1 + T1** `game-state.js` の `autoMoveHome()`(バッチ版)を削除し、
  `tests/unit/game-state.test.js` の対応テスト群を削除する。
- [x] **D7** `solver.worker.js` の `fastOptions` / `safeOptions` 受け取りを
  削除する(メッセージ契約を `type` / `requestId` / `board` / `strategy`
  に明示)。

**検証**: `npm run test:unit` → `npm test`(E2E 含む全件成功)。

#### 実施記録(2026-08-22)

- 上記 5 項目をすべて実施。`npm test` 成功(単体 137 / E2E 65)。
- 追加の帰結として、`replaySolution()` 専用だった `applyMove()`(solver-client)と、
  `applyMoveAnimated()` 内の `typeof` フォールバック削除により未使用になった
  `applyMoveInstant()`(app.js)も削除した。
- 変更内容は [CHANGELOG.md](../CHANGELOG.md) の 2026-08-22「### リファクタリング」
  に追記済み。

### フェーズ 2: ソルバーの legacy オプション整理

- [x] **D6 + T2** `solver.js` から `SOLVER_PROFILES.safeRetry` を削除し、
  `solveWithFallback()` の `safeRetry` / `safeRetryOptions` オプションと
  `attempts.safe2` を削除する。`fast + safe` の二本構成に一本化する。
- [x] `tests/unit/solver.test.js` の `safeRetry` テスト(「safe が失敗したら safe2 で再試行する」など)を削除し、「既定では二本構成」のテストへ統合する。
- [x] 戻り値の `attempts` を `{ fast, safe }` の 2 キーに限定する。
- [x] `docs/benchmark/report.js` が `attempts` を汎用に扱っていることを
  確認し、キー変更の影響がないことを確認する(過去データの `safe2` キーは
  表示上無視されるだけで破綻しない)。

**検証**: `npm run test:unit`。必要に応じて `sample-bench.js` で少数ゲームのソルバー動作を確認する。

#### 実施記録(2026-08-22)

- 上記 4 項目をすべて実施。`npm test` 成功(単体 135 / E2E 65)。
- `sample-bench.js --games 1,2,3` でソルバー動作を確認(3/3 解決)。
- `report.js` は `attempts` を生データとして埋め込むだけ(`r.attempts || null`)
  で、`safe2` キーに依存しないことを確認。過去データの `safe2` キーは表示に
  影響しない。
- 変更内容は [CHANGELOG.md](../CHANGELOG.md) の 2026-08-22「### リファクタリング」
  に追記済み。

### フェーズ 3: スクリプトと非コード資産の整理

- [x] **A4** `scripts/benchmark/` の実験スクリプトを整理する(既定案)。
  - `sample-bench.js`: **残す**。変更前後の A/B 比較に有用。`docs/benchmark/README.md` の「構成」表へ追記する。
  - `profile.js` + `analyze-profile.js`: **残す**。プロファイリングのペア
    として `docs/benchmark/README.md` へ 1 行ずつ追記する(次回のソルバー
    高速化時に使う)。
  - `fast-cap-sensitivity.js`: **削除**。完了済みの 32,000 ゲーム評価に対するワンオフ解析のため(git 履歴に残る)。
- [x] **A6** `deploy-pages.yml` の `game.js` コメントを現状に合わせて書き換える(または削除する)。
- [x] **A5** 計測データの扱いを決める(4.1 の選択肢から選択)。既定は「現状維持」を提案するが、リポジトリ軽量化を優先する場合は gzip 圧縮案を採用する。

**検証**: `npm run benchmark:report` が成功すること(データ変更時のみ)。
`node scripts/benchmark/sample-bench.js --games 1,2,3` でソルバーが動くこと。

#### 実施記録(2026-08-22)

- **A4**: `fast-cap-sensitivity.js` を削除。`sample-bench.js` / `profile.js` /
  `analyze-profile.js` を `docs/benchmark/README.md` の「構成」表と新設の
  「補助スクリプト」節へ追記(使い方つき)。
- **A6**: `deploy-pages.yml` の `game.js` への言及を現状に合わせて整理。
- **A5**: 計測データは**現状維持**(4.1 の案 A)を採用。`npm run benchmark:report`
  で 32,000 ゲームすべて読み込めることを確認。`report.html` は再生成され、
  生成時刻の更新と、既に存在しない範囲データ行の削除のみの差分。
- 検証: `npm run benchmark:report` 成功、`sample-bench.js --games 1,2,3` で
  3/3 解決。
- 変更内容は [CHANGELOG.md](../CHANGELOG.md) の 2026-08-22「### リファクタリング」
  に追記済み。

### フェーズ 4: ドキュメントの整合

- [x] **A1** `README.md` の「ドキュメント」セクションのリンクを実体のある
  `docs/archive/` 配下へ修正する(または 4.2 で `ui-state-matrix.md` を
  `docs/` へ戻す場合はそのリンクに合わせる)。
- [x] **A2** `view.js: syncControls()` のコメントのパス参照を修正する。
- [x] **A3** `docs/archive/ui-state-matrix.md` を「生きた仕様」として `docs/` 直下へ戻す(既定案)。
  - 5 章「既知の不整合」を「解決済み」に書き換える(`syncControls()` 実装で解消)。
  - 7 章「今後の修正方針」を削除し、現状の実装と表が一致していることを確認する。
  - ヒントの 10 秒自動消去(2026-08-21)を状態表に反映する。
  - `README.md` と `view.js` のリンクを `docs/ui-state-matrix.md` に戻す。
- [x] 変更した Markdown ファイルの markdownlint 診断を確認し、指摘を解消する。

**検証**: `npm test` は不要(コード変更なし)。ただし `view.js` を触る場合は `npm run test:unit` を実行する。

#### 実施記録(2026-08-22)

- **A3**: `docs/archive/ui-state-matrix.md` を `docs/ui-state-matrix.md` へ移動。
  1 章(目的)を「不整合は解消済み・生きた仕様」に更新。3 章の「現在の制御箇所」を
  `syncControls()` 実装に合わせて更新。4.3 にヒント 10 秒自動消去を追記。
  5 章を「解決済みの不整合」に書き換え、7 章「今後の修正方針」を削除。
  参考節の `updateStatus()` を `syncControls()` に更新。
- **A1**: `README.md` のソルバー改善記録リンクを `docs/archive/` 配下へ修正。
  `ui-state-matrix.md` のリンクはファイル移動により正しくなった。
- **A2**: `view.js` のコメント参照先(`docs/ui-state-matrix.md`)はファイル移動で
  正しくなったため、コード変更は不要。
- markdownlint 診断はすべてクリア。
- 変更内容は [CHANGELOG.md](../CHANGELOG.md) の 2026-08-22「### リファクタリング」
  に追記済み。

### フェーズ 5(任意): 構造改善リファクタリング

挙動を変えない範囲で、保守性をさらに高めたい場合に実施する。テストが充実しているため安全に行えるが、効果とリスクのバランスを見て判断する。

- [x] **S1** `solver-client.js` の `cancelAutoSolve()` / `cancel()` を、
  状態遷移(計算中 / 再生中 / 停止)を明示的にモデル化して簡素化する。
- [x] **S2** `view.js` の `syncControls()` 周りの 4 変数を 1 つの状態オブジェクトへ集約する。
- [x] **E1〜E4** 内部利用のみの関数のエクスポートを見直す(削除はせず、
  非公開化できるものを export から外す。ただし単体テストが直接 import
  しているものはテスト側も合わせて調整する)。
- [x] **T3** `tests/unit/smoke.test.js` を削除するか判断する。

**検証**: `npm test`(全件成功)+ ブラウザでの手動確認。

#### 実施記録(2026-08-22)

- **S1**: `cancelAutoSolve()` から到達しない「保険」分岐と重複したトグル OFF
  処理を削除し、`cancel()` は `activeRequest.autoPlay=true ⟹ autoSolving=true`
  の不変条件から `wasAuto` 判定を廃止して mode を `"hint"` に固定。未使用の
  `cancelReplay()` も削除。
- **S2**: `_lastState` / `_autoSolvingFlag` / `_solverBusyFlag` / `solverMode` を
  1 つの `controlsState` オブジェクトへ集約。
- **E1〜E3**: `findAutoMoveCard()`(game-state)を非公開化し、`makeCardEl()`(view) /
  `newRandomGame()`(app)を返り値オブジェクトから除外。
- **E4**: `foundationRank()` / `isWon()` は単体テストが直接 import する純粋関数
  のため、5.3 の方針どおり公開を維持(削除しない)。
- **T3**: `tests/unit/smoke.test.js` を削除(単体テスト 134 件が存在するため冗長)。
- 検証: `npm test`(単体 134 / E2E 65)がすべて成功。ブラウザで手動確認
  (初期コントロール状態・自動解答トグル ON/OFF・ヒント・新規ゲーム・移動)。
- 変更内容は [CHANGELOG.md](../CHANGELOG.md) の 2026-08-22「### リファクタリング」
  に追記済み。

## 4. 判断が必要な項目

### 4.1 計測データ(約 29 MB)の扱い

| 案 | 内容 | 長所 | 短所 | 推奨 |
| --- | --- | --- | --- | --- |
| A | 現状維持 | 再解析・`verify-node-limit.js` がそのまま使える | リポジトリが重い(git clone に時間) | まずはこれで問題なしと判断 |
| B | gzip 圧縮(`.json.gz`)化 | 約 1/10 に軽量化 | `report.js` / `run.js` / `verify-node-limit.js` の読み書きを gzip 対応する必要がある | 軽量化を優先する場合 |
| C | 生データを GitHub Releases などへ退避 | リポジトリ最小化 | 再解析のたびにダウンロードが必要。運用コスト増 | 非推奨 |

既定は **案 A(現状維持)** を提案する。計測データは将来のソルバー改善の再検証に使うため、削除せず保持する。リポジトリ重量が問題になる場合は案 B を検討する。

### 4.2 UI 状態表の配置

`docs/archive/ui-state-matrix.md` は「完了した計画」ではなく、`view.js` の
`syncControls()` 実装の根拠となる「生きた仕様」である。したがって既定では
`docs/` 直下へ戻し、陳腐化した 5 章・7 章を更新する(フェーズ 4)。archive の
まま残す場合は、`README.md` と `view.js` のリンクを `docs/archive/` へ修正する
だけに留める。

## 5. 実施上の注意

### 5.1 コミットの粒度

各フェーズ内のチェックボックス単位でコミットする。削除系は「削除」と「テスト更新」を同時にコミットし、途中状態で `npm test` が失敗しないようにする。

### 5.2 AGENTS.md の遵守

- 制御文(`if` / `else` / `for` / `while`)は必ずブロック `{}` を使う。
- ソース(`index.html`、`src/**`)を変更した場合は `CHANGELOG.md` へ追記する。
- ユーザー向けの挙動が変わる場合は `README.md` の「機能」「技術構成」も更新する(本計画の変更は挙動を変えないため、原則該当しない)。

### 5.3 エクスポートの扱い

単体テストが直接 import している関数(`foundationRank()` / `isWon()` /
`canonicalizeColumns()` など)は、削除するとテストが壊れる。これらは
「公開しても害がない純粋関数」として残すか、テスト側を「内部関数を直接
テストしない」方針に変えるかを、フェーズ 5 で判断する。フェーズ 1〜2 では
削除しない。

## 6. 完了条件

- [x] フェーズ 0〜4 が完了し、`npm test`(単体 + E2E)が全件成功する。
- [x] フェーズ 5(任意)実施時は、さらにブラウザでの手動確認を完了する。
- [x] 削除・整理した項目が `CHANGELOG.md` に「### リファクタリング」として追記されている。
- [x] `docs/` の Markdown に markdownlint 診断が残っていない。
