#!/usr/bin/env node
/* =========================================================
 * fast 探索ノード上限の感度分析 (フェーズD)
 *
 * 全32,000ゲームの再計測結果 (batch-XX.json) に記録された各ゲームの
 * fast 単体ノード数 (attempts.fast.nodes) を使って、fast 上限 C を
 * 変えたときの影響をシミュレーションする。
 *
 * 前提:
 *   - fast で解けるゲームは attempts.fast.status === 'solved' で、
 *     attempts.fast.nodes がその消費ノード数。
 *   - fast で解けないゲーム (node-limit) は safe へフォールバックする。
 *   - 上限 C を下げると、C より多くのノードを要する「fast で解ける」ゲームも
 *     safe へフォールバックする (safe のコストが追加される)。
 *
 * 使い方:
 *   node scripts/benchmark/fast-cap-sensitivity.js [--caps 500000,1000000,2000000]
 *
 * 出力:
 *   上限ごとに、fast 解決数 / safe フォールバック数 / 総ノード数 / 総時間を表示。
 *
 * 注意:
 *   総ノード数・総時間は、safe フォールバック時の safe コストを「実際にフォールバック
 *   したゲームの attempts.safe」から推定する。再計測が fast-safe で行われた場合、
 *   fast で解けたゲームには attempts.safe が無いため、上限を下げて safe に落ちる
 *   ゲームの safe コストは正しく反映されない。したがって、フォールバック数のみを
 *   信頼し、総ノード数・総時間は参考値として扱うこと。
 * ========================================================= */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "../../docs/benchmark/data");

const DEFAULT_CAPS = [500_000, 1_000_000, 2_000_000];

function parseArgs(argv) {
  const args = { caps: DEFAULT_CAPS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--caps") {
      args.caps = String(argv[++i])
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    } else if (a === "-h" || a === "--help") {
      args.help = true;
    } else {
      throw new Error(`不明なオプション: ${a}`);
    }
  }
  if (args.caps.length === 0) {
    throw new Error("--caps に有効な上限値を指定してください。");
  }
  return args;
}

/** 全バッチを読み込み、ゲーム番号 → 結果 のマップを返す */
function loadAllResults() {
  const map = new Map();
  for (let b = 1; b <= 32; b++) {
    const f = resolve(DATA_DIR, `batch-${String(b).padStart(2, "0")}.json`);
    if (!existsSync(f)) continue;
    const d = JSON.parse(readFileSync(f, "utf8"));
    for (const r of d.results) {
      map.set(r.game, r);
    }
  }
  return map;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`エラー: ${err.message}`);
    process.exit(1);
  }
  if (args.help) {
    console.log(`fast 探索ノード上限の感度分析

使い方:
  node scripts/benchmark/fast-cap-sensitivity.js [--caps 500000,1000000,2000000]

オプション:
  --caps N[,M..]  比較する fast 上限値 (既定: ${DEFAULT_CAPS.join(",")})
  -h, --help      このヘルプを表示`);
    return;
  }

  const results = loadAllResults();
  if (results.size === 0) {
    console.error("docs/benchmark/data/batch-XX.json が見つかりません。先に全32,000ゲームを再計測してください。");
    process.exit(1);
  }

  // 各ゲームの fast 単体ノード数と safe フォールバック時の safe ノード数を収集
  const games = [...results.values()];
  const fastSolved = games.filter((r) => r.attempts?.fast?.status === "solved");
  const fastNodeCounts = fastSolved.map((r) => r.attempts.fast.nodes).sort((a, b) => a - b);

  console.log(`全 ${games.length} ゲーム (再計測結果)`);
  console.log(`fast 単体で解決: ${fastSolved.length} / ${games.length}`);
  console.log(`fast 単体ノード数分布 (解決ゲームのみ):`);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  console.log(`  p50=${q(fastNodeCounts, 0.5).toLocaleString("en-US")} `
    + `p90=${q(fastNodeCounts, 0.9).toLocaleString("en-US")} `
    + `p99=${q(fastNodeCounts, 0.99).toLocaleString("en-US")} `
    + `max=${q(fastNodeCounts, 1).toLocaleString("en-US")}`);
  console.log("");

  for (const cap of args.caps) {
    let fastSolve = 0;
    let fallback = 0;
    let totalNodes = 0;
    let totalTimeMs = 0;
    const fallbackGames = [];
    for (const r of games) {
      const fast = r.attempts?.fast;
      if (fast?.status === "solved" && fast.nodes <= cap) {
        // fast で解決 (上限内)
        fastSolve++;
        totalNodes += fast.nodes;
        totalTimeMs += fast.timeMs;
      } else {
        // safe へフォールバック
        fallback++;
        fallbackGames.push(r.game);
        const safe = r.attempts?.safe;
        if (safe) {
          totalNodes += (fast?.nodes ?? 0) + safe.nodes;
          totalTimeMs += (fast?.timeMs ?? 0) + safe.timeMs;
        } else {
          totalNodes += fast?.nodes ?? 0;
          totalTimeMs += fast?.timeMs ?? 0;
        }
      }
    }
    console.log(`--- fast 上限 ${cap.toLocaleString("en-US")} ---`);
    console.log(`fast解決=${fastSolve} safeフォールバック=${fallback} 総ノード=${totalNodes.toLocaleString("en-US")} 総時間=${Math.round(totalTimeMs)}ms`);
    if (fallbackGames.length <= 40) {
      console.log(`フォールバック: ${fallbackGames.join(",")}`);
    } else {
      console.log(`フォールバック ${fallbackGames.length} 件 (先頭40件): ${fallbackGames.slice(0, 40).join(",")}`);
    }
    console.log("");
  }
}

main();
