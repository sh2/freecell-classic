# ソルバーベンチマーク (docs/benchmark)

ソルバー (`src/js/solver.js`) の性能を、ゲーム番号 1〜32,000 の全配布に対して
測定するためのハーネスです。ハードウェアの制約により、計測は**シリアル**
(並列化なし) で行います。

## 構成

| パス | 説明 |
| --- | --- |
| `scripts/benchmark/run.js` | 計測スクリプト (シリアル実行) |
| `scripts/benchmark/report.js` | HTML レポート生成スクリプト |
| `docs/benchmark/data/batch-XX.json` | バッチ (1,000 ゲーム) ごとの計測結果 |
| `docs/benchmark/data/batch-XX.partial.json` | 途中経過 (中断・再開用) |
| `docs/benchmark/data/range-S-E.json` | `--start` で指定した範囲の計測結果 |
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

# 計測上限の指定 (既定は maxNodes=2,000,000 / maxTimeMs=60,000)
node scripts/benchmark/run.js --max-nodes 1000000 --max-time-ms 10000

# 計測済みでも再計測
node scripts/benchmark/run.js --batch 1 --force

# レポート生成 (データを HTML にまとめる)
npm run benchmark:report
```

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

レポートは計測のたびに `npm run benchmark:report` で再生成します。
