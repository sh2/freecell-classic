#!/usr/bin/env node
/* =========================================================
 * ソルバーベンチマーク HTML レポート生成スクリプト
 *
 * docs/benchmark/data/ の batch-*.json を読み込み、
 * 自己完結型の HTML レポート docs/benchmark/report.html を生成する。
 *
 * - サマリカード / 状態別内訳 / バッチ進捗
 * - 応答時間・探索ノード数のヒストグラム (対数ビン、SVG)
 * - ゲーム別結果テーブル (ページング + ソート + 状態フィルタ)
 *
 * データは HTML 内に JSON として埋め込むため、file:// で開いても動作する。
 *
 * 使い方:
 *   node scripts/benchmark/report.js [--data-dir DIR] [--out FILE]
 * ========================================================= */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(HERE, "../../docs/benchmark/data");
const DEFAULT_OUT = resolve(HERE, "../../docs/benchmark/report.html");

const NUM_BATCHES = 32;
const BATCH_SIZE = 1000;

/* ---------------- 状態の定義 ---------------- */

const STATUSES = [
  { id: "solved", label: "solved (解けた)", color: "#34d399" },
  { id: "node-limit", label: "node-limit (ノード上限)", color: "#fbbf24" },
  { id: "time-limit", label: "time-limit (時間上限)", color: "#f87171" },
  { id: "unsolvable", label: "unsolvable (解けない証明)", color: "#a78bfa" },
];
const STATUS_IDS = STATUSES.map((s) => s.id);

/* ---------------- ユーティリティ ---------------- */

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

function fmtNum(v) {
  return v.toLocaleString("ja-JP");
}

/** 短い数値表記 (軸ラベル用): 1k / 1M など */
function fmtShort(v) {
  if (v >= 1000000) {
    return (v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1) + "M";
  }
  if (v >= 1000) {
    return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k";
  }
  if (v >= 100) {
    return String(Math.round(v));
  }
  if (v >= 10) {
    return String(Math.round(v));
  }
  if (v >= 1) {
    return v.toFixed(1);
  }
  return v.toFixed(2);
}

/** 時間の軸ラベル (ms → 秒/分) */
function fmtTimeTick(v) {
  if (v >= 60000) {
    return (v / 60000).toFixed(1) + "分";
  }
  if (v >= 1000) {
    return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "秒";
  }
  return String(Math.round(v)) + "ms";
}

