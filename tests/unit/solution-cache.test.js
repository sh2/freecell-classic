import { describe, expect, it } from "vitest";
import {
  boardFingerprint,
  buildSolutionCacheEntry,
  findProgressIndex,
} from "../../src/js/solution-cache.js";

/**
 * 解法キャッシュ (solution-cache.js) の単体テスト。
 * docs/solution-cache-plan.md のテスト計画 (6.1) に対応する。
 */

/** 盤面 fixture(カード id 表現)。ゾーン未指定は空で埋める */
function board({ cascades = [], freeCells = [], foundations = [] } = {}) {
  return {
    cascades: Array.from({ length: 8 }, (_, i) => cascades[i] ?? []),
    freeCells: Array.from({ length: 4 }, (_, i) => freeCells[i] ?? null),
    foundations: Array.from({ length: 4 }, (_, i) => foundations[i] ?? []),
  };
}

/** 手 fixture(solver の出力形式) */
function move(cardId, fromZone, fromIndex, destZone, destIndex, count = 1) {
  return { cardId, fromZone, fromIndex, destZone, destIndex, count };
}

describe("boardFingerprint", () => {
  it("同じ配置なら同じ文字列になる", () => {
    const a = board({ cascades: [[8, 4]], freeCells: [0] });
    const b = board({ cascades: [[8, 4]], freeCells: [0] });
    expect(boardFingerprint(a)).toBe(boardFingerprint(b));
  });

  it("列の分割が違えば異なる文字列になる(正規化はしない)", () => {
    const a = board({ cascades: [[8, 4]] });
    const b = board({ cascades: [[8], [4]] });
    expect(boardFingerprint(a)).not.toBe(boardFingerprint(b));
  });

  it("ゾーンの違い(カスケード/フリーセル/ホーム)も反映する", () => {
    const cascade = board({ cascades: [[0]] });
    const free = board({ freeCells: [0] });
    const home = board({ foundations: [[0]] });
    expect(boardFingerprint(cascade)).not.toBe(boardFingerprint(free));
    expect(boardFingerprint(cascade)).not.toBe(boardFingerprint(home));
    expect(boardFingerprint(free)).not.toBe(boardFingerprint(home));
  });
});

describe("buildSolutionCacheEntry", () => {
  // col0 に 3C-2C-AC が積まれた盤面。A→2→3 の順でホームへ送るのが解
  const start = board({ cascades: [[8, 4, 0]] });
  const solution = [
    move(0, "cascade", 0, "home", 0),
    move(4, "cascade", 0, "home", 0),
    move(8, "cascade", 0, "home", 0),
  ];

  it("正常な解手順からエントリを構築する(boards[0]=開始盤面, boards[n]=勝利盤面)", () => {
    const entry = buildSolutionCacheEntry(start, solution);
    expect(entry).not.toBeNull();
    expect(entry.moves).toEqual(solution);
    expect(entry.boards).toHaveLength(solution.length + 1);
    expect(entry.boards[0]).toBe(boardFingerprint(start));
    const won = board({ foundations: [[0, 4, 8]] });
    expect(entry.boards[solution.length]).toBe(boardFingerprint(won));
  });

  it("不正手を含む手順では null を返す(ホームのランク不連続)", () => {
    // AC をホームへ送る前に 2C を送ろうとして失敗する
    const badOrder = [move(4, "cascade", 0, "home", 0)];
    expect(buildSolutionCacheEntry(start, badOrder)).toBeNull();
  });

  it("count が再生中のグループ長と一致しない手順では null を返す", () => {
    // 単独カードなのに count=2 の手
    const badCount = [move(0, "cascade", 0, "home", 0, 2)];
    expect(buildSolutionCacheEntry(start, badCount)).toBeNull();
  });

  it("空の手順では null を返す", () => {
    expect(buildSolutionCacheEntry(start, [])).toBeNull();
  });
});

describe("findProgressIndex", () => {
  const start = board({ cascades: [[8, 4, 0]] });
  const solution = [
    move(0, "cascade", 0, "home", 0),
    move(4, "cascade", 0, "home", 0),
    move(8, "cascade", 0, "home", 0),
  ];
  const entry = buildSolutionCacheEntry(start, solution);

  it("未着手盤面(B0)では 0 を返す", () => {
    expect(findProgressIndex(entry, start)).toBe(0);
  });

  it("途中盤面では対応するインデックスを返す", () => {
    const afterOne = board({ cascades: [[8, 4]], foundations: [[0]] });
    expect(findProgressIndex(entry, afterOne)).toBe(1);
    const afterTwo = board({ cascades: [[8]], foundations: [[0, 4]] });
    expect(findProgressIndex(entry, afterTwo)).toBe(2);
  });

  it("勝利盤面では最終インデックスを返す", () => {
    const won = board({ foundations: [[0, 4, 8]] });
    expect(findProgressIndex(entry, won)).toBe(solution.length);
  });

  it("パス外の盤面では -1 を返す", () => {
    // AC がホームでなくフリーセルにある盤面はパス上に存在しない
    const offPath = board({ cascades: [[8, 4]], freeCells: [0] });
    expect(findProgressIndex(entry, offPath)).toBe(-1);
  });

  it("エントリが null の場合は -1 を返す", () => {
    expect(findProgressIndex(null, start)).toBe(-1);
  });

  it("重複する盤面では最も大きいインデックスを返す", () => {
    // AC をフリーセル経由で元の列へ戻すと B0 と同じ盤面が再登場する
    const b = board({ cascades: [[0]] });
    const moves = [
      move(0, "cascade", 0, "free", 0),
      move(0, "free", 0, "free", 1),
      move(0, "free", 1, "cascade", 0),
      move(0, "cascade", 0, "home", 0),
    ];
    const e = buildSolutionCacheEntry(b, moves);
    expect(e).not.toBeNull();
    expect(e.boards[0]).toBe(e.boards[3]);
    expect(findProgressIndex(e, b)).toBe(3);
  });
});
