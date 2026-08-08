# AGENTS.md — freecell-classic

Microsoft FreeCell 互換の配置を生成するフリーセル (クラシックルール) です。

## プロジェクト概要

- 静的 HTML/CSS/JS のみで構成。依存ライブラリ・ビルドステップなし
  (`index.html` + `src/css/style.css` + `src/js/game.js` の 1 ページ構成)。
- 遊び方・機能・起動方法の詳細は [README.md](./README.md) を参照。
- ゲーム番号 (No.) は 1〜32000。Microsoft 版 FreeCell と互換の配置を生成する。

## 開発時の注意

- `src/js/game.js` はクラシックスクリプト(`<script src>`、モジュールでない)。
  トップレベルの `let`/`const` 変数や `function` はグローバル語彙環境に入り、
  `page.evaluate` 内から識別子として直接参照できる(`window.` は不要・付けても不可)。
- カード操作は Pointer Events ベース(`#game` への `pointerdown` と、
  `document` の `pointermove` / `pointerup` で処理される)。

## ブラウザテスト

ブラウザでの動作確認・UI テスト・バグの再現/検証は、
[`.agents/skills/freecell-playwright-testing/`](./.agents/skills/freecell-playwright-testing/SKILL.md)
のスキルを参照すること(サーバー起動手順、クリック/ドラッグ操作の再現方法、
内部状態への直接アクセス、検証済み動作一覧を収録)。

## 変更履歴

修正・リファクタリングなどでソースファイル(`index.html`、`src/**`)を変更したら、
**必ず [CHANGELOG.md](./CHANGELOG.md) に追記すること**(人間は更新しない前提)。

- 追記形式は既存エントリに倣う: `## YYYY-MM-DD` セクションを新設し、
  変更内容を「### 修正」「### リファクタリング」などに分類して簡潔に記す。
- 同じ日付のセクションが既にあれば、そのセクション内に追記する。
- 検証(動作確認)は行ったがコードを変えていない場合は追記不要。
