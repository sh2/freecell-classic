# 責務分離とローカルテスト基盤の実装計画

## 背景

現在のゲーム実装は `src/js/game.js` に次の責務が集中している。

- Microsoft FreeCell 互換のディール生成
- 移動ルールと勝利判定
- ゲーム状態、履歴、Undo
- DOM の構築と描画
- クリック、Pointer Events、ドラッグ&ドロップ
- タイマー、トースト、勝利オーバーレイ
- アプリケーションの初期化

また、自動テストとローカルで統一されたテストコマンドがない。この状態で実績、
プレイ履歴、ランキングなどを追加すると、状態変更と表示・通信がさらに結合し、既存動作の
回帰を検出しにくくなる。

## 目的

- 現在のゲーム仕様と操作感を維持したまま責務を分離する。
- ディール、ルール、状態遷移を DOM なしで単体テスト可能にする。
- UI と Pointer Events の主要動作を実ブラウザーで自動テストする。
- ローカルで単体テストと E2E テストを同じコマンドから実行可能にする。
- 将来、同じテストコマンドを GitHub Actions へ組み込める構成にする。
- 本番では引き続きビルドせず、GitHub Pages から静的ファイルとして配信する。

## 対象外

今回の実装では次を扱わない。

- 実績、ランキング、プレイ履歴、永続化の実装
- GitHub Actions へのテスト組み込み
- ゲームルールや操作仕様の変更
- UI デザインの再設計
- TypeScript 化
- 本番用バンドラーやフレームワークの導入
- CSS の分割
- Chromium 以外の E2E 対象追加

## 現行挙動の基準

リファクタリング中は次の挙動を変更しない。

- ゲーム番号 1〜32000 は Microsoft FreeCell と互換の配置を生成する。
- 移動可能枚数は空きフリーセルと空き列から算出する。
- 移動先自身が空き列の場合、その列は移動可能枚数の計算から除外する。
- 自動ホーム移動は反対色ホームの進捗を考慮して安全なカードだけを移動する。
- 自動移動で複数枚移動した場合も、カード 1 枚ごとに Undo できる。
- 同じカードを 400ms 以内に再クリックするとダブルクリック自動移動になる。
- Pointer Events の移動距離が 6px 未満ならドラッグではなくクリックとして扱う。
- 指定ホームが受け入れ不可でも、別のホームが受け入れ可能ならそちらへ移動する。
- ゲーム番号の空値、小数、範囲外入力に対する現在の補正動作を維持する。
- 最初の成功手でタイマーを開始し、勝利、新規ゲーム、やり直しで停止・初期化する。

## 技術判断

### ネイティブ ES Modules

ブラウザーコードを `import` / `export` によるネイティブ ES Modules へ移行する。
`index.html` は `type="module"` のエントリポイントを読み込む。すべての import は
`.js` 拡張子付きの相対パスとし、GitHub Pages のリポジトリサブパスでも解決できる
ようにする。

npm は開発時のテスト依存管理だけに使用する。本番コードの変換やバンドルは行わず、
GitHub Pages では従来どおり静的ファイルを配信する。`package.json` は
`"type": "module"` を宣言し、Node.js のランタイムは LTS バージョンを使用する。

### Vitest と Playwright Test

- Vitest はディール、ルール、状態遷移の単体テストに使用する。
- Playwright Test は DOM、Pointer Events、ドラッグ&ドロップ、勝利 UI の E2E
  テストに使用する。
- 初期の E2E 対象は Chromium のみにする。
- Playwright の `webServer` からローカル HTTP サーバーを起動する。
  ポートは設定読み込み時に `node:net` でランダムな空きポートを 1 つ選び、
  `webServer.command`、`webServer.url`、`use.baseURL` の 3 か所に同じ値を
  埋め込む。必要に応じて環境変数で上書きできるようにし、固定ポートによる
  競合リスクを大幅に減らす。空きポートの確認から HTTP サーバーの起動までには、
  小さな競合余地が残ることを許容する。

