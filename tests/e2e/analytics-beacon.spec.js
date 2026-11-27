import { test, expect } from "@playwright/test";
import * as state from "./helpers/state.js";
import * as input from "./helpers/input.js";

// 実サーバーには接続せず、公開ドメインのコンテンツもローカルから配信する。
async function interceptRequests(page, baseURL) {
  const beacons = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "dbstudy.info") {
      beacons.push({ url: url.href, method: route.request().method() });
      await route.fulfill({ status: 204 });
    } else if (url.hostname === "sh2.github.io") {
      const response = await route.fetch({ url: new URL(url.pathname + url.search, baseURL).href });
      await route.fulfill({ response });
    } else if (url.origin === new URL(baseURL).origin) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  return beacons;
}

test("公開ドメインでは起動時と各局のクリア時に送信する", async ({ page, baseURL }) => {
  const beacons = await interceptRequests(page, baseURL);
  await page.goto("https://sh2.github.io/");
  await state.injectPageHelpers(page);
  await expect.poll(() => beacons.length).toBe(1);
  expect(beacons[0].method).toBe("GET");
  expect(new URL(beacons[0].url).pathname).toBe("/beacon/view.gif");

  await state.setBoard(page, state.nearWinBoard());
  await input.dblClickCard(page, 51);
  await expect.poll(() => beacons.length).toBe(2);
  expect((await state.state(page)).won).toBe(true);
  expect(beacons[1].method).toBe("GET");
  expect(new URL(beacons[1].url).pathname).toBe("/beacon/clear.gif");

  // 同一局での勝利処理の再呼び出しや再描画では送らない。
  await state.setWinBoard(page);
  await page.keyboard.press("Escape");
  expect(beacons).toHaveLength(2);

  await state.startGame(page, 2);
  await state.setWinBoard(page);
  await expect.poll(() => beacons.length).toBe(3);
  expect(new URL(beacons[2].url).pathname).toBe("/beacon/clear.gif");
  expect(new URL(beacons[1].url).search).not.toBe(new URL(beacons[2].url).search);
  for (const beacon of beacons) {
    const url = new URL(beacon.url);
    expect(url.origin).toBe("https://dbstudy.info");
    expect([...url.searchParams.keys()]).toEqual(["v"]);
    expect(url.searchParams.get("v")).toBeTruthy();
  }
});

test("ローカルでは起動時もクリア時も送信しない", async ({ page, baseURL }) => {
  const beacons = await interceptRequests(page, baseURL);
  await state.openGame(page, 1);
  await state.setWinBoard(page);
  expect((await state.state(page)).won).toBe(true);
  expect(beacons).toHaveLength(0);
});
