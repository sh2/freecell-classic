#!/usr/bin/env node
/* =========================================================
 * node-limit ゲームの再検証スクリプト
 *
 * 既存バッチ結果 (batch-XX.json) で status が "node-limit" の
 * ゲームだけを、より大きい maxNodes で再計測して比較する。
 * バッチの進捗管理には影響しない (専用ファイルに保存)。
 *
 * 使い方:
 *   node scripts/benchmark/verify-node-limit.js
 *       batch-01.json の node-limit ゲームを maxNodes=5,000,000 で再計測
 *   node scripts/benchmark/verify-node-limit.js --batch 1 --max-nodes 5000000
 *   node scripts/benchmark/verify-node-limit.js --input batch-01.json --max-nodes 5000000 --max-time-ms 600000
 *
 * 出力: docs/benchmark/data/verify-<strategy>-<batch>-<maxNodes>.json
 * ========================================================= */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SOLVER_PROFILES, solveWithFallback } from "../../src/js/solver.js";
import { dealGame } from "../../src/js/deal.js";

const DEFAULT_MAX_NODES = 5000000;
const DEFAULT_MAX_TIME_MS = 600000; // ノード増加の影響を測るため時間上限は広めに

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(HERE, "../../docs/benchmark/data");

/* ---------------- 引数解析 ---------------- */

