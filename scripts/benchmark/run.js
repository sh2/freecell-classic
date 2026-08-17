#!/usr/bin/env node
/* =========================================================
 * ソルバーベンチマーク実行スクリプト (シリアル計測)
 *
 * - ゲーム番号 1〜32000 を 1000 ゲームずつ (バッチ) に分けて、
 *   シリアル (並列化なし) に測定する。
 * - 各ゲームは dealGame() で盤面を生成し、solveWithFallback() を呼ぶ。
 *   戦略ごとの段別結果と合計コストを記録する。
 * - 結果は docs/benchmark/data/batch-XX.json に保存する。
 *   途中経過は batch-XX.partial.json に保存し、中断・再開に耐える。
 *
 * 使い方:
 *   node scripts/benchmark/run.js                次の未計測バッチを実行
 *   node scripts/benchmark/run.js --batch 3      バッチ 3 を実行
 *   node scripts/benchmark/run.js --all          残り全バッチを実行
 *   node scripts/benchmark/run.js --start 11982 --count 1   指定範囲を計測 (範囲ファイル)
 *   node scripts/benchmark/run.js --force        計測済みでも再実行
 *   node scripts/benchmark/run.js --max-nodes 1000000 --max-time-ms 10000
 * ========================================================= */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SOLVER_PROFILES, solveWithFallback } from "../../src/js/solver.js";
import { dealGame } from "../../src/js/deal.js";

const MAX_GAME = 32000;
const BATCH_SIZE = 1000;
const DEFAULT_STRATEGY = "fast-safe";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(HERE, "../../docs/benchmark/data");

/* ---------------- 引数解析 ---------------- */

