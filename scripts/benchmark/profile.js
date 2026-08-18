#!/usr/bin/env node
/* =========================================================
 * CPU プロファイリング用ドライバ (フェーズA)
 *
 * 代表ゲームを選択してソルバーを実行し、ゲームごとのノード数・時間・
 * 統計 (置換表・呼び出し回数カウンタ) を表示する。Node.js の --cpu-prof と
 * 組み合わせて使うことで、関数単位の CPU 時間を採取できる。
 *
 * 使い方:
 *   node scripts/benchmark/profile.js --games 720 --strategy fast
 *   node scripts/benchmark/profile.js --games 3670 --strategy safe --max-nodes 1000000
 *   node scripts/benchmark/profile.js --games 720,3670 --counters
 *
 * --cpu-prof との併用例:
 *   node --cpu-prof --cpu-prof-dir=/tmp/freecell-profile \
 *        --cpu-prof-name=normal-fast.cpuprofile \
 *        scripts/benchmark/profile.js --games 720 --strategy fast
 *
 * オプション:
 *   --games N[,M...]   計測するゲーム番号 (カンマ区切り、既定: 1)
 *   --strategy NAME    fast / safe / fast-safe (既定: fast)
 *   --max-nodes N      両モードのノード上限を上書き
 *   --max-time-ms N    両モードの時間上限を上書き
 *   --counters         trackCounters を有効化し、stats.profile を表示する
 *   -h, --help         このヘルプを表示
 * ========================================================= */

import { SOLVER_PROFILES, solveWithFallback } from "../../src/js/solver.js";
import { dealGame } from "../../src/js/deal.js";

function parseArgs(argv) {
  const args = {
    games: [1],
    strategy: "fast",
    maxNodes: null,
    maxTimeMs: null,
    counters: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--games":
        args.games = String(argv[++i])
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 32000);
        break;
      case "--strategy":
        args.strategy = argv[++i];
        break;
      case "--max-nodes":
        args.maxNodes = Number(argv[++i]);
        break;
      case "--max-time-ms":
        args.maxTimeMs = Number(argv[++i]);
        break;
      case "--counters":
        args.counters = true;
        break;
      default:
        throw new Error(`不明なオプション: ${a}`);
    }
  }
  if (args.games.length === 0) {
    throw new Error("--games に有効なゲーム番号 (1〜32000) を指定してください。");
  }
  if (!["fast", "safe", "fast-safe"].includes(args.strategy)) {
    throw new Error(`未知の戦略: ${args.strategy} (fast / safe / fast-safe)`);
  }
  return args;
}

function printHelp() {
  console.log(`CPU プロファイリング用ドライバ (フェーズA)

使い方:
  node scripts/benchmark/profile.js [オプション]

オプション:
  --games N[,M...]   計測するゲーム番号 (カンマ区切り、既定: 1)
  --strategy NAME    fast / safe / fast-safe (既定: fast)
  --max-nodes N      両モードのノード上限を上書き
  --max-time-ms N    両モードの時間上限を上書き
  --counters         trackCounters を有効化し、stats.profile を表示する
  -h, --help         このヘルプを表示

--cpu-prof と組み合わせる例:
  node --cpu-prof --cpu-prof-dir=/tmp/freecell-profile \\
       --cpu-prof-name=normal-fast.cpuprofile \\
       scripts/benchmark/profile.js --games 720 --strategy fast`);
}

/** ゲーム番号からソルバー入力の盤面を作る (benchmark/run.js と同一変換) */
function makeBoard(game) {
  const deal = dealGame(game);
  return {
    cascades: deal.cascades.map((pile) => pile.map((card) => card.id)),
    freeCells: deal.freeCells.map((card) => (card === null ? null : card.id)),
    foundations: [],
  };
}

function formatCount(n) {
  return n.toLocaleString("en-US");
}

