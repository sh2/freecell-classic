# 変更履歴

## 2026-08-19

### リファクタリング

- **fast 上限を 2M → 1M に縮小、safe 上限を 12M → 10M に縮小**
  （`src/js/solver.js`）。全32,000件を `fast 1M + safe改 10M adaptive(1.2→1.5)`
  で再計測し **31,999/32,000** を維持（`#11982` のみ node-limit、フォールバック23件、
  総ノード358,718,165 / 総時間646,333ms）。`safe` 10M でも `#10353:16,941` /
  `#13331:5,135,191` / `#17978:3,354,164` / `#1941:584,400` を余裕で解決
  （上限5Mでも同解決率だが10Mで余裕を確保）。適応閾値を `33%/83% → 50%/85%`
  （5M/8.5M）に変更し、`#17978`（w1.2で3.35M要する）が閾値直前で切り替わらないようにした。
- **fast の moveScore を最適化**（`src/js/solver.js`）。`nonEmpty`
  （空き列より既存列優先）加点を `5000 → 8000` に上げ、`safeFoundationMoves` で
  fast のみ適用（safe改は `1941` 等で空列生成が重要なため分離）。500件/1000件で
  A/B 計測し `fast 1-1000 total 10,686,877 → 10,082,983（-5.6%）`、
  `fast-safe 1-200 total 1,836,387 → 1,678,627（-8.5%）`。共通適用では
  `safe改 #10353` が `16,941 → 433,019` に悪化するため fast 専用化で回避。
- **safe 改(案B)へ統合 — fast + safe の二本構成に簡素化**（`src/js/solver.js` /
  `tests/unit/solver.test.js`）。旧三本構成 `fast 2M + safe 10M/w1.1 + safe2 2M/w1.5`
  を `fast 1M + safe改 10M/適応` の二本に統合した。`safe改` は単一 `solve` 内で
  `tailStartWeight` を 1.2 → 1.35 → 1.5 に段階的に上げる適応スケジュールで、
  固定 w1.1 は `#10353`/`#13331` が、固定 w1.5 は `#17978` が解けないトレードオフを
  解消する。外部は `fast`/`safe` の二本のみに見え、旧 `safe2` は `safeRetry:true`
  指定時のみ後方互換として動作する。単一探索内に統合したことで置換表の再利用も改善した。
  難関8件(旧 safe2 対象含む)は `safe改 10M` 単独で 8/8 解決を維持し、
  通常 1-200 の総ノードは `fast-safe` で1,678,627と改善。

### アーキテクチャ評価

- フェーズDを実施。最終ヒューリスティックで通常800ゲーム + 難関8ゲームを比較し、
  `fast` / `safe` / `fast-safe` の解決率・ノード数・時間を測定した。`safe` 単一モードは
  `fast-safe` より通常サンプルの総ノード数・総時間が大きく、解決率も改善しなかったため
  不採用とした。
- `fast-safe` の二段階構成を維持する。全32,000ゲームを現行ロジックで再計測し、
  **31,999/32,000 解決**（`node-limit` は `#11982` のみ）を確認した。
  旧ロジックの履歴値（31,974/32,000、`node-limit` 26件）から解決率が改善した。
- **safe2 再試行を追加**（`src/js/solver.js` / `src/js/view.js`）。safe が上限で打ち切られた
  ときに、より強いヒューリスティック（`tailStartWeight=1.5`、上限2M）で再試行する。
  これにより `#10353` / `#13331` が解決可能になった（`node-limit` 3件 → 1件）。
  既に safe で解けるゲームは safe2 に到達しないため挙動は不変。`options.safeRetry` で無効化可。
  ※本日後半に案Bで `safe改 12M/適応` に統合し、二本構成へ簡素化した。