function parseArgs(argv) {
  const args = {
    batch: null, // 明示指定されたバッチ番号
    start: null, // 明示指定された開始ゲーム番号 (--start)
    count: null, // --start で計測するゲーム数 (--count)
    all: false,
    force: false,
    strategy: DEFAULT_STRATEGY,
    fastMaxNodes: SOLVER_PROFILES.fast.maxNodes,
    fastMaxTimeMs: SOLVER_PROFILES.fast.maxTimeMs,
    safeMaxNodes: SOLVER_PROFILES.safe.maxNodes,
    safeMaxTimeMs: SOLVER_PROFILES.safe.maxTimeMs,
    unsafeHome: false,
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
      case "--all":
        args.all = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--batch":
        args.batch = Number(argv[++i]);
        break;
      case "--start":
        args.start = Number(argv[++i]);
        break;
      case "--count":
        args.count = Number(argv[++i]);
        break;
      case "--max-nodes":
        args.fastMaxNodes = Number(argv[++i]);
        args.safeMaxNodes = args.fastMaxNodes;
        break;
      case "--max-time-ms":
        args.fastMaxTimeMs = Number(argv[++i]);
        args.safeMaxTimeMs = args.fastMaxTimeMs;
        break;
      case "--strategy":
        args.strategy = argv[++i];
        break;
      case "--fast-max-nodes":
        args.fastMaxNodes = Number(argv[++i]);
        break;
      case "--safe-max-nodes":
        args.safeMaxNodes = Number(argv[++i]);
        break;
      case "--fast-max-time-ms":
        args.fastMaxTimeMs = Number(argv[++i]);
        break;
      case "--safe-max-time-ms":
        args.safeMaxTimeMs = Number(argv[++i]);
        break;
      case "--unsafe-home":
        args.unsafeHome = true;
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
  console.log(`ソルバーベンチマーク実行スクリプト (シリアル計測)

使い方:
  node scripts/benchmark/run.js [オプション]

オプション:
  --batch N          バッチ N (ゲーム [(N-1)*1000+1 .. N*1000]) を計測
  --all              未計測の全バッチを順に計測 (シリアル)
  --start N --count M  ゲーム N から M 件を計測 (range-*.json に保存)
  --force            計測済みでも再計測して上書き
  --strategy NAME    fast / safe / fast-safe (既定 ${DEFAULT_STRATEGY})
  --fast-max-nodes N 高速モードのノード上限 (既定 ${SOLVER_PROFILES.fast.maxNodes})
  --safe-max-nodes N 安全モードのノード上限 (既定 ${SOLVER_PROFILES.safe.maxNodes})
  --fast-max-time-ms N 高速モードの時間上限 (既定 ${SOLVER_PROFILES.fast.maxTimeMs})
  --safe-max-time-ms N 安全モードの時間上限 (既定 ${SOLVER_PROFILES.safe.maxTimeMs})
  --max-nodes N      両モードのノード上限を上書き (互換オプション)
  --max-time-ms N    両モードの時間上限を上書き (互換オプション)
  --unsafe-home      ホーム移動を安全条件なしで自動適用
  --data-dir DIR     結果出力先 (既定 ${DEFAULT_DATA_DIR})
  -h, --help         このヘルプを表示

既定では「次の未計測バッチ」を 1 つ実行します。
結果はバッチごとに batch-XX.json (途中は .partial.json) として保存されます。
--start / --count で指定した範囲は range-<start>-<end>.json に保存され、
バッチの進捗管理には影響しません (特定ゲームの再計測向け)。`);
}

/* ---------------- バッチ管理 ---------------- */

function batchFile(dataDir, batch, partial) {
  const num = String(batch).padStart(2, "0");
  return resolve(dataDir, `batch-${num}${partial ? ".partial" : ""}.json`);
}

/** 指定バッチが計測済み (最終ファイルが存在) か */
function isBatchComplete(dataDir, batch) {
  return existsSync(batchFile(dataDir, batch, false));
}

/** 次の未計測バッチ番号を返す。全バッチ完了なら null */
function nextIncompleteBatch(dataDir) {
  for (let b = 1; b <= MAX_GAME / BATCH_SIZE; b++) {
    if (!isBatchComplete(dataDir, b)) {
      return b;
    }
  }
  return null;
}

function batchRange(batch) {
  const start = (batch - 1) * BATCH_SIZE + 1;
  const end = Math.min(batch * BATCH_SIZE, MAX_GAME);
  return { start, end };
}

function expectedConfig(args) {
  return {
    strategy: args.strategy,
    fastMaxNodes: args.fastMaxNodes,
    fastMaxTimeMs: args.fastMaxTimeMs,
    safeMaxNodes: args.safeMaxNodes,
    safeMaxTimeMs: args.safeMaxTimeMs,
    unsafeHome: args.unsafeHome,
  };
}

function configMatches(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual?.[key] === value);
}

/* ---------------- 計測 ---------------- */

function measureGame(game, args) {
  const deal = dealGame(game);
  const board = {
    cascades: deal.cascades.map((pile) => pile.map((card) => card.id)),
    freeCells: deal.freeCells.map((card) => (card === null ? null : card.id)),
    foundations: [],
  };
  const res = solveWithFallback(board, {
    strategy: args.strategy,
    fastOptions: {
      maxNodes: args.fastMaxNodes,
      maxTimeMs: args.fastMaxTimeMs,
      safeFoundationMoves: !args.unsafeHome && SOLVER_PROFILES.fast.safeFoundationMoves,
    },
    safeOptions: {
      maxNodes: args.safeMaxNodes,
      maxTimeMs: args.safeMaxTimeMs,
      safeFoundationMoves: SOLVER_PROFILES.safe.safeFoundationMoves,
    },
  });
  return {
    game,
    strategy: res.strategy,
    status: res.status,
    solved: res.solved,
    nodes: res.nodes,
    timeMs: res.timeMs,
    totalNodes: res.totalNodes,
    totalTimeMs: res.totalTimeMs,
    finalMode: res.finalMode,
    fallbackUsed: res.fallbackUsed,
    attempts: res.attempts,
    moves: res.moves.length,
    stats: res.stats,
  };
}

