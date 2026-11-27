/* 公開サイトでのみ、固定イベント名を画像リクエストとして送る。 */
const urls = {
  view: "https://dbstudy.info/beacon/view.gif",
  clear: "https://dbstudy.info/beacon/clear.gif",
};

let sequence = 0;

export function sendAnalyticsBeacon(event, deps = {}) {
  try {
    const location = deps.location ?? globalThis.location;
    if (location?.hostname !== "sh2.github.io" || !Object.hasOwn(urls, event)) {
      return;
    }
    const ImageClass = deps.Image ?? globalThis.Image;
    const image = new ImageClass();
    // 時刻と乱数に連番も加え、同一ページ内の連続送信を区別する。
    const cacheKey = `${Date.now()}-${Math.random().toString(36).slice(2)}-${++sequence}`;
    image.src = `${urls[event]}?v=${cacheKey}`;
  } catch {
    // 集計の失敗はゲームを妨げない。
  }
}
