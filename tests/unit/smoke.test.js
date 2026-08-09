import { describe, expect, it } from "vitest";

/**
 * テスト環境自体の動作確認用スモークテスト。
 * Phase 1 から `npm test` が成功する状態を保つため、Vitest のテストが
 * 0 件にならないようにする。後続 Phase で単体テストが増えても残す。
 */
describe("テスト環境", () => {
  it("Vitest が動作する", () => {
    expect(1 + 1).toBe(2);
  });
});
