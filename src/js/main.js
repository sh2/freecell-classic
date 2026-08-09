/* =========================================================
 * エントリポイント (唯一の HTML エントリ)
 * game.js の init を 1 回だけ呼び出す。
 *
 * E2E テストは同じ URL の main.js を dynamic import するため、
 * モジュールキャッシュが働き init() は二重実行されない。
 * テスト API はここから再 export する。
 * ========================================================= */

import { init, getTestApi } from "./game.js";

init();

export { getTestApi };