- fast 上限の感度分析を実施（`scripts/benchmark/fast-cap-sensitivity.js`）。fast で解けるが
  safe では解けないゲーム（`#17978`）が存在するため、上限を 130万 未満に下げると解決率が
  下がる。解決率を維持するには上限 130万 以上が必要。上限 200万 → 150万 への変更を推奨するが、
  実際の効果は上限変更後の全32,000ゲーム再計測で確認する。
- 詳細な比較値と今後の課題は `docs/solver-insights-and-improvement-plan.md` §3.4.1–3.4.3 に記録。

### 性能改善

- フェーズB（1ノードあたりの処理速度向上）を実施(`src/js/solver.js` /
  `docs/solver-insights-and-improvement-plan.md` /
  `docs/benchmark/data/profile-*-after-b.cpuprofile`)。
  - 手を 32bit 整数にパックして move オブジェクトの生成を廃止。スコアは並列配列で管理し、
    `Array.prototype.sort` の比較器をやめて連動型の安定挿入ソートへ変更した。
    探索終了時にオブジェクト形式へアンパックして返すため API・UI・テストは不変。
  - `getStateHash()` を軽量化。`Array.from` + `Array.prototype.sort` をやめ、再利用バッファの
    安定挿入ソートへ変更（8列固定で比較は高々28回）。順序は従来と完全一致するため探索結果は不変。
  - 置換表の `tt.stats()` をカウンタ管理化し、容量 $2^{22}$ の配列全走査（1回 37〜46ms）を廃止。
  - `canPlace()` が候補ごとに再計算していた移動可能枚数上限を、`generateMoves()` の冒頭で
    移動先ごとに1回だけ計算する `maxMoveByDest` 配列へ変更し、重複走査を排除した。
  - 効果（探索ノード数は完全に同一で実行時間のみ短縮）:
    - #720 (fast): 1,297 ms → 約 794 ms（約1.6倍）
    - #14212 (safe): 9,235 ms → 約 4,890 ms（約1.9倍）
  - `getStateHash` のクラスタは #14212 で約41% → 9.75% に減少し、ボトルネックの主役が
    `generateMoves` へ移った。

### 探索効率改善

- フェーズC（探索ノード数削減）の対称性削減と置換表の置換方針を実施(`src/js/solver.js` /
  `docs/solver-insights-and-improvement-plan.md`)。
  - 空きフリーセルへの移動先を先頭スロットへ正規化。フリーセルはスロット番号を状態ハッシュが
    区別しないため、複数の空きスロットへ置く遷移は同値であり、先頭1スロットだけに限定した。
  - 列全体を空列へ移す自己対称手を除外。列順を正規化する状態表現では列ラベルの入れ替えに
    過ぎないため、移動前と同一状態になる分岐を生成しない。
  - 置換表の置換方針を改善。プローブ上限到達時、先頭スロットを無条件上書きするのをやめ、
    窓内で最も g が大きい（枝刈り価値が低い）エントリを置き換える（現負荷では overwrites=0 のため
    実測効果なし、高負荷時の防御）。
  - ノード数削減効果:
    - #720 (fast): 1,538,122 → 1,449,895（-5.7%）
    - #14212 (safe): 8,832,537 → 8,501,203（-3.8%）
    - #6240 / #3670 / #4016 (safe): 各 -3.9% / -7.7% / -4.7%
  - 検証: ゲーム1〜200 は 200/200 解決、難関ゲームも解決継続（#11982 は node-limit のまま）、
    単体 140 件・E2E 63 件すべて成功。

### 手順評価・ヒューリスティック改善