function printGame(game, args) {
  const board = makeBoard(game);
  const fastOptions = { ...SOLVER_PROFILES.fast };
  const safeOptions = { ...SOLVER_PROFILES.safe };
  if (args.maxNodes !== null) {
    fastOptions.maxNodes = args.maxNodes;
    safeOptions.maxNodes = args.maxNodes;
  }
  if (args.maxTimeMs !== null) {
    fastOptions.maxTimeMs = args.maxTimeMs;
    safeOptions.maxTimeMs = args.maxTimeMs;
  }
  const res = solveWithFallback(board, {
    strategy: args.strategy,
    trackCounters: args.counters,
    fastOptions,
    safeOptions,
  });

  console.log(`#${game} strategy=${args.strategy} finalMode=${res.finalMode} status=${res.status} `
    + `solved=${res.solved} nodes=${formatCount(res.totalNodes)} timeMs=${res.totalTimeMs} `
    + `fallback=${res.fallbackUsed}`);
  console.log(`  attempts: fast=${res.attempts.fast ? `${res.attempts.fast.status}(${formatCount(res.attempts.fast.nodes)} nodes, ${res.attempts.fast.timeMs}ms)` : "n/a"} `
    + `safe=${res.attempts.safe ? `${res.attempts.safe.status}(${formatCount(res.attempts.safe.nodes)} nodes, ${res.attempts.safe.timeMs}ms)` : "n/a"}`);

  const s = res.stats;
  console.log(`  stats: deadEnd=${s.deadEndNodes} transpositionHits=${formatCount(s.transpositionHits)} `
    + `unsafeHome gen=${s.unsafeHomeGenerated} tried=${s.unsafeHomeTried} solved=${s.unsafeHomeSolved} deadEnds=${s.unsafeHomeDeadEnds} maxDepth=${s.maxSearchDepth}`);
  const t = s.transposition;
  console.log(`  tt: used=${formatCount(t.used)}/${formatCount(t.capacity)} load=${(t.loadFactor * 100).toFixed(2)}% `
    + `probes=${formatCount(t.probes)} maxProbe=${t.maxProbe} overwrites=${formatCount(t.overwrites)}`);

  if (args.counters && s.profile) {
    const p = s.profile;
    const nodes = res.attempts[res.finalMode]?.nodes ?? res.totalNodes;
    const perNode = (name, val) => (nodes > 0 ? ` (${(val / nodes).toFixed(2)}/node)` : "");
    const perCall = (name, val, base) => (base > 0 ? ` (${((val / base) * 100).toFixed(2)}% of ${name})` : "");
    console.log("  profile counters:");
    console.log(`    getStateHash  = ${formatCount(p.getStateHash)}${perNode("getStateHash", p.getStateHash)}`);
    console.log(`    generateMoves = ${formatCount(p.generateMoves)}${perNode("generateMoves", p.generateMoves)}`);
    console.log(`    moveScore     = ${formatCount(p.moveScore)} (movesGenerated=${formatCount(p.movesGenerated)}${perNode("moves", p.movesGenerated)})`);
    console.log(`    ttLookup      = ${formatCount(p.ttLookup)}${perNode("ttLookup", p.ttLookup)}`);
    console.log(`    ttStore       = ${formatCount(p.ttStore)}${perNode("ttStore", p.ttStore)}`);
    console.log(`    makeMove      = ${formatCount(p.makeMove)}${perNode("makeMove", p.makeMove)}`);
    console.log(`    findHomeMove  = ${formatCount(p.findHomeMove)}${perNode("findHomeMove", p.findHomeMove)}`);
    const movesPerNode = p.generateMoves > 0 ? p.movesGenerated / p.generateMoves : 0;
    const scoresPerMove = p.movesGenerated > 0 ? p.moveScore / p.movesGenerated : 0;
    const makeMoveRatio = p.makeMove > 0 ? (p.makeMove / p.generateMoves).toFixed(2) : "n/a";
    console.log(`    ratio: movesGenerated/generateMoves=${movesPerNode.toFixed(2)} moveScore/move=${scoresPerMove.toFixed(2)} makeMove/generateMoves=${makeMoveRatio}`);
  }
  return res;
}

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
  for (const game of args.games) {
    printGame(game, args);
  }
}

main();
