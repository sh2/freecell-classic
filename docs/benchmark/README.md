# ソルバーベンチマーク (docs/benchmark)

ソルバー (`src/js/solver.js`) の性能を、ゲーム番号 1〜32,000 の全配布に対して
測定するためのハーネスです。ハードウェアの制約により、計測は**シリアル**
(並列化なし) で行います。

## 構成

| パス | 説明 |
| --- | --- |
| `scripts/benchmark/run.js` | 計測スクリプト (シリアル実行) |
| `scripts/benchmark/report.js` | HTML レポート生成スクリプト |
| `scripts/benchmark/verify-node-limit.js` | node-limit ゲームの再検証スクリプト (戦略指定対応) |
| `docs/benchmark/data/batch-XX.json` | バッチ (1,000 ゲーム) ごとの計測結果 |
| `docs/benchmark/data/batch-XX.partial.json` | 途中経過 (中断・再開用) |
| `docs/benchmark/data/range-S-E.json` | `--start` で指定した範囲の計測結果 |
| `docs/benchmark/data/verify-node-limit-B-N.json` | node-limit ゲームの再検証結果 |
| `docs/benchmark/report.html` | 生成される HTML レポート |

## 使い方

```sh
# 次の未計測バッチ (1,000 ゲーム) を計測
npm run benchmark

# 特定バッチを計測 (例: バッチ 3 = ゲーム 2001〜3000)
node scripts/benchmark/run.js --batch 3

# 残り全バッチを順に計測 (シリアル。時間がかかります)
npm run benchmark:all

# 特定ゲーム範囲を追加計測 (バッチ進捗に影響しない)
node scripts/benchmark/run.js --start 11982 --count 1

# 二段階計測 (既定: fast-safe)
node scripts/benchmark/run.js --strategy fast-safe

# 単独モードの計測
node scripts/benchmark/run.js --strategy fast
node scripts/benchmark/run.js --strategy safe

# モード別の計測上限を指定
node scripts/benchmark/run.js --fast-max-nodes 1000000 --safe-max-nodes 5000000 \
  --fast-max-time-ms 10000 --safe-max-time-ms 60000

# 両モードへ同じ上限を適用する互換オプション
node scripts/benchmark/run.js --max-nodes 1000000 --max-time-ms 10000

# 計測済みでも再計測
node scripts/benchmark/run.js --batch 1 --force

# レポート生成 (データを HTML にまとめる)
npm run benchmark:report
```

## node-limit ゲームの再検証

バッチ結果で `node-limit` になったゲームだけを、より大きい `maxNodes` で
再計測して「上限を上げたら解けるか」を確認できます。バッチ進捗には影響しません。

```sh
# バッチ 1 の node-limit ゲームを maxNodes=5,000,000 で再計測
node scripts/benchmark/verify-node-limit.js --batch 1 --max-nodes 5000000

# 入力ファイル・時間上限を明示
node scripts/benchmark/verify-node-limit.js \
  --input batch-01.json --max-nodes 5000000 --max-time-ms 600000

# 高速未解決ゲームを二段階戦略で再検証
node scripts/benchmark/verify-node-limit.js \
  --input batch-01.json --strategy fast-safe --max-nodes 5000000
```

結果は `docs/benchmark/data/verify-node-limit-<batch>-<maxNodes>.json` に保存され、
各ゲームの再計測結果と元の結果 (`orig`) が対比されます。

### バッチ 1 の検証結果 (2026-08-17)

バッチ 1 (ゲーム 1〜1000) で `node-limit` になった **134 ゲーム**を
`maxNodes=5,000,000` (時間上限 600,000ms) で再計測しました。

| 結果 | 件数 |
| --- | --- |
| solved (解けた) | **37** |
| node-limit (5M でも上限到達) | **97** |
| time-limit | 0 |
| unsolvable | 0 |

- solved になった 37 件の探索ノード数は 約 204 万〜496 万 (中央値 約 272 万)。
  うち 15 件は 2M から 100 万ノード以上追加で解けた。
- 5M でも node-limit のままの 97 件は、いずれも 5,000,000 ノードちょうどで
  打ち切られており、上限をさらに上げても解ける保証はありません。
- 詳細は `docs/benchmark/data/verify-node-limit-01-5000000.json` を参照。

計測は 1 バッチ 1,000 ゲーム単位です。`npm run benchmark` を繰り返すと
32,000 ゲーム (32 バッチ) まで進みます。バッチ実行中に中断しても、
次回は `batch-XX.partial.json` から自動で再開します。

## レポートの見方

`report.html` は自己完結型 (データを HTML 内に埋め込み) のため、ブラウザで
そのまま開けます。内容:

- **サマリカード**: 計測済み / 解決数 / 成功率 / 応答時間・ノード数の中央値
- **状態別内訳**: `solved` / `node-limit` / `time-limit` / `unsolvable` の件数
- **バッチ進捗**: 32 バッチの完了状況 (計測中・未計測も表示)
- **ヒストグラム**: 応答時間と探索ノード数の分布 (対数ビン)
- **ゲーム別結果**: 状態フィルタ・列ソート・ページング対応のテーブル
- **戦略別・段別集計**: 高速成功、安全追加解決、最終成功、フォールバック率、
  合計ノード数・時間を表示

レポートは計測のたびに `npm run benchmark:report` で再生成します。