Vitest を採用する理由は、watch、モック、アサーション、将来のカバレッジ計測を共通した
開発体験で利用できるためである。単純なロジックまでブラウザーで実行する構成にはしない。

## 目標ディレクトリ構成

```text
src/js/
  constants.js
  deal.js
  rules.js
  game-state.js
  view.js
  interactions.js
  app.js
  main.js
tests/
  unit/
    smoke.test.js
    deal.test.js
    rules.test.js
    game-state.test.js
    app.test.js
  e2e/
    helpers.js
    freecell.spec.js
docs/
  refactoring-and-testing-plan.md
package.json
package-lock.json
vitest.config.js
playwright.config.js
```

`src/css/style.css` は今回分割しない。`src/js/game.js` は移行中だけ残し、全責務の
移行後に削除する(Phase 5 で削除済み。責務は上記の目標モジュールへ移行済み)。

## 責務とシンボルの移動

| 移動先 | 主な対象 | 変更方針 |
| --- | --- | --- |
| `constants.js` | `SUITS`、`RANKS`、各セル数、最大ゲーム番号 | 名前付き export にする |
| `deal.js` | `msRng`、`dealGame` | グローバル状態を変更せず初期盤面を返す |
| `rules.js` | 配列判定、移動可否、安全な自動移動、カード探索 | 状態を引数で受け取る純粋関数にする |
| `game-state.js` | 状態生成、移動、履歴、Undo、自動移動、勝利判定、番号補正 | DOM、時刻、表示を呼び出さない |
| `view.js` | DOM 構築、描画、状態表示、通知、勝利画面 | DOM 参照を View 内へ閉じ込める |
| `interactions.js` | クリック、Pointer Events | クリックとドラッグの状態を保持する |
| `app.js` | ゲーム開始、モデルと View の調停、タイマー | 操作後の副作用順を管理する |
| `main.js` | 初期化 | 唯一の HTML エントリポイントにする |

## 状態モデル

状態層は少なくとも次を明示的に保持する。

- `gameNumber`
- `cascades`
- `freeCells`
- `foundations`
- `moveCount`
- `historyStack`
- `selected`
- `won`

カードオブジェクトは不変として扱う。履歴スナップショットは配列を複製し、カード自体は
共有してよい。タイマー、DOM キャッシュ、クリック時刻、ドラッグ状態はゲーム状態に
含めない。

## 実装フェーズ

### Phase 1: 現行挙動を E2E テストで固定

追加・変更するファイル：

- `package.json`
- `package-lock.json`
- `vitest.config.js`
- `playwright.config.js`
- `.gitignore`
- `tests/e2e/helpers.js`
- `tests/e2e/freecell.spec.js`
- `tests/unit/smoke.test.js`

Playwright の座標探索には既存スキルで検証済みの `elementFromPoint` 走査を利用する。
責務分離へ進む条件は、現行の `game.js` に対する主要 E2E テストが成功することである。

Vitest のテストが 0 件で失敗しないよう、この段階でテスト環境自体を確認する最小の
スモークテストを追加する。`passWithNoTests` は使用せず、Phase 1 から `npm test` が
成功する状態を保つ。スモークテストは後続の単体テスト追加後も環境確認として残す。

この段階で勝利盤面の設定など内部状態に触れるテストを書く場合、
`page.evaluate` から直接 `cascades` などを参照するコードを `helpers.js` に集約する。
ESM 移行後には同じ処理を公開テスト API へ差し替えるだけで済み、テスト本体の
書き換えが最小になる。

> 実施メモ(2026-08-09): Playwright は config をメインプロセスとワーカープロセスで
> それぞれ評価するため、config 内で乱択したポートを 3 か所に埋め込むだけでは
> ワーカーの baseURL が別ポートになり接続拒否になる。最初(メインプロセス)に決めた
> ポートを `process.env.FREECELL_E2E_PORT` へ書き戻してワーカーと共有する方式で
> 解決した(ユーザー指定の環境変数はそのまま優先)。

