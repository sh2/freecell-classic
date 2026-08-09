# AGENTS.md — freecell-classic

Microsoft FreeCell 互換の配置を生成するフリーセル (クラシックルール) です。

## プロジェクト概要

- 静的 HTML/CSS/JS のみで構成。本番はビルド・依存ライブラリなし
  (`index.html` + `src/css/style.css` + `src/js/main.js` の 1 ページ構成)。
- npm は開発時のテスト実行 (Vitest / Playwright) のみに使用する。
- 遊び方・機能・起動方法・開発環境の詳細は [README.md](./README.md) を参照。
- ゲーム番号 (No.) は 1〜32000。Microsoft 版 FreeCell と互換の配置を生成する。

## 開発時の注意

- ブラウザーコードはネイティブ ES Modules(`import` / `export`、相対パス +
  `.js` 拡張子)。エントリは `index.html` → `src/js/main.js` で、`init()` は
  1 回だけ呼び出す。トップレベルの識別子はモジュールスコープに入るため、
  `page.evaluate` 内から直接参照できない。E2E テストから内部状態へ触れる
  場合は `tests/e2e/helpers.js`(main.js の公開テスト API)を使う。
- カード操作は Pointer Events ベース(`#game` への `pointerdown` と、
  `document` の `pointermove` / `pointerup` で処理される)。
- 制御文(`if` / `else` / `for` / `while`)は**必ずブロック `{}` を使う**こと。
  ブレースなしの単行文(`if (cond) return;` など)は禁止。

## 品質チェック

- ソースファイル(`index.html`、`src/**`)を変更したら、必ず `npm test`
  (単体 + E2E)で全テストが成功することを確認する。
  - 単体のみ: `npm run test:unit` / `npm run test:unit:watch`
  - E2E のみ: `npm run test:e2e` / `npm run test:e2e:ui`
- Markdown ファイル(`AGENTS.md`、`README.md`、`CHANGELOG.md`、スキルなど)を
  作成・編集したら、VS Code の markdownlint 診断を確認し、該当する診断を
  修正してから終了すること(診断が利用可能な場合)。

## ブラウザテスト

ブラウザでの動作確認・UI テスト・バグの再現/検証は、
[`.agents/skills/freecell-playwright-testing/`](./.agents/skills/freecell-playwright-testing/SKILL.md)
のスキルを参照すること(サーバー起動手順、クリック/ドラッグ操作の再現方法、
内部状態へのアクセス方法、検証済み動作一覧を収録)。

## 変更履歴

修正・リファクタリングなどでソースファイル(`index.html`、`src/**`)を変更したら、
**必ず [CHANGELOG.md](./CHANGELOG.md) に追記すること**(人間は更新しない前提)。

- 追記形式は既存エントリに倣う: `## YYYY-MM-DD` セクションを新設し、
  変更内容を「### 修正」「### リファクタリング」などに分類して簡潔に記す。
- 同じ日付のセクションが既にあれば、そのセクション内に追記する。
- 検証(動作確認)は行ったがコードを変えていない場合は追記不要。