- フェーズC の A/B 比較により、`moveScore` とヒューリスティック $h$ を改善
  (`src/js/solver.js` / `docs/solver-insights-and-improvement-plan.md` /
  `scripts/benchmark/sample-bench.js`)。
  - `moveScore`: 露出カードが低ランク（rank ≤ 3）なら +6000 を加点。将来のホーム送り素材を
    早期に露出させることで探索を効率化。
  - $h$: `tailStart` の重みを1.1倍に変更。難関ゲームが1回の反復で解を見つけるようになり
    大幅に縮小、通常ゲームも効率が改善（固定サンプルでの A/B 比較で1.1倍が最良と判定。
    1.25倍以上は通常ゲームで逆効果、2倍では node-limit 発生のため不採用）。
  - 残余 cutoff の保存は「最初（最浅）の訪問で cutoff が既にルートへ伝播するため冗長」として
    見送り（計画書に根拠を記録）。
  - 効果:
    - 通常ゲーム1〜400: すべて解決。200ゲームあたり合計ノード約1.84M（ベースラインの
      約2.84M から約35%削減）。
    - 高速モード未解決26ゲーム: 25/26 解決（#11982 のみ node-limit）。**20ゲームが
      fast モードだけで解決**（従来 0 ゲーム）。**#26334 は従来未解決だったが fast で解決可能に**。
  - 検証: 単体 140 件・E2E 63 件すべて成功。markdownlint 診断クリア。

## 2026-08-18

### 性能計測

- フェーズA（CPUプロファイリングとボトルネック特定）を実施
  (`docs/solver-insights-and-improvement-plan.md` / `docs/benchmark/data/profile-*.cpuprofile`)。
  - `node --cpu-prof` で通常ゲーム（#720, fast）と難関ゲーム（#14212, safe, 8.8M nodes）の
    プロファイルを採取し、関数単位の自己時間を集計した。難関ゲームは安全モードで
    数百万ノードをスキャンする代表として選定（#3670 から差し替え）。
  - `getStateHash()` が最大のボトルネック（内部のソート比較器を含むクラスタ合計で
    通常 27% / 難関 41%）、`generateMoves()` が続く（クラスタ合計 通常 23% / 難関 19%）
    ことを定量化した。`moveScore()` は呼び出し最多だが約 1% と安価で、
    `tt.lookup()` / `tt.store()` も軽量（合計 0.7%）と判明した。
  - 詳細な数値・フェーズBへの示唆は計画書 §3.1.1 に記載。

### 機能追加

- ソルバーにプロファイリング用の呼び出し回数カウンタを追加(`src/js/solver.js`)。
  `options.trackCounters` が真のとき `stats.profile` に関数別の呼び出し回数
  （getStateHash / generateMoves / moveScore / movesGenerated /
  ttLookup / ttStore / makeMove / findHomeMove）を記録する。
  既定では無効で探索結果に影響しない。

### 開発ツール

- CPUプロファイリング用ドライバと解析スクリプトを追加
  (`scripts/benchmark/profile.js` / `scripts/benchmark/analyze-profile.js`)。
  - `profile.js`: 指定ゲーム・戦略でソルバーを実行し、ノード数・時間・置換表統計・
    呼び出し回数カウンタを表示する（`--cpu-prof` と組み合わせて使用）。
  - `analyze-profile.js`: `.cpuprofile` を関数単位の自己時間・総時間に集計して表示する。
    無名関数は「ファイル:行」単位で分離して集計する（`Array.sort` の比較コールバック等が
    1つに混ざらないように）。

## 2026-08-17

### 修正

- フェーズ4の全32,000ゲーム性能評価を完了(`docs/benchmark/data/` /
  `docs/benchmark/report.html` / `docs/benchmark/`)。`fast-safe` 戦略で31,974件を
  解決し、解決率99.919%となった。26件は高速・安全モードともに`node-limit`、
  `time-limit` と `unsolvable` は0件だった。`unsolvable` は64bit Zobrist衝突を
  無視した探索上の結果であり、数学的な完全証明ではない。

- フェーズ3レビュー指摘を反映(`src/js/solver.js` / `tests/unit/solver.test.js` /
  `docs/`)。両モードで安全化した逆手除外を有効化し、APIコメントへ
  `search-exhausted` と、64bit Zobrist衝突を無視した `unsolvable` の意味を追記した。
  逆手除外の有効・無効で小規模盤面の解決可能性が一致する回帰テストを追加し、
  ソルバー実装レポートの古い容量・ヒューリスティック・自動ホームの説明を更新した。