### Phase 2: ESM への切り替えと定数・ディールの抽出

最初に `index.html` を `<script type="module">` へ切り替え、最小の `main.js` を
エントリポイントにする。クラシックスクリプトは ES Modules を import できないため、
ESM の抽出を開始する前に切り替える。この時点で既存の E2E テストのうちクラシックス
クリプト前提の内部参照が壊れるため、Phase 1 で集約した helpers を同時に公開 API へ
対応させる。

この段階では `game.js` 自体も ES Module に変更する。既存の初期化と未抽出の処理を
維持しつつ、`init`、E2E で必要な読み取り専用スナップショット、検証付き fixture
読み込みを export する。`game.js` 末尾の自動 `init()` は削除し、`main.js` だけが
`init()` を 1 回呼び出す。`main.js` はテスト API も再 export するため、テストが同じ
URL の `main.js` を dynamic import してもモジュールキャッシュが働き、再初期化しない。
Phase 5 で暫定 API を正式な app API へ置き換える。テスト API から内部配列の可変参照を
返さず、fixture はカードの一意性や各ゾーンの形式を検証してから適用する。

次に `constants.js` と `deal.js` を追加する。`dealGame(gameNumber)` は新しい初期盤面を
返し、既存のグローバル配列を変更しない。Game #1 の既知配置、52 枚の一意性、列長、
決定性、配列参照の非共有を Vitest で検証する。

> 実施メモ(2026-08-09): テスト API の `snapshot()` が、`game.js` 内に既存の
> 履歴保存用 `snapshot()` と同名衝突し、ESM では同一モジュール内の重複関数宣言が
> SyntaxError になるためページ全体が読み込めなかった。単体テストは `game.js` を
> import しないため検出されず、E2E 実行で初めて発覚した。履歴保存用を
> `captureHistoryState()` へリネームして解消。テスト API は `main.js` の
> `getTestApi()` を helpers.js が `window.__testApi` として保持し、同じ URL の
> dynamic import(モジュールキャッシュ)で `init()` の二重実行を回避している。
> あわせて AGENTS.md の「クラシックスクリプト」記述を ESM 構成へ最小訂正した
> (本格的な文書同期は Phase 6)。

### Phase 3: ルール判定の抽出

`rules.js` を追加し、暗黙のグローバル参照を `state` 引数へ置き換える。色交互降順、
ホーム、カスケード、最大移動枚数、安全な自動移動、カード探索を単体テストする。

> 実施メモ(2026-08-09): `rules.js` の各関数は必要なゾーン配列を引数に取る設計にした
> (`findCardLocation` のみ `{ cascades, freeCells, foundations }` の状態オブジェクト)。
> 依存がシグネチャから明らかになり、Phase 4 で `game-state.js` が state の各配列を
> 渡すだけで済む。`isGrabbable` も配列判定の一部として `rules.js` へ含めた。
> `game.js` は `import * as rules` で委譲し、テスト API の `maxMovable` は従来と
> 同じ 1 引数のラッパーを残したため、E2E の枚数上限テストはそのまま通る。
> 単体テストは `tests/unit/rules.test.js` に 29 件追加した。

### Phase 4: 状態遷移の抽出

`game-state.js` を追加する。`attemptMove` は状態と移動先を受け取り、状態遷移結果だけを
返す。描画、タイマー、トースト、勝利オーバーレイは呼び出さない。

失敗手では状態、履歴、手数を変更しない。成功手では履歴と手数を 1 増やす。Undo、
自動移動、ダブルクリック移動、勝利判定も単体テストする。