/** 日時を表示用に整形 (ISO → 'YYYY-MM-DD HH:mm') */
function fmtDateTime(iso) {
  if (!iso) {
    return "-";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------------- データ読み込み ---------------- */

function normalizeResult(r) {
  const idx = STATUS_IDS.indexOf(r.status);
  const statusIdx = idx >= 0 ? idx : STATUS_IDS.length - 1;
  return [
    r.game,
    statusIdx,
    r.nodes,
    r.timeMs,
    r.moves,
    r.strategy || "legacy",
    r.totalNodes ?? r.nodes,
    r.totalTimeMs ?? r.timeMs,
    r.finalMode || r.strategy || "legacy",
    Boolean(r.fallbackUsed),
    r.attempts || null,
  ];
}

function loadBatches(dataDir) {
  const empty = { batches: [], ranges: [], games: [], config: null };
  if (!existsSync(dataDir)) {
    return empty;
  }
  const files = readdirSync(dataDir);
  const finals = files.filter((f) => /^batch-\d+\.json$/.test(f)).sort();
  const partials = files.filter((f) => /^batch-\d+\.partial\.json$/.test(f)).sort();
  const ranges = files.filter((f) => /^range-\d+-\d+\.json$/.test(f)).sort();
  const batchMap = new Map();
  const rangeList = [];
  let config = null;

  // ゲーム番号ごとに 1 件 (初回追加が優先 = バッチ > 途中経過 > 範囲)
  const gamesMap = new Map();
  const addResults = (results) => {
    for (const r of results) {
      if (!gamesMap.has(r[0])) {
        gamesMap.set(r[0], r);
      }
    }
  };

  for (const f of finals) {
    const data = JSON.parse(readFileSync(resolve(dataDir, f), "utf8"));
    const results = (data.results || []).map(normalizeResult);
    addResults(results);
    config = config || data.config || null;
    batchMap.set(data.batch, {
      batch: data.batch,
      complete: true,
      measuredAt: data.measuredAt,
      results,
    });
  }
  // 途中経過 (最終ファイルが存在するバッチは無視する)
  for (const f of partials) {
    const data = JSON.parse(readFileSync(resolve(dataDir, f), "utf8"));
    if (batchMap.has(data.batch)) {
      continue;
    }
    const results = (data.results || []).map(normalizeResult);
    addResults(results);
    config = config || data.config || null;
    batchMap.set(data.batch, {
      batch: data.batch,
      complete: false,
      measuredAt: data.measuredAt,
      results,
    });
  }
  // カスタム範囲 (--start / --count)
  for (const f of ranges) {
    const data = JSON.parse(readFileSync(resolve(dataDir, f), "utf8"));
    const results = (data.results || []).map(normalizeResult);
    addResults(results);
    config = config || data.config || null;
    rangeList.push({ start: data.start, end: data.end, measuredAt: data.measuredAt, results });
  }
  return {
    batches: [...batchMap.values()].sort((a, b) => a.batch - b.batch),
    ranges: rangeList.sort((a, b) => a.start - b.start),
    games: [...gamesMap.values()],
    config,
  };
}

/* ---------------- 集計 ---------------- */

function buildSummary(games) {
  const times = games.map((g) => g[7] ?? g[3]).sort((a, b) => a - b);
  const nodes = games.map((g) => g[6] ?? g[2]).sort((a, b) => a - b);
  const counts = { solved: 0, "node-limit": 0, "time-limit": 0, unsolvable: 0 };
  for (const g of games) {
    const id = STATUS_IDS[g[1]];
    if (counts[id] !== undefined) {
      counts[id]++;
    }
  }
  const total = games.length;
  return {
    total,
    counts,
    solved: counts.solved,
    solveRate: total ? (counts.solved / total) * 100 : 0,
    time: {
      mean: total ? times.reduce((a, b) => a + b, 0) / total : 0,
      p50: percentile(times, 50),
      p90: percentile(times, 90),
      p99: percentile(times, 99),
      max: times.length ? times[times.length - 1] : 0,
    },
    nodes: {
      mean: total ? nodes.reduce((a, b) => a + b, 0) / total : 0,
      p50: percentile(nodes, 50),
      p90: percentile(nodes, 90),
      p99: percentile(nodes, 99),
      max: nodes.length ? nodes[nodes.length - 1] : 0,
    },
  };
}

function buildStrategySummary(games) {
  const result = {};
  for (const strategy of ["fast", "safe", "fast-safe", "legacy"]) {
    const rows = games.filter((g) => g[5] === strategy);
    if (rows.length === 0) {
      continue;
    }
    const fastSolved = strategy === "fast"
      ? rows.filter((g) => g[1] === 0).length
      : rows.filter((g) => g[10]?.fast?.status === "solved").length;
    const finalSolved = rows.filter((g) => g[1] === 0).length;
    const safeAdditionalSolved = rows.filter((g) => g[9] && g[1] === 0).length;
    result[strategy] = {
      total: rows.length,
      fastSolved,
      safeAdditionalSolved,
      finalSolved,
      fallback: rows.filter((g) => g[9]).length,
      totalNodes: rows.reduce((sum, g) => sum + (g[6] ?? g[2]), 0),
      totalTimeMs: rows.reduce((sum, g) => sum + (g[7] ?? g[3]), 0),
    };
  }
  return result;
}

function renderStrategyTable(strategySummary) {
  const labels = { fast: "高速", safe: "安全", "fast-safe": "高速→安全", legacy: "旧形式" };
  const rows = Object.entries(strategySummary).map(([strategy, s]) => {
    const fallbackRate = s.total ? (s.fallback / s.total) * 100 : 0;
    return `<tr><td>${labels[strategy] || strategy}</td><td class="num">${fmtNum(s.total)}</td>`
      + `<td class="num">${fmtNum(s.fastSolved)}</td><td class="num">${fmtNum(s.safeAdditionalSolved)}</td>`
      + `<td class="num">${fmtNum(s.finalSolved)}</td><td class="num">${fallbackRate.toFixed(2)}%</td>`
      + `<td class="num">${fmtNum(s.totalNodes)}</td><td class="num">${fmtNum(s.totalTimeMs)} ms</td></tr>`;
  }).join("\n");
  return `<table class="mini"><thead><tr><th>戦略</th><th>件数</th><th>高速成功</th><th>安全追加</th><th>最終成功</th><th>フォールバック率</th><th>合計ノード</th><th>合計時間</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** 対数ビンのヒストグラムを計算する (ビン数はレンジの桁数に応じて適応) */
function buildLogHistogram(values) {
  const vals = values.filter((x) => Number.isFinite(x) && x > 0).map((x) => Math.max(x, 0.5));
  if (vals.length === 0) {
    return { bins: [], ticks: [], maxCount: 0, min: 1, max: 1, median: 0 };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of vals) {
    if (v < min) {
      min = v;
    }
    if (v > max) {
      max = v;
    }
  }
  if (min === max) {
    min = min / 10;
    max = max * 10;
  }
  const lo = Math.log10(min);
  const hi = Math.log10(max);
  // レンジの桁数 × 8 ビン (12〜48 の範囲にクランプ)
  const decades = hi - lo;
  const numBins = Math.max(12, Math.min(48, Math.round(decades * 8)));
  const width = decades / numBins;
  const bins = [];
  for (let i = 0; i < numBins; i++) {
    bins.push({ lo: Math.pow(10, lo + i * width), hi: Math.pow(10, lo + (i + 1) * width), count: 0 });
  }
  for (const v of vals) {
    const idx = Math.max(0, Math.min(numBins - 1, Math.floor((Math.log10(v) - lo) / width)));
    bins[idx].count++;
  }
  const ticks = [];
  for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) {
    ticks.push(Math.pow(10, e));
  }
  if (ticks.length === 0) {
    ticks.push(Math.pow(10, lo));
  }
  let maxCount = 0;
  for (const b of bins) {
    if (b.count > maxCount) {
      maxCount = b.count;
    }
  }
  const sorted = vals.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { bins, ticks, maxCount, min: Math.pow(10, lo), max: Math.pow(10, hi), median };
}

/* ---------------- SVG ヒストグラム ---------------- */

function renderHistogramSvg(hist, { unit, axisTick, accent }) {
  const W = 660;
  const H = 300;
  const padL = 56;
  const padR = 14;
  const padT = 18;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = hist.bins.length;
  const bw = plotW / n;
  const barW = Math.max(2, bw * 0.8);
  const lo = Math.log10(hist.min);
  const hi = Math.log10(hist.max);
  const span = hi - lo || 1;
  const xAt = (v) => padL + ((Math.log10(v) - lo) / span) * plotW;
  const yAt = (c) => padT + plotH - (hist.maxCount ? (c / hist.maxCount) * plotH : 0);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ヒストグラム" class="hist">`;

  // Y 軸グリッド (maxCount の 0 / 1/4 / 1/2 / 3/4 / 1)
  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    const y = yAt(hist.maxCount * frac);
    const label = Math.round(hist.maxCount * frac);
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#24324f" stroke-width="1" />`;
    svg += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="axis">${fmtNum(label)}</text>`;
  }

  // バー
  for (let i = 0; i < n; i++) {
    const b = hist.bins[i];
    if (b.count === 0) {
      continue;
    }
    const x = padL + i * bw;
    const top = yAt(b.count);
    const h = yAt(0) - top;
    const opacity = 0.35 + 0.65 * (b.count / hist.maxCount);
    const title = `${axisTick(b.lo)} 〜 ${axisTick(b.hi)}: ${b.count.toLocaleString("en-US")} ゲーム`;
    svg += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"`
      + ` fill="${accent}" fill-opacity="${opacity.toFixed(2)}" rx="1.5"><title>${title}</title></rect>`;
  }

  // X 軸ティック (10 のべき乗)
  for (const t of hist.ticks) {
    const x = xAt(t);
    svg += `<line x1="${x.toFixed(1)}" y1="${yAt(0)}" x2="${x.toFixed(1)}" y2="${yAt(0) + 5}" stroke="#64748b" stroke-width="1" />`;
    svg += `<text x="${x.toFixed(1)}" y="${yAt(0) + 20}" text-anchor="middle" class="axis">${axisTick(t)}</text>`;
  }

  // 中央値マーカー
  if (hist.median >= hist.min && hist.median <= hist.max) {
    const mx = xAt(hist.median);
    svg += `<line x1="${mx.toFixed(1)}" y1="${padT}" x2="${mx.toFixed(1)}" y2="${yAt(0)}" stroke="#f472b6" stroke-width="1.5" stroke-dasharray="4 3" />`;
    svg += `<text x="${mx.toFixed(1)}" y="${padT - 4}" text-anchor="middle" fill="#f472b6" class="axis">中央値</text>`;
  }

  // 軸ラベル
  svg += `<text x="${padL + plotW / 2}" y="${H - 6}" text-anchor="middle" fill="#94a3b8" class="axis">${unit} (対数軸)</text>`;
  svg += `</svg>`;
  return svg;
}

/* ---------------- HTML 生成 ---------------- */

function renderCards(sum) {
  const cards = [
    { label: "計測済み", value: `${fmtNum(sum.total)} ゲーム`, sub: `${fmtNum(sum.total)} / 32,000` },
    { label: "解決済み (solved)", value: fmtNum(sum.solved), sub: `成功率 ${sum.solveRate.toFixed(2)}%` },
    { label: "未解決", value: fmtNum(sum.total - sum.solved), sub: `node/time/unsolvable 含む` },
    { label: "応答時間 中央値", value: `${fmtNum(Math.round(sum.time.p50))} ms`, sub: `平均 ${fmtNum(Math.round(sum.time.mean))} ms` },
    { label: "応答時間 最大", value: `${fmtNum(sum.time.max)} ms`, sub: `p99 ${fmtNum(Math.round(sum.time.p99))} ms` },
    { label: "探索ノード 中央値", value: fmtNum(sum.nodes.p50), sub: `平均 ${fmtNum(Math.round(sum.nodes.mean))}` },
    { label: "探索ノード 最大", value: fmtNum(sum.nodes.max), sub: `p99 ${fmtNum(sum.nodes.p99)}` },
    { label: "ヒストグラム", value: "応答時間 / ノード数", sub: "対数ビンで表示" },
  ];
  return cards
    .map(
      (c) => `<div class="card"><div class="card-label">${c.label}</div>`
        + `<div class="card-value">${c.value}</div><div class="card-sub">${c.sub}</div></div>`
    )
    .join("\n");
}

function renderStatusTable(sum) {
  const rows = STATUSES.map((s) => {
    const count = sum.counts[s.id] || 0;
    const pct = sum.total ? (count / sum.total) * 100 : 0;
    const barW = sum.total ? pct : 0;
    return `<tr>
      <td><span class="dot" style="background:${s.color}"></span>${s.label}</td>
      <td class="num">${fmtNum(count)}</td>
      <td class="num muted">${pct.toFixed(2)}%</td>
      <td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${barW.toFixed(2)}%;background:${s.color}"></div></div></td>
    </tr>`;
  }).join("\n");
  return `<table class="mini"><thead><tr><th>状態</th><th>件数</th><th>割合</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderBatchTable(batches, ranges) {
  const rows = [];
  for (let b = 1; b <= NUM_BATCHES; b++) {
    const found = batches.find((x) => x.batch === b);
    const start = (b - 1) * BATCH_SIZE + 1;
    const end = b * BATCH_SIZE;
    let statusHtml;
    let extra = "-";
    if (found) {
      const solved = found.results.filter((r) => r[1] === 0).length;
      const times = found.results.map((r) => r[3]).sort((x, y) => x - y);
      const median = times.length ? times[Math.floor(times.length / 2)] : 0;
      if (found.complete) {
        statusHtml = `<span class="badge" style="color:var(--green);background:rgba(52,211,153,.12)">完了</span>`;
      } else {
        statusHtml = `<span class="badge" style="color:var(--amber);background:rgba(251,191,36,.12)">計測中</span>`;
      }
      extra = `${found.results.length} ゲーム / solved ${solved} / 中央値 ${fmtNum(Math.round(median))} ms`;
    } else {
      statusHtml = `<span class="badge muted-badge">未計測</span>`;
    }
    rows.push(`<tr class="${found ? "" : "row-dim"}">
      <td class="num">${b}</td>
      <td class="num">${start}〜${end}</td>
      <td>${statusHtml}</td>
      <td class="muted">${extra}</td>
      <td class="muted">${found ? fmtDateTime(found.measuredAt) : "-"}</td>
    </tr>`);
  }
  for (const r of ranges) {
    const solved = r.results.filter((x) => x[1] === 0).length;
    const times = r.results.map((x) => x[3]).sort((x, y) => x - y);
    const median = times.length ? times[Math.floor(times.length / 2)] : 0;
    rows.push(`<tr>
      <td class="num muted">-</td>
      <td class="num">${r.start}〜${r.end}</td>
      <td><span class="badge" style="color:var(--accent);background:rgba(56,189,248,.12)">範囲</span></td>
      <td class="muted">${r.results.length} ゲーム / solved ${solved} / 中央値 ${fmtNum(Math.round(median))} ms</td>
      <td class="muted">${fmtDateTime(r.measuredAt)}</td>
    </tr>`);
  }
  return `<table class="mini"><thead><tr><th>バッチ</th><th>ゲーム範囲</th><th>状態</th><th>内容</th><th>計測日時</th></tr></thead><tbody>${rows.join("\n")}</tbody></table>`;
}

function renderEmptyState() {
  return `<section class="panel empty">
    <h2>まだ計測結果がありません</h2>
    <p>次のコマンドで最初のバッチ (ゲーム 1〜1000) を計測してから、レポートを再生成してください。</p>
    <pre>npm run benchmark</pre>
    <pre>npm run benchmark:report</pre>
    <p class="muted">計測はシリアルで行われます。1 バッチ 1,000 ゲームずつ、<code>npm run benchmark</code> を繰り返すことで 32,000 ゲームまで進められます。</p>
  </section>`;
}

function renderReportHtml(data) {
  const { games, config, summary, strategySummary } = data;
  const generatedAt = new Date().toISOString();
  const progressPct = (summary.total / 32000) * 100;
  const configHtml = config
    ? config.strategy
      ? `strategy=${config.strategy} / fast=${fmtNum(config.fastMaxNodes)} nodes, ${fmtNum(config.fastMaxTimeMs)} ms / safe=${fmtNum(config.safeMaxNodes)} nodes, ${fmtNum(config.safeMaxTimeMs)} ms`
      : `maxNodes=${fmtNum(config.maxNodes)} / maxTimeMs=${fmtNum(config.maxTimeMs)} ms`
    : "計測データなし";

  const embed = {
    config,
    statuses: STATUS_IDS,
    games,
  };

  let body;
  if (games.length === 0) {
    body = renderEmptyState();
  } else {
    body = `
  <section class="cards">
${renderCards(summary)}
  </section>

  <section class="grid2">
    <div class="panel">
      <h2>状態別内訳</h2>
${renderStatusTable(summary)}
    </div>
    <div class="panel">
      <h2>バッチ進捗 (32 バッチ)</h2>
${renderBatchTable(data.batches, data.ranges)}
    </div>
  </section>

  <section class="panel">
    <h2>戦略別・段別集計</h2>
${renderStrategyTable(strategySummary)}
    <p class="note muted">高速成功・安全追加・最終成功を分離して表示。ノード数・時間は各ゲームの合計値。</p>
  </section>

  <section class="charts">
    <div class="panel">
      <h2>応答時間ヒストグラム <span class="muted small">(ms, 対数軸)</span></h2>
${renderHistogramSvg(data.timeHist, { unit: "応答時間", axisTick: fmtTimeTick, accent: "#38bdf8" })}
      <p class="note muted">中央値 ${fmtNum(Math.round(summary.time.p50))} ms。右端の山は時間上限 (maxTimeMs) による打ち切り分。</p>
    </div>
    <div class="panel">
      <h2>探索ノード数ヒストグラム <span class="muted small">(対数軸)</span></h2>
${renderHistogramSvg(data.nodesHist, { unit: "探索ノード数", axisTick: fmtShort, accent: "#a78bfa" })}
      <p class="note muted">中央値 ${fmtNum(summary.nodes.p50)} ノード。右端の山はノード上限 (maxNodes) による打ち切り分。</p>
    </div>
  </section>

  <section class="panel">
    <div class="table-head">
      <h2>ゲーム別結果</h2>
      <div class="toolbar">
        <label>状態: <select id="filter-status"></select></label>
        <label>表示件数: <select id="page-size">
          <option value="50">50</option>
          <option value="100" selected>100</option>
          <option value="200">200</option>
          <option value="500">500</option>
        </select></label>
        <span id="table-info" class="muted"></span>
      </div>
    </div>
    <div class="table-scroll">
      <table class="data">
        <thead><tr>
          <th data-key="game" class="sortable">No.<span class="arrow"></span></th>
          <th data-key="status" class="sortable">状態<span class="arrow"></span></th>
          <th data-key="nodes" class="sortable num">合計ノード数<span class="arrow"></span></th>
          <th data-key="timeMs" class="sortable num">合計時間 (ms)<span class="arrow"></span></th>
          <th data-key="moves" class="sortable num">手数<span class="arrow"></span></th>
          <th>戦略</th>
        </tr></thead>
        <tbody id="table-body"></tbody>
      </table>
    </div>
    <div class="pager" id="pager"></div>
  </section>`;
  }

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>フリーセル ソルバー ベンチマーク</title>
<style>
:root {
  --bg: #0b1120;
  --panel: #111a2e;
  --panel2: #16223a;
  --border: #24324f;
  --text: #e2e8f0;
  --muted: #94a3b8;
  --accent: #38bdf8;
  --green: #34d399;
  --amber: #fbbf24;
  --red: #f87171;
  --violet: #a78bfa;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Segoe UI", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.6;
}
header {
  padding: 28px 32px 20px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(56,189,248,.08), transparent);
}
header h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: .02em; }
header .sub { color: var(--muted); margin-bottom: 12px; }
header .sub b { color: var(--text); font-size: 16px; }
.progress-track {
  height: 8px; border-radius: 999px; background: var(--panel2);
  border: 1px solid var(--border); overflow: hidden; max-width: 640px;
}
.progress-bar { height: 100%; background: linear-gradient(90deg, #0ea5e9, #38bdf8); border-radius: 999px; }
.meta { color: var(--muted); font-size: 12px; margin-top: 10px; }
main { padding: 24px 32px 48px; max-width: 1180px; margin: 0 auto; }
.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  margin-bottom: 20px;
}
.panel h2 { margin: 0 0 12px; font-size: 15px; }
.small { font-size: 12px; font-weight: normal; }
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
}
.card-label { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
.card-value { font-size: 18px; font-weight: 700; }
.card-sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
.grid2 { display: grid; grid-template-columns: 1fr 1.4fr; gap: 20px; }
.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 900px) { .grid2, .charts { grid-template-columns: 1fr; } }
table { width: 100%; border-collapse: collapse; }
.mini th, .mini td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
.mini th { color: var(--muted); font-weight: 600; }
.mini td.num, .data td.num, .data th.num { text-align: right; }
.muted { color: var(--muted); }
.row-dim td { opacity: .45; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 8px; }
.bar-cell { width: 38%; }
.bar-track { background: var(--panel2); border-radius: 999px; height: 8px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 999px; }
.badge {
  display: inline-block; padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.muted-badge { color: var(--muted); background: rgba(148,163,184,.12); }
.hist { width: 100%; height: auto; }
.axis { font-size: 11px; fill: #94a3b8; }
.note { font-size: 12px; margin: 8px 0 0; }
.table-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.toolbar { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 13px; }
.toolbar select {
  background: var(--panel2); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px;
}
.table-scroll { overflow-x: auto; margin-top: 10px; }
table.data { min-width: 560px; }
.data thead th {
  position: sticky; top: 0; background: var(--panel2);
  padding: 8px 12px; text-align: left; cursor: pointer;
  border-bottom: 2px solid var(--border); user-select: none;
  white-space: nowrap;
}
.data thead th.sortable:hover { color: var(--accent); }
.data thead th.active { color: var(--accent); }
.data thead th .arrow { margin-left: 6px; font-size: 10px; color: var(--accent); }
.data tbody td { padding: 6px 12px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; }
.data tbody tr:hover { background: var(--panel2); }
.row-warn td { background: rgba(251,191,36,.04); }
.pager {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 14px; justify-content: center;
}
.pager button {
  background: var(--panel2); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px;
  min-width: 32px; height: 30px; padding: 0 8px; cursor: pointer;
}
.pager button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.pager button.current { background: var(--accent); border-color: var(--accent); color: #0b1120; font-weight: 700; }
.pager button:disabled { opacity: .35; cursor: default; }
.pager .ellipsis { color: var(--muted); padding: 0 2px; }
.empty pre {
  background: var(--panel2); border: 1px solid var(--border);
  border-radius: 8px; padding: 10px 14px; overflow-x: auto;
}
.empty code { color: var(--accent); }
footer { color: var(--muted); font-size: 12px; text-align: center; padding: 12px 32px 32px; }
</style>
</head>
<body>
<header>
  <h1>フリーセル ソルバー ベンチマーク</h1>
  <div class="sub">計測済み <b>${fmtNum(summary.total)}</b> / 32,000 ゲーム</div>
  <div class="progress-track"><div class="progress-bar" style="width:${progressPct.toFixed(2)}%"></div></div>
  <div class="meta">計測設定: ${configHtml} ／ 生成時刻: ${fmtDateTime(generatedAt)}</div>
</header>
<main>
${body}
</main>
<footer>生成: ${fmtDateTime(generatedAt)} ／ データ: docs/benchmark/data/batch-*.json ／ 再生成: <code>npm run benchmark:report</code></footer>
<script id="benchmark-data" type="application/json">${JSON.stringify(embed)}</script>
<script>
(function () {
  "use strict";
  var dataEl = document.getElementById("benchmark-data");
  if (!dataEl) { return; }
  var DATA = JSON.parse(dataEl.textContent);
  var STATUSES = DATA.statuses;
  var COLORS = { solved: "#34d399", "node-limit": "#fbbf24", "time-limit": "#f87171", unsolvable: "#a78bfa" };
  var state = { key: "game", dir: 1, page: 1, pageSize: 100, filter: "all" };
  var body = document.getElementById("table-body");
  var pagerEl = document.getElementById("pager");
  var infoEl = document.getElementById("table-info");
  var filterEl = document.getElementById("filter-status");
  var sizeEl = document.getElementById("page-size");

  // 空状態 (計測データなし) ではテーブル要素が無いため初期化しない
  if (!body || !pagerEl || !infoEl || !filterEl || !sizeEl) { return; }

  function fmtNum(n) { return n.toLocaleString("ja-JP"); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function getRows() {
    var list = DATA.games.filter(function (r) {
      return state.filter === "all" || STATUSES[r[1]] === state.filter;
    });
    var key = state.key;
    var dir = state.dir;
    list.sort(function (a, b) {
      var cmp;
      if (key === "game") { cmp = a[0] - b[0]; }
      else if (key === "status") { cmp = a[1] - b[1]; }
      else if (key === "nodes") { cmp = (a[6] ?? a[2]) - (b[6] ?? b[2]); }
      else if (key === "timeMs") { cmp = (a[7] ?? a[3]) - (b[7] ?? b[3]); }
      else { cmp = a[4] - b[4]; }
      return cmp * dir;
    });
    return list;
  }

  function renderTable() {
    var list = getRows();
    var total = list.length;
    var totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > totalPages) { state.page = totalPages; }
    if (state.page < 1) { state.page = 1; }
    var start = (state.page - 1) * state.pageSize;
    var pageRows = list.slice(start, start + state.pageSize);
    var html = "";
    for (var i = 0; i < pageRows.length; i++) {
      var r = pageRows[i];
      var st = STATUSES[r[1]];
      var cls = st === "solved" ? "" : " class=\\"row-warn\\"";
      html += "<tr" + cls + ">"
        + "<td>" + fmtNum(r[0]) + "</td>"
        + "<td><span class=\\"badge\\" style=\\"color:" + COLORS[st] + ";background:" + COLORS[st] + "22\\">" + esc(st) + "</span></td>"
        + "<td class=\\"num\\">" + fmtNum(r[6] ?? r[2]) + "</td>"
        + "<td class=\\"num\\">" + fmtNum(r[7] ?? r[3]) + "</td>"
        + "<td class=\\"num\\">" + fmtNum(r[4]) + "</td>"
        + "<td>" + esc(r[5]) + "</td>"
        + "</tr>";
    }
    body.innerHTML = html;
    renderHeaders();
    renderPager(total, totalPages);
    var end = Math.min(start + state.pageSize, total);
    infoEl.textContent = (total === 0 ? "0" : fmtNum(start + 1) + "〜" + fmtNum(end)) + " / " + fmtNum(total) + " 件";
  }

  function renderHeaders() {
    var ths = document.querySelectorAll("thead th[data-key]");
    for (var i = 0; i < ths.length; i++) {
      var th = ths[i];
      var k = th.getAttribute("data-key");
      var arrow = th.querySelector(".arrow");
      if (k === state.key) {
        th.classList.add("active");
        arrow.textContent = state.dir === 1 ? "▲" : "▼";
      } else {
        th.classList.remove("active");
        arrow.textContent = "";
      }
    }
  }

  function pageItems(cur, total) {
    var items = [];
    var add = function (v) {
      if (items[items.length - 1] !== v) { items.push(v); }
    };
    if (total <= 9) {
      for (var i = 1; i <= total; i++) { add(i); }
      return items;
    }
    add(1);
    var s = Math.max(2, cur - 2);
    var e = Math.min(total - 1, cur + 2);
    if (s > 2) { add("…"); }
    for (var i = s; i <= e; i++) { add(i); }
    if (e < total - 1) { add("…"); }
    add(total);
    return items;
  }

  function renderPager(total, totalPages) {
    var html = "";
    html += "<button data-page=\\"prev\\" " + (state.page <= 1 ? "disabled" : "") + ">‹</button>";
    var items = pageItems(state.page, totalPages);
    for (var i = 0; i < items.length; i++) {
      if (items[i] === "…") { html += "<span class=\\"ellipsis\\">…</span>"; }
      else { html += "<button data-page=\\"" + items[i] + "\\" class=\\"" + (items[i] === state.page ? "current" : "") + "\\">" + items[i] + "</button>"; }
    }
    html += "<button data-page=\\"next\\" " + (state.page >= totalPages ? "disabled" : "") + ">›</button>";
    pagerEl.innerHTML = html;
  }

  pagerEl.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn || btn.disabled) { return; }
    var v = btn.getAttribute("data-page");
    if (v === "prev") { state.page--; }
    else if (v === "next") { state.page++; }
    else { state.page = Number(v); }
    renderTable();
  });

  document.querySelectorAll("thead th[data-key]").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-key");
      if (state.key === k) { state.dir = -state.dir; }
      else { state.key = k; state.dir = 1; }
      state.page = 1;
      renderTable();
    });
  });

  filterEl.addEventListener("change", function () { state.filter = filterEl.value; state.page = 1; renderTable(); });
  sizeEl.addEventListener("change", function () { state.pageSize = Number(sizeEl.value); state.page = 1; renderTable(); });

  function initFilter() {
    var counts = {};
    for (var i = 0; i < DATA.games.length; i++) {
      var st = STATUSES[DATA.games[i][1]];
      counts[st] = (counts[st] || 0) + 1;
    }
    var html = "<option value=\\"all\\">すべて</option>";
    for (var j = 0; j < STATUSES.length; j++) {
      var st2 = STATUSES[j];
      html += "<option value=\\"" + st2 + "\\">" + st2 + " (" + (counts[st2] || 0) + ")</option>";
    }
    filterEl.innerHTML = html;
  }

  initFilter();
  renderTable();
})();
</script>
</body>
</html>
`;
}

/* ---------------- メイン ---------------- */

function parseArgs(argv) {
  const args = { dataDir: DEFAULT_DATA_DIR, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data-dir") {
      args.dataDir = resolve(argv[++i]);
    } else if (a === "--out") {
      args.out = resolve(argv[++i]);
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else {
      throw new Error(`不明なオプション: ${a}`);
    }
  }
  return args;
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
    console.log(`HTML レポート生成スクリプト

使い方:
  node scripts/benchmark/report.js [--data-dir DIR] [--out FILE]

オプション:
  --data-dir DIR  結果 JSON の場所 (既定 ${DEFAULT_DATA_DIR})
  --out FILE      出力先 HTML (既定 ${DEFAULT_OUT})`);
    return;
  }

  const { batches, ranges, games, config } = loadBatches(args.dataDir);
  const summary = buildSummary(games);
  const strategySummary = buildStrategySummary(games);
  const timeHist = buildLogHistogram(games.map((g) => g[3]));
  const nodesHist = buildLogHistogram(games.map((g) => g[2]));
  const html = renderReportHtml({ batches, ranges, games, config, summary, strategySummary, timeHist, nodesHist });

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, html);
  console.log(`レポートを生成しました: ${args.out}`);
  console.log(`  計測済みゲーム: ${games.length} / 32,000`);
}

main();