- フェーズ3の安全モード基盤を整理(`src/js/solver.js` / `tests/unit/solver.test.js`)。
  置換表は計算量とメモリ使用量を抑えるため64bit Zobristハッシュのみで状態を
  識別する方針に統一した。ハッシュ衝突は実用上無視するが、`unsolvable` は衝突が
  発生していないという仮定付きの探索結果であり、数学的な完全証明ではないことを
  文書化した。プローブ数、最大プローブ長、上書き数、負荷率の統計は維持した。

- ソルバーを二段階探索へ変更(`src/js/solver.js` / `src/js/solver.worker.js` /
  `src/js/solver-client.js` / `src/js/view.js` / `src/js/main.js`)。高速モード(200万ノード)
  で解けなかった場合、同じ開始盤面から安全モード(1,000万ノード)へフォールバックする。
  Workerの段階通知、探索中の表示、リクエストID、盤面スナップショット照合、キャンセルを
  追加し、古い盤面への解答適用を防止した。

- 二段階探索結果の集計を修正(`src/js/solver.js` / `tests/unit/solver.test.js`)。
  `totalTimeMs` を各段の探索時間の合計として算出し、安全モード単独実行を
  `fallbackUsed` と誤認しないようにした。未知の戦略値はエラーとして拒否する。

- フェーズ2のテスト・計測基盤を追加(`tests/unit/solver.test.js` /
  `tests/e2e/freecell.spec.js` / `scripts/benchmark/` / `docs/benchmark/README.md`)。
  Workerの段階通知を単体・E2Eで検証し、ベンチマークを `fast` / `safe` /
  `fast-safe` 戦略、段別設定、フォールバック率、追加解決数、合計ノード・時間の
  記録とレポート表示に対応した。

- ソルバーに自動ホーム方式の切替と探索カウンターを追加
  (`src/js/solver.js` / `scripts/benchmark/run.js`)。安全条件付き方式と無条件自動ホーム
  方式を比較できる `safeFoundationMoves` / `--unsafe-home` を追加し、安全でないホーム
  手の生成・試行・解決到達・行き止まり、置換表ヒット数、探索深度などを結果へ記録する。

- ソルバーの自動ホーム移動に Horne's Rule に基づく安全条件を追加
  (`src/js/solver.js` / `tests/unit/solver.test.js`)。A は常に自動移動し、低ランクの
  カードは反対色スートの土台が必要な位置まで進んだ場合だけ自動移動する。安全でない
  合法なホーム移動は探索分岐として残し、解を取りこぼさないようにした。

- ソルバーの経過時間測定を `Date.now()` から `performance.now()` へ変更
  (`src/js/solver.js`)。VirtualBox Guest Additions などによるシステム時刻の補正で
  測定時間が逆行する問題を防ぎ、時間上限判定と `timeMs` の測定を単調増加タイマーに
  統一した。

- ソルバーの列正規化キーを修正(`src/js/solver.js` / `tests/unit/solver.test.js`)。
  - 従来の全列カードを位置ごとに XOR する方式では列の境界を失い、異なる列構成を
    同一状態として置換表で誤って枝刈りする可能性があった。
  - 列ごとのハッシュを計算してソート後に結合する方式へ変更し、列の順序だけを
    正規化しつつ、列境界と列内順序を保持するようにした。
  - 列順序の同一視、列境界、列内順序を検証する単体テストを追加した。

### 開発ツール

- node-limit ゲームの再検証スクリプトを追加(`scripts/benchmark/verify-node-limit.js`)。
  - 既存バッチ結果(`batch-XX.json`)で `status` が `node-limit` のゲームだけを、
    より大きい `maxNodes` で再計測して比較する。バッチ進捗には影響しない。
  - 結果は `docs/benchmark/data/verify-node-limit-<batch>-<maxNodes>.json` に保存。
  - バッチ 1 (ゲーム 1〜1000) の node-limit 134 ゲームを `maxNodes=5,000,000` で
    再検証した結果、**37 ゲームが solved に、97 ゲームは node-limit のまま**だった
    (time-limit / unsolvable は 0)。結果は
    `docs/benchmark/data/verify-node-limit-01-5000000.json` に記録。

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