`newGameFromInput` にあるゲーム番号の範囲補正ロジックは、`game-state.js` の
`normalizeGameNumber(rawValue)` として純粋関数に定義する。`rawValue` は
入力欄の文字列(`string`)を受け取る想定とし、数値変換と 1〜32000 の範囲検証を
担う。有効値は小数点以下を切り捨てたゲーム番号を返し、空値、非数値、範囲外は
`null` を返す。`app.js` は `null` を受け取った場合にランダム番号を生成する。

> 実施メモ(2026-08-09): `game.js` の状態系モジュール変数 8 個(`gameNumber` /
> `cascades` / `freeCells` / `foundations` / `moveCount` / `historyStack` /
> `selected` / `won`)を単一の `state` オブジェクトへ統合し、状態遷移を
> `game-state.js` へ委譲した。`attemptMove` は状態遷移結果だけを返し、成功時の
> 副作用(連続クリック判定のリセット → タイマー開始 → 描画 → 勝利処理)は
> `game.js` の `onMoveSucceeded()` に集約した。`lastClick` のリセットが
> `attemptMove` 内から消えたため、クリック・ドラッグ・自動移動・ダブルクリック
> の 4 経路すべてでリセットを呼び、「連続クリックで自動移動が連鎖しないこと」を
> E2E 4 件(ダブルクリック / クリック移動 / ドラッグ移動 / 自動移動)で検証した。
> `undo` が `won` を変更しない既存挙動と、`attemptMove` が勝利判定を呼ばない
> 契約も単体テストで固定した。Phase 4 完了時点で単体 80 件・E2E 44 件が全て成功。

### Phase 5: View、入力、アプリケーション制御の抽出

`view.js`、`interactions.js`、`app.js` を追加し、Phase 2 で用意した `main.js` を
本格的なエントリへ拡張する。`app.js` がモデル操作後のタイマー、描画、勝利処理を
調停する。

`checkWin` は現在 DOM の時刻テキスト(`document.getElementById("timer")`)を読み取って
勝利メッセージを組み立てているが、これを廃止し、`app.js` が保持するタイマー状態から
経過時間を生成して View に渡す。

タイマーとランダム番号生成を決定的にテストできるよう、`app.js` は現在時刻、interval の
開始・停止、乱数生成を差し替え可能な依存として受け取る。既定値にはブラウザーの
`Date.now`、`setInterval`、`clearInterval`、`Math.random` を使用し、テストでは fake
clock と固定乱数を渡す。

`tests/unit/app.test.js` を追加し、最初の成功手でタイマーが 1 回だけ開始されること、
新規ゲーム・やり直し・勝利で interval が停止すること、無効なゲーム番号で注入した
乱数が使われること、勝利メッセージへ経過時間が渡されることを検証する。

通常の E2E は DOM 経由で検証する。特殊な勝利盤面などに限り、`main.js` から取得できる
明示的なテスト API を利用する。内部状態を無制限に `window` へ公開しない。
fixture 読込 API をテストモードに限定するかは、ランキング導入時に再検討する。

`game.js` を削除すると、既存の `.github/workflows/deploy-pages.yml` にある
`node --check src/js/game.js` が失敗してデプロイできなくなる。この削除と同時に、
既存の構文チェックを ESM 構成へ追従させる最小限のワークフロー修正を行う。
テストを Actions に組み込む変更は対象外のままとする。

> 実施メモ(2026-08-09): `view.js` / `interactions.js` / `app.js` を新設し、
> `game.js` を削除した。`app.js` は `deps`(now / setInterval / clearInterval /
> random)を差し替え可能な依存として受け取り、テストでは fake clock と固定乱数を
> 注入した。`checkWin` は DOM の時刻テキストを読まず、タイマー状態から経過時間を
> 生成して View へ渡す。`main.js` は `createView` → `createApp` →
> `createInteractions` を配線し、`getTestApi()` を公開する。削除に伴い
> `deploy-pages.yml` の構文チェックを `src/js/*.js` のループへ追従した。
> Phase 5 完了時点で単体 90 件・E2E 44 件が全て成功し、リポジトリ相当の
> サブパス(`/freecell-classic/`)から全モジュールが読み込めることをブラウザで
> 確認した。