function parseArgs(argv) {
  const args = {
    batch: 1,
    input: null, // 入力ファイル名 (batch-XX.json)。未指定なら --batch から導出
    maxNodes: DEFAULT_MAX_NODES,
    maxTimeMs: DEFAULT_MAX_TIME_MS,
    strategy: "safe",
    dataDir: DEFAULT_DATA_DIR,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--batch":
        args.batch = Number(argv[++i]);
        break;
      case "--input":
        args.input = argv[++i];
        break;
      case "--max-nodes":
        args.maxNodes = Number(argv[++i]);
        break;
      case "--max-time-ms":
        args.maxTimeMs = Number(argv[++i]);
        break;
      case "--strategy":
        args.strategy = argv[++i];
        break;
      case "--data-dir":
        args.dataDir = resolve(argv[++i]);
        break;
      default:
        throw new Error(`不明なオプション: ${a}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`node-limit ゲームの再検証スクリプト

使い方:
  node scripts/benchmark/verify-node-limit.js [オプション]

オプション:
  --batch N          対象バッチ (既定 1)。--input 指定時は無視
  --input FILE       入力バッチファイル名 (batch-XX.json)。既定は --batch から導出
  --max-nodes N      再計測時のノード上限 (既定 ${DEFAULT_MAX_NODES})
  --max-time-ms N    再計測時の時間上限 ms (既定 ${DEFAULT_MAX_TIME_MS})
  --strategy NAME    再計測戦略 (既定 safe)
  --data-dir DIR     データディレクトリ (既定 ${DEFAULT_DATA_DIR})
  -h, --help         このヘルプを表示

入力バッチ内で status が "node-limit" のゲームだけを再計測し、
docs/benchmark/data/verify-<strategy>-<batch>-<maxNodes>.json に保存します。`);
}

/* ---------------- 計測 ---------------- */

function measureGame(game, maxNodes, maxTimeMs, strategy) {
  const deal = dealGame(game);
  const board = {
    cascades: deal.cascades.map((pile) => pile.map((card) => card.id)),
    freeCells: deal.freeCells.map((card) => (card === null ? null : card.id)),
    foundations: [],
  };
  const res = solveWithFallback(board, {
    strategy,
    fastOptions: { ...SOLVER_PROFILES.fast, maxNodes, maxTimeMs },
    safeOptions: { ...SOLVER_PROFILES.safe, maxNodes, maxTimeMs },
  });
  return {
    game,
    status: res.status,
    solved: res.solved,
    nodes: res.nodes,
    timeMs: res.timeMs,
    totalNodes: res.totalNodes,
    totalTimeMs: res.totalTimeMs,
    strategy: res.strategy,
    finalMode: res.finalMode,
    fallbackUsed: res.fallbackUsed,
    attempts: res.attempts,
    moves: res.moves.length,
  };
}

function summarize(results) {
  let solved = 0;
  let nodeLimit = 0;
  let timeLimit = 0;
  let unsolvable = 0;
  let totalTimeMs = 0;
  for (const r of results) {
    totalTimeMs += r.totalTimeMs ?? r.timeMs;
    if (r.status === "solved") {
      solved++;
    } else if (r.status === "node-limit") {
      nodeLimit++;
    } else if (r.status === "time-limit") {
      timeLimit++;
    } else {
      unsolvable++;
    }
  }
  return { solved, nodeLimit, timeLimit, unsolvable, totalTimeMs };
}

/* ---------------- メイン ---------------- */

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`エラー: ${err.message}`);
    printHelp();
    process.exit(1);
  }
  if (args.help) {
    printHelp();
    return;
  }
  if (args.maxNodes <= 0 || args.maxTimeMs <= 0
    || !["fast", "safe", "fast-safe"].includes(args.strategy)) {
    console.error("エラー: --max-nodes / --max-time-ms は正の値を指定してください。");
    process.exit(1);
  }

  const inputName = args.input ?? `batch-${String(args.batch).padStart(2, "0")}.json`;
  const inputPath = resolve(args.dataDir, inputName);
  if (!existsSync(inputPath)) {
    console.error(`エラー: 入力ファイルが見つかりません: ${inputPath}`);
    process.exit(1);
  }

  const batchData = JSON.parse(readFileSync(inputPath, "utf8"));
  const targets = batchData.results.filter((r) => r.status === "node-limit");
  if (targets.length === 0) {
    console.log(`入力 ${inputName} に node-limit ゲームはありません。`);
    return;
  }

  const origConfig = batchData.config ?? {};
  console.log(
    `入力 ${inputName}: node-limit ${targets.length} ゲームを再計測 `
    + `[strategy=${args.strategy}, maxNodes=${args.maxNodes}, maxTimeMs=${args.maxTimeMs}ms]`
    + ` (元設定: maxNodes=${origConfig.maxNodes ?? "?"}, maxTimeMs=${origConfig.maxTimeMs ?? "?"}ms)`
  );

  const results = [];
  const startedAt = Date.now();
  for (const t of targets) {
    const record = measureGame(t.game, args.maxNodes, args.maxTimeMs, args.strategy);
    const orig = batchData.results.find((r) => r.game === t.game);
    results.push({
      game: t.game,
      status: record.status,
      solved: record.solved,
      nodes: record.nodes,
      timeMs: record.timeMs,
      totalNodes: record.totalNodes,
      totalTimeMs: record.totalTimeMs,
      strategy: record.strategy,
      finalMode: record.finalMode,
      fallbackUsed: record.fallbackUsed,
      attempts: record.attempts,
      moves: record.moves,
      orig: {
        status: orig.status,
        nodes: orig.nodes,
        timeMs: orig.timeMs,
        moves: orig.moves,
      },
    });
    console.log(
      `#${String(t.game).padStart(6, "0")} ${record.status.padEnd(10)} `
      + `nodes=${record.totalNodes.toLocaleString("en-US")} `
      + `time=${record.totalTimeMs}ms moves=${record.moves}`
      + `  (元: ${orig.status}, ${orig.nodes.toLocaleString("en-US")} nodes, ${orig.timeMs}ms)`
    );
  }

  const outName = `verify-${args.strategy}-${String(args.batch).padStart(2, "0")}-${args.maxNodes}.json`;
  const outPath = resolve(args.dataDir, outName);
  mkdirSync(args.dataDir, { recursive: true });
  const meta = {
    kind: "verify-node-limit",
    batch: args.batch,
    input: inputName,
    config: { strategy: args.strategy, maxNodes: args.maxNodes, maxTimeMs: args.maxTimeMs },
    origConfig,
    measuredAt: new Date().toISOString(),
    summary: summarize(results),
    results,
  };
  writeFileSync(outPath, JSON.stringify(meta, null, 2) + "\n");

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const s = summarize(results);
  console.log(
    `完了: ${results.length} ゲーム, `
    + `solved=${s.solved} node-limit=${s.nodeLimit} time-limit=${s.timeLimit} `
    + `unsolvable=${s.unsolvable}, 計測時間 ${elapsedSec}s`
  );
  console.log(`保存: ${outPath}`);
}

main();