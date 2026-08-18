#!/usr/bin/env node
/* =========================================================
 * V8 CPU プロファイル解析スクリプト (フェーズA)
 *
 * node --cpu-prof で出力した .cpuprofile を読み、関数単位の
 * 自己時間 (self) と総時間 (total) を集計して表示する。
 *
 * 使い方:
 *   node scripts/benchmark/analyze-profile.js /tmp/freecell-profile/normal-fast.cpuprofile
 *   node scripts/benchmark/analyze-profile.js <file> --top 30
 *
 * 集計方法:
 *   - self: サンプルの「当該ノードの関数」に割り当てた時間の合計
 *   - total: サンプルスタックにその関数が含まれる場合の時間合計 (呼び出し先を含む)
 *   - 時間は timeDeltas の合計 (サンプル間隔の実測値) から算出する
 * ========================================================= */

import { readFileSync } from "node:fs";

function parseArgs(argv) {
  const args = { file: null, top: 25 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--top") {
      args.top = Number(argv[++i]);
    } else if (!a.startsWith("--")) {
      args.file = a;
    }
  }
  if (!args.file) {
    throw new Error("解析する .cpuprofile ファイルを指定してください。");
  }
  return args;
}

/**
 * .cpuprofile を関数単位に集計する。
 * @returns {Array<{name: string, location: string, selfMs: number, totalMs: number,
 *   selfPct: number, totalPct: number, samples: number}>}
 */
function analyze(profile) {
  const nodes = profile.nodes ?? [];
  const byId = new Map();
  for (const node of nodes) {
    byId.set(node.id, node);
  }

  // 各ノードの表示名と場所を解決する
  const nameOf = (node) => {
    const cf = node.callFrame ?? {};
    return cf.functionName || "(anonymous)";
  };
  const locationOf = (node) => {
    const cf = node.callFrame ?? {};
    const line = cf.lineNumber >= 0 ? cf.lineNumber + 1 : 0;
    const url = (cf.url || "").split("/").pop();
    return line > 0 ? `${url}:${line}` : url || "(native)";
  };
  // 集計キー: 名前付き関数は「関数名+ファイル」、無名関数は「ファイル:行」で
  // 区別する。名前だけだと別場所の無名関数 (ソートのコールバック等) が混ざる。
  const keyOf = (node) => {
    const cf = node.callFrame ?? {};
    const fn = cf.functionName || "";
    const url = cf.url || "";
    if (fn) {
      return `${fn}@${url}`;
    }
    const line = cf.lineNumber >= 0 ? cf.lineNumber + 1 : 0;
    return `(anonymous)@${url}:${line}`;
  };

  // samples と timeDeltas で自己時間・総時間を集計する
  const self = new Map(); // key -> { ms, samples, name, location }
  const total = new Map(); // key -> ms
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  const n = Math.min(samples.length, deltas.length);

  for (let i = 0; i < n; i++) {
    const dt = deltas[i] / 1000; // マイクロ秒 → ミリ秒
    if (dt <= 0) {
      continue;
    }
    const id = samples[i];
    const node = byId.get(id);
    if (!node) {
      continue;
    }
    // 自己時間: サンプルの最下フレームの関数
    const key = keyOf(node);
    let e = self.get(key);
    if (!e) {
      e = { ms: 0, samples: 0, name: nameOf(node), location: locationOf(node) };
      self.set(key, e);
    }
    e.ms += dt;
    e.samples += 1;

    // 総時間: スタック (祖先) 上の各関数に加算
    let cur = node;
    let guard = 0;
    while (cur && guard < 1000) {
      const k = keyOf(cur);
      total.set(k, (total.get(k) ?? 0) + dt);
      cur = cur.parent ?? null;
      guard++;
    }
  }

  const totalMs = deltas.reduce((sum, d) => sum + d, 0) / 1000;
  const rows = [];
  for (const [key, e] of self) {
    rows.push({
      name: e.name,
      location: e.location,
      selfMs: e.ms,
      totalMs: total.get(key) ?? 0,
      selfPct: totalMs > 0 ? (e.ms / totalMs) * 100 : 0,
      totalPct: totalMs > 0 ? ((total.get(key) ?? 0) / totalMs) * 100 : 0,
      samples: e.samples,
    });
  }
  rows.sort((a, b) => b.selfMs - a.selfMs);
  return { rows, totalMs, samples: samples.length };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`エラー: ${err.message}`);
    process.exit(1);
  }

  const profile = JSON.parse(readFileSync(args.file, "utf8"));
  const { rows, totalMs, samples } = analyze(profile);

  console.log(`ファイル: ${args.file}`);
  console.log(`サンプル数: ${samples.toLocaleString("en-US")}, 総時間: ${totalMs.toFixed(1)} ms`);
  console.log("");
  console.log("関数別 CPU 時間 (self 降順、上位 " + args.top + " 件)");
  console.log("  " + "self".padStart(9) + "  " + "self%".padStart(6) + "  " + "total".padStart(9)
    + "  " + "total%".padStart(6) + "  " + "samples".padStart(8) + "  関数 (場所)");
  console.log("  " + "-".repeat(78));
  for (const r of rows.slice(0, args.top)) {
    console.log(
      "  " + r.selfMs.toFixed(1).padStart(9) + "  " + r.selfPct.toFixed(2).padStart(6)
      + "  " + r.totalMs.toFixed(1).padStart(9) + "  " + r.totalPct.toFixed(2).padStart(6)
      + "  " + String(r.samples).padStart(8) + "  " + r.name + " (" + r.location + ")"
    );
  }
  console.log("");
  console.log("※ self = 関数自身の実行時間, total = 呼び出し先を含む時間。");
}

main();