### Phase 6: 文書の同期

- `AGENTS.md` を ES Modules と新しい品質チェック手順へ更新する。
- Playwright スキルのグローバル直接参照手順を、ESM の公開 API を使う手順へ更新する。
- `README.md` に開発環境、依存導入、ローカルテストコマンドを追加する。
- 本計画書の進捗と実施結果を更新する。

`CHANGELOG.md` は既存規約どおり、各 Phase のソース変更をその都度記録する。
Phase 6 は初回の記録ではなく、文書全体の最終同期・見直しの段階である。

> 実施メモ(2026-08-09): Phase 6 完了。`AGENTS.md` を ESM 構成・品質チェック
> 手順(`npm test` ほか)へ同期し、Playwright スキルの「内部状態への直接アクセス」
> 手順を ESM の公開テスト API(`main.js` の `getTestApi()` / `tests/e2e/helpers.js`)
> を使う手順へ書き換えた。`README.md` に開発環境・依存導入・ローカルテスト
> コマンドと新しいモジュール構成を追記した。文書のみの変更でソースは変更していない
> ため、CHANGELOG への追記は行っていない。変更した Markdown に markdownlint
> 診断はなく、単体 90 件・E2E 44 件が全て成功することを確認した。あわせて
> 目標ディレクトリ構成の「`game.js` は移行中だけ残し、全責務の移行後に削除する」
> という記述を、削除済みの現状へ修正した。

## テストマトリクス

| 対象 | Vitest | Playwright |
| --- | --- | --- |
| Microsoft 互換ディール | Game #1 の全配置、決定性、一意性 | Game #1 の DOM 配置 |
| 移動ルール | 合法・不正・枚数上限 | クリック、ドラッグによる実操作 |
| 複数枚移動 | 状態遷移と上限 | Game #12 の 2 枚移動 |
| 既知の 1 枚移動 | 状態遷移 | Game #3、#20 |
| Undo | 盤面、手数、履歴 | ボタンと Ctrl+Z |
| 自動移動 | 安全判定と履歴単位 | ボタンと通知 |
| ダブルクリック | ホーム優先、次にフリーセル | 400ms 以内のクリック |
| ドラッグ | 対象外 | 6px 閾値、不正ドロップ、枚数超過 |
| 勝利 | 勝利状態の判定 | オーバーレイとタイマー停止 |
| 入力補正 | `normalizeGameNumber` の整数、小数、空値、非数値、範囲外 | 入力欄からの整数、小数、空値、範囲外 |
| アプリ制御 | 時計、interval、乱数、勝利時の経過時間 | 実際のタイマー表示とゲーム再開 |

ローカルコマンドは次を提供する。

- `npm run test:unit`
- `npm run test:unit:watch`
- `npm run test:e2e`
- `npm run test:e2e:ui`
- `npm test`

## ES Modules 移行の影響

クラシックスクリプトのトップレベル識別子は、ES Modules への移行後に
`page.evaluate()` から直接参照できなくなる。スキルと E2E テストは、DOM を優先して
検証し、必要な場合だけ `main.js` の export または検証付きテスト API を使用する。

同じモジュールを同じ URL で dynamic import した場合はモジュールキャッシュが使われる。
クエリー文字列付きの別 URL で import して初期化を二重実行しない。

## 回帰リスクと対策

### ディール互換性

乱数演算、スート順、デッキ生成順、交換方法、巡回配布のいずれも変更しない。抽出前後で
Game #1 の全配置を比較する。

### 状態遷移と副作用順

成功時の「手数更新、選択とクリック状態の解除、タイマー開始、描画、勝利処理」と等価な
順序をアプリケーション層で維持する。各抽出後に全 E2E を実行する。

