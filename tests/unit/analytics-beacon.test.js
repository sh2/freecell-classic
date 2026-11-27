import { describe, expect, it, vi } from "vitest";
import { sendAnalyticsBeacon } from "../../src/js/analytics-beacon.js";

describe("アクセス集計ビーコン", () => {
  it.each(["localhost", "127.0.0.1", "192.168.1.2", "other.github.io", "sh2.github.io.example.com"])(
    "%s では送信しない",
    (hostname) => {
      const Image = vi.fn();
      sendAnalyticsBeacon("view", { location: { hostname }, Image });
      sendAnalyticsBeacon("clear", { location: { hostname }, Image });
      expect(Image).not.toHaveBeenCalled();
    }
  );

  it("公開ドメインでは固定 URL と異なるキャッシュ回避クエリを使う", () => {
    const images = [];
    class Image {
      constructor() {
        images.push(this);
      }
    }
    const deps = { location: { hostname: "sh2.github.io" }, Image };
    sendAnalyticsBeacon("view", deps);
    sendAnalyticsBeacon("clear", deps);
    sendAnalyticsBeacon("clear", deps);
    sendAnalyticsBeacon("invalid", deps);

    expect(images).toHaveLength(3);
    const urls = images.map((image) => new URL(image.src));
    expect(urls.map((url) => `${url.origin}${url.pathname}`)).toEqual([
      "https://dbstudy.info/beacon/view.gif",
      "https://dbstudy.info/beacon/clear.gif",
      "https://dbstudy.info/beacon/clear.gif",
    ]);
    for (const url of urls) {
      expect([...url.searchParams.keys()]).toEqual(["v"]);
      expect(url.searchParams.get("v")).toMatch(/^\d+-[a-z0-9]*-\d+$/);
    }
    expect(urls[1].search).not.toBe(urls[2].search);
  });

  it("Image の生成や src の設定が失敗しても例外を出さない", () => {
    const location = { hostname: "sh2.github.io" };
    class BrokenImage {
      set src(value) {
        throw new Error("blocked");
      }
    }
    expect(() => sendAnalyticsBeacon("view", { location, Image: BrokenImage })).not.toThrow();
    expect(() => sendAnalyticsBeacon("view", {
      location,
      Image: class { constructor() { throw new Error("blocked"); } },
    })).not.toThrow();
  });
});
