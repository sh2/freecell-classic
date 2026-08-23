/* =========================================================
 * 解法キャッシュ (純粋モジュール)
 * ソルバーの解を「盤面スナップ列 + 手順列」として保持し、
 * 現在盤面との照合で再利用できる位置を求める。
 * DOM・Worker・時刻には触れず、game-state.js と rules.js のみに依存する。
 * docs/solution-cache-plan.md の設計に基づく。
 * ========================================================= */

import { NUM_CASCADES, NUM_FREE, NUM_HOME } from "./constants.js";
import * as rules from "./rules.js";
import { attemptMove, createState, groupFrom } from "./game-state.js";

/**
 * 盤面のフィンガープリント(カード id 表現の JSON 文字列)。
 * 正規化は行わない厳密比較用。solver-client.js の boardSnapshot() を統合した実装。
 * @param {{cascades: number[][], freeCells: (number|null)[], foundations: number[][]}} board
 */
export function boardFingerprint(board) {
  return JSON.stringify({
    cascades: board.cascades,
    freeCells: board.freeCells,
    foundations: board.foundations,
  });
}

/** カード id からカードオブジェクトを復元する(app.setBoard と同じ形式) */
function cardFromId(id) {
  return { suit: id % 4, rank: Math.floor(id / 4) + 1, id };
}

/** id ベースの盤面をカードオブジェクトの盤面へ変換する(不足ゾーンは空で埋める) */
function toCardBoard(board) {
  return {
    cascades: Array.from({ length: NUM_CASCADES }, (_, i) => (board.cascades?.[i] ?? []).map(cardFromId)),
    freeCells: Array.from({ length: NUM_FREE }, (_, i) => {
      const id = board.freeCells?.[i] ?? null;
      return id === null ? null : cardFromId(id);
    }),
    foundations: Array.from({ length: NUM_HOME }, (_, i) => (board.foundations?.[i] ?? []).map(cardFromId)),
  };
}

/** シャドウ state をカード id ベースの盤面へ変換する(フィンガープリント用) */
function idBoardOf(state) {
  return {
    cascades: state.cascades.map((pile) => pile.map((c) => c.id)),
    freeCells: state.freeCells.map((c) => (c ? c.id : null)),
    foundations: state.foundations.map((pile) => pile.map((c) => c.id)),
  };
}

/**
 * 解を求めた盤面 B0 と解手順からキャッシュエントリを構築する。
 * カードオブジェクトを復元したシャドウ state に対して手順を再生し、
 * 各ステップ後の盤面フィンガープリントと手順を記録する。
 * @param {{cascades: number[][], freeCells: (number|null)[], foundations: number[][]}} startBoard
 *   解を求めた盤面(B0)。カードは id 表現
 * @param {object[]} moves 解の手順。各手は { cardId, fromZone, fromIndex, destZone, destIndex, count }
 * @returns {{boards: string[], moves: object[]} | null} 不整合時は null
 */
export function buildSolutionCacheEntry(startBoard, moves) {
  if (!Array.isArray(moves) || moves.length === 0) {
    return null;
  }
  const state = createState(0, toCardBoard(startBoard));
  const boards = [boardFingerprint(idBoardOf(state))];
  for (const mv of moves) {
    const loc = rules.findCardLocation(state, mv.cardId);
    if (!loc || loc.zone === "home") {
      return null;
    }
    // 手順の count と再生中のグループ長が一致しなければ盤面と手順の不整合
    if (groupFrom(state, loc).length !== mv.count) {
      return null;
    }
    if (!attemptMove(state, loc, mv.destZone, mv.destIndex).ok) {
      return null;
    }
    boards.push(boardFingerprint(idBoardOf(state)));
  }
  return { boards, moves };
}

/**
 * 現在盤面が解パス上のどの位置に一致するかを末尾側から探す。
 * 重複する一致があれば最も進んだ位置(最大 j)を返す。見つからなければ -1。
 * @param {{boards: string[], moves: object[]} | null} entry キャッシュエントリ
 * @param {{cascades: number[][], freeCells: (number|null)[], foundations: number[][]}} board 現在盤面
 * @returns {number} 一致インデックス j( boards[j] === 現在盤面 )、不一致なら -1
 */
export function findProgressIndex(entry, board) {
  if (!entry || !Array.isArray(entry.boards)) {
    return -1;
  }
  const f = boardFingerprint(board);
  for (let j = entry.boards.length - 1; j >= 0; j--) {
    if (entry.boards[j] === f) {
      return j;
    }
  }
  return -1;
}