### 選択状態と `lastClick` の所有責務

`selected` はゲーム状態として `game-state.js` が所有し、成功した `attemptMove` の中で
リセットする。選択解除と Undo によるリセットも状態層の単体テストで検証する。

`lastClick`(ダブルクリック判定用の最終クリック情報)は入力状態として
`interactions.js` が所有する。`attemptMove` を状態層へ移すと現在のリセット副作用は
残らないため、操作成功を受けた入力・アプリケーション層で必ずリセットする。

再現が必要な経路は次の 4 つである。

- クリックによる移動
- ドラッグ&ドロップによる移動
- `autoMoveHome` による自動移動
- `dblClickAutoMove` による自動移動

いずれかで再現が漏れると、連続クリックで自動移動が連鎖するなどの挙動変化が起きる。
「連続クリックでダブルクリック移動が連鎖しないこと」を単体テストまたは E2E で
検証する。

### Undo の単位

自動移動を一括履歴へ変更しない。カード 1 枚ごとの履歴を単体テストする。

### ドラッグ&ドロップ

矩形重なり、近接距離、ドロップ候補、枚数超過の別検出を維持する。過去に修正した
枚数超過トーストを必須 E2E とする。

### タイマー

interval の二重起動と停止漏れを防ぐ。最初の成功手、勝利、新規ゲーム、やり直しを E2E
で確認する。

### GitHub Pages のパス

ルート絶対パスを禁止し、相対 import のみ使用する。最終確認ではリポジトリ相当の
サブパスからページを配信して全モジュールが読み込めることを確認する。

## 文書更新方針

`AGENTS.md` は設計原則と必須コマンドだけを簡潔に記載する。Playwright の詳細な操作方法は
スキルへ、利用者・開発者向けセットアップは `README.md` へ置く。

Markdown を追加・変更した後は、VS Code の markdownlint 診断を確認して修正する。
ソース変更は `CHANGELOG.md` の既存形式に従って記録する。

## 受け入れ条件

- 本番がバンドルなしの静的ファイルとして GitHub Pages で動作する。
- `npm test` で Vitest と Playwright の全テストが成功する。
- Game #1 の配置がリファクタリング前後で一致する。
- 既知のクリック、複数枚移動、Undo、自動移動、ドラッグ、勝利が自動検証される。
- ドメインモジュールが `document`、`window`、DOM API に依存しない。
- `game.js` の責務が目標モジュールへ移り、移行完了後に削除される。
- `AGENTS.md`、Playwright スキル、`README.md`、`CHANGELOG.md` が実装と一致する。
- 変更した Markdown に該当する markdownlint 診断がない。

## ロールバック方針

各 Phase を独立してコミット可能な単位にする。E2E が失敗した場合は次の Phase へ進まず、
直前の責務抽出だけを戻せる状態に保つ。仕様変更と責務分離を同じ変更へ混在させない。

## 進捗チェックリスト

- [x] Phase 0: 実装計画書の作成
- [x] Phase 1: 現行 E2E テストの追加
- [x] Phase 2: 定数とディールの抽出
- [x] Phase 3: ルール判定の抽出
- [x] Phase 4: 状態遷移の抽出
- [x] Phase 5: View、入力、アプリケーション制御の抽出
- [ ] Phase 6: AGENTS、スキル、README、CHANGELOG の更新
- [ ] Vitest 全件成功
- [ ] Playwright 全件成功
- [ ] GitHub Pages 相当のサブパス配信確認
- [ ] Markdownlint 診断の解消

## 将来の GitHub Actions 統合

ローカルテストが安定した後、既存の Pages デプロイ前に Node.js セットアップ、`npm ci`、
Chromium 導入、`npm test` を追加する。テスト失敗時はデプロイしない。

今回の実装ではテスト統合を行わないが、`game.js` 削除に伴う既存構文チェックの
追従修正だけは Phase 5 で行う。