/** バッチの簡易サマリ (レポート用の要約、ファイルにも記録) */
function summarize(results) {
  let solved = 0;
  let nodeLimit = 0;
  let timeLimit = 0;
  let unsolvable = 0;
  let totalTimeMs = 0;
  const times = [];
  for (const r of results) {
    totalTimeMs += r.totalTimeMs ?? r.timeMs;
    times.push(r.totalTimeMs ?? r.timeMs);
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
  times.sort((a, b) => a - b);
  const median = times.length > 0 ? times[Math.floor(times.length / 2)] : 0;
  return { solved, nodeLimit, timeLimit, unsolvable, totalTimeMs, medianTimeMs: median };
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function loadPartial(partialPath, args) {
  if (!existsSync(partialPath)) {
    return [];
  }
  const data = JSON.parse(readFileSync(partialPath, "utf8"));
  if (!configMatches(data.config, expectedConfig(args))) {
    return [];
  }
  return Array.isArray(data.results) ? data.results : [];
}

/** バッチ 1 つを計測する */
function runBatch(batch, args) {
  const { start, end } = batchRange(batch);
  const finalPath = batchFile(args.dataDir, batch, false);
  const partialPath = batchFile(args.dataDir, batch, true);

  if (isBatchComplete(args.dataDir, batch) && !args.force) {
    const existing = JSON.parse(readFileSync(finalPath, "utf8"));
    if (configMatches(existing.config, expectedConfig(args))) {
      console.log(`バッチ ${String(batch).padStart(2, "0")} (${start}〜${end}) は計測済みです。再計測するには --force を指定してください。`);
      return { skipped: true };
    }
    console.log(`バッチ ${String(batch).padStart(2, "0")} は別設定の結果があるため再計測します。`);
  }

  mkdirSync(args.dataDir, { recursive: true });

  // 途中経過があれば再開
  const results = loadPartial(partialPath, args);
  const done = new Set(results.map((r) => r.game));

  const total = end - start + 1;
  console.log(`バッチ ${String(batch).padStart(2, "0")}: ゲーム ${start}〜${end} (${total} ゲーム) を計測開始`
    + ` [strategy=${args.strategy}, fast=${args.fastMaxNodes}/${args.fastMaxTimeMs}ms, safe=${args.safeMaxNodes}/${args.safeMaxTimeMs}ms]`
    + (results.length > 0 ? ` / 途中経過 ${results.length} 件から再開` : ""));

  const startedAt = Date.now();
  let doneCount = 0;
  for (let game = start; game <= end; game++) {
    if (done.has(game)) {
      continue;
    }
    const record = measureGame(game, args);
    results.push(record);
    done.add(game);
    doneCount++;

    // 進捗表示 (1 ゲーム 1 行)
    console.log(
      `#${String(game).padStart(6, "0")} ${record.status.padEnd(10)} `
      + `nodes=${record.totalNodes.toLocaleString("en-US")} `
      + `time=${record.totalTimeMs}ms moves=${record.moves}`
    );

    // 途中経過を都度保存 (クラッシュに備える)
    const meta = buildMeta(batch, args, results);
    writeJson(partialPath, meta);

    // 100 ゲームごとに ETA を表示
    if (doneCount > 0 && doneCount % 100 === 0) {
      const elapsed = Date.now() - startedAt;
      const avg = elapsed / doneCount;
      const remain = (end - start + 1) - (done.size);
      console.log(`  ... ${done.size}/${total} 完了, 平均 ${avg.toFixed(1)}ms/ゲーム, 残り約 ${Math.round((avg * remain) / 1000)}s`);
    }
  }

  // 完了: 最終ファイルへ書き出し
  const meta = buildMeta(batch, args, results);
  writeJson(finalPath, meta);
  unlinkSync(partialPath);

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const s = summarize(results);
  console.log(
    `バッチ ${String(batch).padStart(2, "0")} 完了: ${total} ゲーム, `
    + `solved=${s.solved} node-limit=${s.nodeLimit} time-limit=${s.timeLimit} `
    + `unsolvable=${s.unsolvable}, 計測時間 ${elapsedSec}s, 中央値 ${s.medianTimeMs}ms`
  );
  return { skipped: false };
}

function buildMeta(batch, args, results) {
  return {
    batch,
    start: batchRange(batch).start,
    end: batchRange(batch).end,
    config: expectedConfig(args),
    measuredAt: new Date().toISOString(),
    summary: summarize(results),
    results,
  };
}

/** 指定範囲 (--start / --count) を計測し、range-<start>-<end>.json に保存する */
function runRange(start, count, args) {
  const end = Math.min(start + count - 1, MAX_GAME);
  const file = resolve(args.dataDir, `range-${start}-${end}.json`);
  if (existsSync(file) && !args.force) {
    const existing = JSON.parse(readFileSync(file, "utf8"));
    if (configMatches(existing.config, expectedConfig(args))) {
      console.log(`範囲 ${start}〜${end} は計測済みです (${file})。再計測するには --force を指定してください。`);
      return;
    }
    console.log(`範囲 ${start}〜${end} は別設定の結果があるため再計測します。`);
  }
  mkdirSync(args.dataDir, { recursive: true });
  const results = [];
  const startedAt = Date.now();
  console.log(`範囲 ${start}〜${end} (${end - start + 1} ゲーム) を計測開始`
    + ` [strategy=${args.strategy}, fast=${args.fastMaxNodes}/${args.fastMaxTimeMs}ms, safe=${args.safeMaxNodes}/${args.safeMaxTimeMs}ms]`);
  for (let game = start; game <= end; game++) {
    const record = measureGame(game, args);
    results.push(record);
    console.log(
      `#${String(game).padStart(6, "0")} ${record.status.padEnd(10)} `
      + `nodes=${record.totalNodes.toLocaleString("en-US")} `
      + `time=${record.totalTimeMs}ms moves=${record.moves}`
    );
  }
  const meta = {
    kind: "range",
    start,
    end,
    config: expectedConfig(args),
    measuredAt: new Date().toISOString(),
    summary: summarize(results),
    results,
  };
  writeJson(file, meta);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const s = summarize(results);
  console.log(
    `範囲 ${start}〜${end} 完了: ${results.length} ゲーム, `
    + `solved=${s.solved} node-limit=${s.nodeLimit} time-limit=${s.timeLimit} `
    + `unsolvable=${s.unsolvable}, 計測時間 ${elapsedSec}s`
  );
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
  if (!["fast", "safe", "fast-safe"].includes(args.strategy)
    || args.fastMaxNodes <= 0 || args.fastMaxTimeMs <= 0
    || args.safeMaxNodes <= 0 || args.safeMaxTimeMs <= 0) {
    console.error("エラー: strategy と各モードの上限値が不正です。");
    process.exit(1);
  }

  // 指定範囲の計測 (バッチ進捗に影響しない)
  if (args.start !== null) {
    if (args.all) {
      console.error("エラー: --start と --all は併用できません。");
      process.exit(1);
    }
    if (args.batch !== null) {
      console.error("エラー: --start と --batch は併用できません。");
      process.exit(1);
    }
    const count = args.count ?? 1;
    if (count <= 0 || args.start < 1 || args.start > MAX_GAME) {
      console.error("エラー: --start / --count の値が不正です。");
      process.exit(1);
    }
    runRange(args.start, count, args);
    return;
  }

  if (args.all) {
    // 未計測バッチを順に実行 (シリアル)
    let ran = 0;
    for (let b = 1; b <= MAX_GAME / BATCH_SIZE; b++) {
      const r = runBatch(b, args);
      if (!r.skipped) {
        ran++;
      }
    }
    console.log(ran === 0 ? "全バッチ計測済みです。" : `${ran} バッチの計測が完了しました。`);
    return;
  }

  let batch = args.batch;
  if (batch === null) {
    batch = nextIncompleteBatch(args.dataDir);
    if (batch === null) {
      console.log("全バッチ計測済みです。レポートを再生成するには: npm run benchmark:report");
      return;
    }
    console.log(`次の未計測バッチ: ${batch}`);
  }
  if (batch < 1 || batch > MAX_GAME / BATCH_SIZE) {
    console.error(`エラー: --batch は 1〜${MAX_GAME / BATCH_SIZE} を指定してください。`);
    process.exit(1);
  }
  runBatch(batch, args);
}

main();