- フリーセルソルバーを追加(`src/js/solver.js` / `src/js/solver.worker.js` /
  `src/js/solver-client.js` / `src/js/view.js` / `src/js/main.js` /
  `index.html` / `src/css/style.css`)。
  - IDA\*(反復深化 A\*) + 自動ホーム + Zobrist ハッシュの置換表による探索。
    盤面はカード id の配列で受け取り、勝ち手順(移動のリスト)を返す。
    ホームへの移動は常に安全なため、分岐ではなく決定的な自動ホームとして
    必ず適用して状態空間を削減する。
  - ツールバーに「ヒント」「自動解答」ボタンを追加。解答は Web Worker で
    実行して画面をブロックせず、結果は「解答手順」パネルに一覧表示する。
    「自動解答」は手順を 1 手ずつ再生してクリアまで進める。
  - 探索はノード数・時間の上限で打ち切り、解けなかった場合はトーストで
    通知する(完全な「解けない」証明は行わず、上限到達として報告する)。

### 性能改善

- ソルバーの探索性能を改善(`src/js/solver.js` / `tests/unit/solver.test.js`)。
  - Zobrist ハッシュの列ハッシュを「列内の位置」だけで決める方式に変更し、
    列の並び順が違うだけの同一局面を同一ハッシュへ帰着させた(列の対称性の
    正規化)。置換表のヒット率が上がり、Game #12 はノード上限(200 万)で
    解けなかった状態から、約 7.2 万ノード / 約 0.14 秒で解けるようになった。
  - 手の試行順を改善。移動で露出するカードが自動ホーム対象になる手と、
    空き列を作る手の重みを引き上げた。
  - 空列への移動手は先頭の空列 1 つに正規化し、重複生成を排除した。
  - 置換表の容量を 2^21 → 2^22 スロットへ引き上げた。
  - 状態空間が縮小したことで、解けない小さい盤面は全状態を探索し尽くして
    `unsolvable`(解けない証明)を返すようになった。テストを追従更新した。

### 修正

- ツールバーのボタン構成を整理(`index.html` / `src/js/app.js`)。
  - 旧「新しいゲーム」(No.入力欄の値で開始)と「ランダム」を統合し、
    「新しいゲーム」を「ランダムな新規ゲーム」に統一。オーバーレイの
    「新しいゲーム」と同じ動作になった。
  - No.入力欄の横に「開始」ボタン(`#start-game-btn`)を追加。番号指定開始は
    Enter でも従来どおり可能。

### 開発ツール

- ソルバーベンチマークの測定ハーネスを追加(`scripts/benchmark/run.js` /
  `scripts/benchmark/report.js` / `docs/benchmark/` / `package.json`)。
  - ゲーム番号 1〜32,000 を 1,000 ゲームずつバッチで**シリアル**計測する。
    `dealGame()` で盤面を生成し、`solve()` を直接呼んで `status` / `nodes` /
    `timeMs` / `moves` 数を記録する。
  - 結果は `docs/benchmark/data/batch-XX.json` に保存。途中経過は
    `batch-XX.partial.json` に毎ゲーム書き出し、中断・再開に対応。
  - `--start` / `--count` で指定範囲も計測可能 (`range-*.json`。バッチ進捗に
    影響しない)。
  - `npm run benchmark:report` で、計測結果を自己完結型 HTML
    (`docs/benchmark/report.html`) にまとめる。サマリ / 状態別内訳 /
    バッチ進捗 / 応答時間・ノード数のヒストグラム(対数ビン)/ ゲーム別結果
    (状態フィルタ・列ソート・ページング)を表示。

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
