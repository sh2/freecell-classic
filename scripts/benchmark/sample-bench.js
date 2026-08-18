#!/usr/bin/env node
/* =========================================================
 * 固定サンプルでの A/B 比較用ベンチマーク (フェーズC の評価用)
 *
 * 固定ゲームセットを指定戦略で実行し、解決数・合計ノード・合計時間を表示する。
 * コード変更の前後で同じコマンドを実行して比較することで、
 * moveScore / ヒューリスティック変更の効果を定量評価する。
 *
 * 使い方:
 *   node scripts/benchmark/sample-bench.js                 # 通常200ゲーム (fast-safe)
 *   node scripts/benchmark/sample-bench.js --hard          # 難関サンプル (safe)
 *   node scripts/benchmark/sample-bench.js --normal --hard
 *   node scripts/benchmark/sample-bench.js --games 1,2,3 --strategy safe
 *
 * オプション:
 *   --normal        通常サンプル (ゲーム1〜200, fast-safe) を実行
 *   --hard          難関サンプル (高速モード未解決26件の一部, safe) を実行
 *   --games N[,M..] 指定ゲームのみ実行 (--strategy と併用)
 *   --strategy NAME fast / safe / fast-safe (既定: 通常 fast-safe / 難関 safe)
 *   -h, --help      このヘルプを表示
 * ========================================================= */

import { SOLVER_PROFILES, solveWithFallback } from "../../src/js/solver.js";
import { dealGame } from "../../src/js/deal.js";

// 通常サンプル: ゲーム 1〜200 (高速モードで全解決)
const NORMAL_START = 1;
const NORMAL_END = 200;

// 難関サンプル: 高速モード未解決26件のうち、解決に数百万ノードを要する代表
const HARD_GAMES = [3670, 4016, 5495, 6240, 12475];

function parseArgs(argv) {
  const args = {
    normal: false,
    hard: false,
    games: null,
    strategy: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--normal":
        args.normal = true;
        break;
      case "--hard":
        args.hard = true;
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
      default:
        throw new Error(`不明なオプション: ${a}`);
    }
  }
  if (!args.normal && !args.hard && !args.games) {
    args.normal = true; // 既定: 通常サンプル
  }
  if (args.games && args.games.length === 0) {
    throw new Error("--games に有効なゲーム番号 (1〜32000) を指定してください。");
  }
  if (args.strategy && !["fast", "safe", "fast-safe"].includes(args.strategy)) {
    throw new Error(`未知の戦略: ${args.strategy} (fast / safe / fast-safe)`);
  }
  return args;
}

function printHelp() {
  console.log(`固定サンプルでの A/B 比較用ベンチマーク (フェーズC の評価用)

使い方:
  node scripts/benchmark/sample-bench.js [オプション]

オプション:
  --normal        通常サンプル (ゲーム1〜200, fast-safe) を実行
  --hard          難関サンプル (safe) を実行
  --games N[,M..] 指定ゲームのみ実行
  --strategy NAME fast / safe / fast-safe
  -h, --help      このヘルプを表示`);
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

function runSample(games, strategy, label) {
  const fastOptions = { ...SOLVER_PROFILES.fast };
  const safeOptions = { ...SOLVER_PROFILES.safe };
  let solved = 0;
  let nodeLimit = 0;
  let timeLimit = 0;
  let unsolvable = 0;
  let totalNodes = 0;
  let totalTimeMs = 0;
  const startedAt = performance.now();
  const perGame = [];

  for (const game of games) {
    const res = solveWithFallback(makeBoard(game), {
      strategy,
      fastOptions,
      safeOptions,
    });
    totalNodes += res.totalNodes;
    totalTimeMs += res.totalTimeMs;
    if (res.status === "solved") {
      solved++;
    } else if (res.status === "node-limit") {
      nodeLimit++;
    } else if (res.status === "time-limit") {
      timeLimit++;
    } else {
      unsolvable++;
    }
    perGame.push({ game, status: res.status, nodes: res.totalNodes, timeMs: res.totalTimeMs });
  }
  const wallMs = performance.now() - startedAt;
  const nodesPerSec = wallMs > 0 ? Math.round(totalNodes / (wallMs / 1000)) : 0;

  console.log(`--- ${label} (${games.length} games, strategy=${strategy}) ---`);
  console.log(`solved=${solved} node-limit=${nodeLimit} time-limit=${timeLimit} unsolvable=${unsolvable}`);
  console.log(`totalNodes=${totalNodes.toLocaleString("en-US")} totalTimeMs=${Math.round(totalTimeMs)} `
    + `wallMs=${Math.round(wallMs)} nodesPerSec=${nodesPerSec.toLocaleString("en-US")}`);
  return { solved, nodeLimit, timeLimit, unsolvable, totalNodes, totalTimeMs, perGame };
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

  if (args.games) {
    const strategy = args.strategy ?? "fast-safe";
    runSample(args.games, strategy, "指定ゲーム");
    return;
  }
  if (args.normal) {
    const games = Array.from({ length: NORMAL_END - NORMAL_START + 1 }, (_, i) => NORMAL_START + i);
    runSample(games, args.strategy ?? "fast-safe", "通常サンプル");
  }
  if (args.hard) {
    runSample(HARD_GAMES, args.strategy ?? "safe", "難関サンプル");
  }
}

main();
