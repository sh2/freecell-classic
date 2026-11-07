# 変更履歴

## 2026-11-08

### 機能

- **勝利時カスケード**(tasteful-effects 最終弾)。全カードがホームに揃った
  瞬間に 1 回だけ、ホーム 4 山から K→A の順にカードを放つ演出を追加。
  山はラウンドロビンで 70ms 間隔に 52 枚を放出し、DOM クローンが
  重力 1500 px/s^2 で落下、床 (フッターの上端のライン) で反発係数 0.60・
  水平 0.88 倍、壁で水平反転 0.8 倍、床接触時の |vy| < 70 で静止する
  (回転なし)。ホーム山の実カードは放出に合わせて隠れ、見た目上は山が
  減っていく。飛行中のカード面は 16ms ごとに #stamp-canvas へ焼き付けられ、
  カスケード終了まで残る。全 52 枚が放出済みかつ一度は床に触れた 1 秒後に、
  盤面上のランダムな位置へ仕上げ花火を 190ms 間隔で 20 発上げる。
  全カード静止と全 20 発の発射が揃った後、約 1 秒の余韻を置いて
  カスケード画像を残したまま勝利オーバーレイを重ね、モーダルが閉じた
  タイミングでクローンとスタンプを片付けて実盤面(完成したホーム山)へ戻す。
  カスケード中のポインタ / キー入力は即座に終了処理へ移り、その時点の画像を
  残したままオーバーレイを表示する(ゲーム操作にはならない)。新しい
  ゲームを始めると中断してオーバーレイを出さず、残留物も残さない。
  `prefers-reduced-motion: reduce` と移動アニメーション無効時は発火せず従来どおり
  即オーバーレイ。
  - `src/js/victory-cascade.js`(新規): 放出間隔・初速範囲・重力・反発・
    静止速度・スタンプ間隔・花火の発数 / 間隔 / 待ち時間・余韻・
    カード面スプライトの配色 / 文字比率を先頭に集約。`buildReleaseSchedule` /
    `initialVelocity` / `createFlightState` / `stepFlight` / `resolveFloorY` /
    `fireworkPoint` を純粋ヘルパーとして export し、E2E 用に
    `window.__victoryDebug`(`fires` / `released` / `floorTouches` /
    `fireworks` / `stamps` / `skipped` / `interrupted` / `completed` /
    `visualsRemaining` / `cleared` / `active`)を公開。
  - `src/js/view.js`: カスケードの開始・入力スキップ・中断・片付けを統合。
    `#anim-layer` のクローンで飛行し、実カード寸法から 52 種のカード面
    スプライトをオフスクリーン Canvas に事前描画する。スタンプ用の DOM
    要素は追加しない。スキップ入力は capture 段階で止め、直後の
    click / keyup も 1 回だけ抑止する。床は `.site-footer` の上端
    (取得できない場合は `#game` の下端)を使い、ビューポート下端で丸める。
    カスケード画像は `hideOverlay()` でモーダルが閉じたときに片付ける。
  - `src/js/app.js`: `checkWin` の表示順序を変更し、カスケードを使える
    ときは完了コールバックで `showWin` を呼ぶ。無効時は従来どおり即表示。
    オーバーレイ背景クリックの閉じる処理も `view.hideOverlay()` に集約。
  - `src/js/fx.js`: `burst()` に省略可能な第 4 引数 `maxBursts` を追加し、
    呼び出し単位でのみ同時バースト上限を引き上げられるようにした
    (既定は従来の `MAX_BURSTS = 3` のまま)。仕上げ花火 20 発が
    同時上限で落ちないための最小拡張。
  - `index.html` / `src/css/style.css`: `#stamp-canvas`(fixed・
    `pointer-events: none`・盤面より上・`#anim-layer` より下)を追加。
  - テスト: 単体 `tests/unit/victory-cascade.test.js`(20 件)で定数・
    K→A ラウンドロビン・初速範囲・床 / 壁の反発・静止条件・地面位置・
    花火位置を照合。E2E `tests/e2e/victory-cascade.spec.js`(7 件)で
    (a) 1 回だけの発火と放出中のホーム山の減少、(b) スタンプ蓄積と
    スタンプ用 DOM の不在、(c) 通常の手からの発火、(d) クリック / キー
    入力での即時終了と画像保持、(e) 新規ゲームによる中断と残留物なし、
    (f) 全 52 枚の放出・床接触・フッター上端での静止・仕上げ花火 20 発、
    モーダル表示中の画像保持とクローズ後の片付け、(g) アニメーション無効 /
    reduced-motion 時の即オーバーレイを確認。

## 2026-11-03

### 機能

- **配布アニメーション**(tasteful-effects 第4弾)。新しいゲームの開始時だけ、
  フリーセルとホームセルの間（トップ行）に置いた起点から、52 枚が表向きの
  カードとして現れ、横一列ずつ（第1段は列0→7、第2段も列0→7…）各カスケードへ
  順に飛んで配られる。実カードは着地まで隠し、着地で表示する。配布中は
  盤面操作を受け付けず、最初のポインタ入力またはキー入力で即座に全カードを
  配置して終了する(スキップに使った入力はゲーム操作にならない)。
  ゲーム状態・手数・履歴には一切影響しない。`prefers-reduced-motion: reduce` と
  移動アニメーション無効時は即座に配置する。
  - `src/js/deal-animation.js`(新規): `DEAL_STAGGER_MS` / `DEAL_FLIGHT_MS` /
    `MAX_DEAL_TOTAL_MS` / `DEAL_EASING` を先頭に集約。現在は
    スタガー 14ms・飛行 190ms・52 枚で 904ms(上限 950ms)。`buildDealOrder` /
    `dealTotalDurationMs` / `dealDelayMs` / `computeDealOrigin` を export し、
    E2E 用に `window.__dealDebug`(`plays` / `active` / `dealtCount` /
    `skipped` / `cardCount` / `durationMs` / `immediate` / `forced`)を公開。
  - `src/js/view.js`: `render()` 後に `startDealAnimation(state)` で
    `#anim-layer` 上の表向きクローンを飛ばす。再描画やアニメーション
    無効化時は進行中の配布を即座に確定する。`isDealActive` / `skipDeal` を公開。
  - `src/js/app.js`: `startGame()` から配布を開始。配布中の最初の
    `pointerdown` / `keydown` を capture 段階でスキップへ使い、直後の
    `click` / `keyup` も抑止してゲーム操作・ボタン操作へ漏らさない。
  - `src/css/style.css`: `#anim-layer` 上の配布飛行クローン用のスタイルを追加。
  - テスト: 単体 `tests/unit/deal-animation.test.js`(10 件)で定数・
    行優先の配布順(52 枚が一意)・総時間の上限・起点位置を照合。E2E
    `tests/e2e/deal-animation.spec.js`(7 件)で (a) 表向きクローンの配布、
    (b) クリック / キー入力での即時スキップ、(c) アニメーション無効時の
    即配置、(d) PC / SP 幅での起点の収まり、(e) 配布中のリサイズを確認。
  - 検証: `npm test`(単体 202 / E2E 116)がすべて成功。

- **ヒント時のカード発光**(tasteful-effects 第3弾)。ヒントを表示した瞬間、
  移動元カードの見えている範囲へ淡い白緑の光の帯を 1 回だけ走らせる。
  移動先カードには付けず、複数枚移動のヒントでは移動元の先頭カードのみ。
  帯は専用レイヤー上の別要素で、カードより上の重なりで描くため、列の
  途中が移動元でも後続カードに隠れず、見えている帯の全体に光が通る。
  ヒントが表示され続ける間は再発火せず、ヒントを出し直したときだけ
  もう 1 回走る。発光要素は `pointer-events: none` で、ドラッグ開始時には
  即座に片付けてドラッグレイヤーへ持ち込まない。音・テキスト・画面
  シェイクは伴わない。`prefers-reduced-motion: reduce` と移動アニメーション
  無効時は帯を走らせず、動かない淡い静止光を短く 1 回だけ添える。
  - `src/js/hint-sheen.js`(新規): `SWEEP_DURATION_MS` / `SWEEP_BAND_RATIO` /
    `SWEEP_SKEW_DEG` / `SWEEP_LEAD` / `SWEEP_GREEN` / `SWEEP_WHITE` /
    `SWEEP_TAIL` / `SWEEP_GLOW` / `STATIC_DURATION_MS` / `STATIC_TOP` /
    `STATIC_BOTTOM` / `STATIC_GLOW` を先頭に集約。現在は帯 620ms・幅は
    カード幅の 50%・傾き 14°、静止光は 460ms。`chooseSheenMode` /
    `visibleSheenHeight` を export し、E2E 用に `window.__hintSheenDebug`
    (`plays` / `active` / `mode` / `cardId` / 発光矩形)を公開。
  - `src/js/view.js`: `showHint` で移動元カードへ発光を再生し、`clearHint` /
    ドラッグ開始(`hideCards`)で片付ける。後続カードの矩形から見えている
    高さを求め、発光要素の高さを切り詰める(レイアウト・カード位置は不変)。
  - `src/css/style.css`: `#hint-sheen-layer`(固定・`pointer-events: none`・
    カードより上/移動アニメーションより下)と、掃引・静止光のスタイルを追加。
  - テスト: 単体 `tests/unit/hint-sheen.test.js`(11 件)で定数の範囲・
    発光モードの判定・見えている高さの切り詰めを照合。E2E
    `tests/e2e/hint-sheen.spec.js`(6 件)で (a) 移動元だけに帯が出る、
    (b) 1 回で終わり再表示でだけ再発火する、(c) reduced-motion /
    アニメーション無効では帯が走らず静止光になる、(d) 発光中でも
    ドラッグできてドラッグレイヤーに残らない、移動元が無いときは
    発光しないことを確認。
  - 検証: `npm test`(単体 190 / E2E 109)がすべて成功。

- **ドラッグ中のカードの物理**(tasteful-effects 第2弾)。ドラッグ中の列に
  小さな手触りを加える。先頭カードは水平方向の移動速度に応じて上部中央を
  軸に傾き(右へ速く動かすと右へ、上限 ±5°)、速度が落ちると滑らかに 0° へ
  戻る。2 枚目以降は深さが増すほど柔らかくなるバネで追随し、列がわずかに
  しなる。遅れはカードごとの相対オフセット(x/y 両方向)として付け、
  深いカードほど上限も大きい(2 枚目 6px から最大 22px)。先頭カードの
  「位置」は従来どおりポインタへ正確に追随させ、遅らせるのは後続の
  オフセットと傾きだけにした。ドロップ時は傾きを即座に戻し、遅れは
  バネで収束させながら既存の移動アニメーション(有効時)/
  `animateDragLayerBack`(無効時)へ渡す。`prefers-reduced-motion: reduce`
  と移動アニメーション無効時は物理を一切付けず、従来の剛体ドラッグと
  同じ挙動になる。音・テキスト・画面シェイクは伴わない。
  - `src/js/drag-physics.js`(新規): `MAX_TILT_DEG` / `TILT_FULL_SPEED` /
    `VELOCITY_SMOOTHING_S` / `VELOCITY_STALE_MS` / `MAX_TRACKED_SPEED` /
    `SPRING_STIFFNESS` / `SPRING_DEPTH_FALLOFF` / `SPRING_DAMPING_RATIO` /
    `MAX_LAG_BASE_PX` / `MAX_LAG_STEP_PX` / `MAX_LAG_CAP_PX` /
    `FIXED_STEP_S` / `MAX_FRAME_DT_S` / `SETTLED_EPSILON_*` を先頭に集約。
    現在は `MAX_TILT_DEG=5` / `TILT_FULL_SPEED=1500` / `SPRING_STIFFNESS=1600` /
    `SPRING_DEPTH_FALLOFF=0.35` / 上限 6px + 深さ 1 あたり 1.5px(最大 22px)。
    DOM に触れない純粋な状態機械で、`tiltFromVelocity` /
    `stiffnessForDepth` / `maxLagForDepth` / `stepSpring` と
    `createDragPhysics` を export。
  - `src/js/view.js`: ドラッグレイヤーのカードに transform を適用する rAF
    ループを追加(カードごとの left/top は毎フレーム書き換えない)。
    `positionDragLayer` はレイヤーの left/top を従来どおり同期更新し、
    先頭カードの位置遅れはゼロ。`prepareDragForDrop()` で離した瞬間に
    傾きを戻す。E2E 用 `window.__dragDebug = { enabled, active, tilt, velocity,
    offsets }`(offsets[0] は常に先頭 = 0)を追加。
  - `src/js/interactions.js`: pointerup 時に `prepareDragForDrop()` を呼び、
    既存の移動アニメーション / 戻りアニメーションと競合しないようにした。
  - `src/css/style.css`: `#drag-layer .card` に `transform-origin: 50% 0%` と
    `will-change: transform` を追加。
  - テスト: 単体 `tests/unit/drag-physics.test.js`(13 件)で傾きの符号・
    ±5° クランプ・速度 0、深さごとのバネ/上限、バネの収束、先頭の遅れ 0、
    release 時の挙動を照合。E2E `tests/e2e/drag-physics.spec.js`(4 件)で
    複数枚を速くドラッグした際の傾きの符号と上限、深いカードほど遅れが
    大きいこと、先頭の遅れ 0 とレイヤー位置のポインタ一致、ドロップ成功、
    無効ドロップからの復帰、reduced-motion / アニメーション無効時の
    非適用を確認。
  - 検証: `npm test`(単体 179 / E2E 100。DP-9 のテスト追加後は 103)がすべて成功。

### 修正

- **配布を表向きのカードが起点から飛ぶ形へ変更**(fix-02)。実機確認で、
  裏向きの山札から表向きのカードが出てくる見え方に「どこでめくったのか」
  という不整合が残るため、山札そのものを廃止した。`.deal-stock` の描画と
  カード裏面の束、その生成処理・専用定数を取り除き、52 枚の表向き
  クローンが配布の起点（トップ行のフリーセル群とホームセル群の間）に
  現れて順に各カスケードへ飛ぶ形にした。拡大・フェードなどの追加演出は
  入れていない。起点では次に飛ぶカードが一番上に見えるよう、先に配る
  クローンほど手前の `z-index` にしている。配布順・スタガー 14ms・
  飛行 190ms・総時間 904ms・スキップ・アニメーション無効時の即配置は
  変更していない。
  - `src/js/deal-animation.js`: `computeStockRect` を `computeDealOrigin` に
    改名し、山札用の定数（裏面枚数・ずらし量）を削除。
  - `src/js/view.js`: 山札要素の生成・削除処理を削除し、起点から
    表向きクローンを飛ばす。クローンの重なり順を「次に飛ぶカードが上」に
    変更。
  - `src/css/style.css`: `.deal-stock` / `.deal-stock-card` のスタイルを削除。
  - テスト: 単体 `tests/unit/deal-animation.test.js` を `computeDealOrigin`
    に追随。E2E `tests/e2e/deal-animation.spec.js` に、配布中・配布後とも
    `.deal-stock` が存在しないことの検証を追加し、PC / SP 幅の検証は
    起点クローンの矩形で行うよう更新。
  - 検証: `npm test`(単体 202 / E2E 116)がすべて成功。

- **配布の起点をトップ行へ移動**(fix-01)。実機確認で、トップ行と
  カスケードの間の中央では行間がカード 1 枚分より狭く、配布の起点が
  カスケードのカードに大きく重なって「空中に浮いた位置から配る」見え方に
  なっていた。起点の縦位置をフリーセル／ホームセルの段（トップ行）の
  カードと同じ上端に揃え、横位置をフリーセル群の右端とホームセル群の
  左端の隙間の中央に変更した。隙間がカード幅より狭い SP 幅では隙間の
  中心に置き、配布開始時に空の枠へ多少重なることは許容する。カスケードの
  カードには重ならないよう下端を先頭カードの上端以内に収めた。
  配布順・時間・スキップ・アニメーション無効時の即配置は変更していない。
  - `src/js/deal-animation.js`: `computeDealOrigin` の入力をフリーセル群・
    ホームセル群の矩形へ拡張し、トップ行の上端と隙間中央から位置を求める。
  - `src/js/view.js`: `computeDealOrigin` へ `#free-cells` / `#home-cells` の
    矩形を渡す。
  - テスト: 単体 `tests/unit/deal-animation.test.js` を新しい配置規則へ更新。
    E2E `tests/e2e/deal-animation.spec.js` に、PC 幅で起点がトップ行の帯に
    収まり、どのカスケードカードとも交差しないことの検証を追加。
  - 検証: `npm test`(当時 単体 203 / E2E 116)がすべて成功。

- **ドラッグ開始時にカード間隔が変わって見える問題を修正**。場の列の
  カード間隔は描画時に列の枚数と画面高から 20〜34px で変わるが、
  ドラッグレイヤーは固定 30px で複製していたため、掴んだ瞬間に列が
  広がったり縮んだりして見えていた。`view.js` の `buildDragLayer` で、
  掴んだカード群の実際の `getBoundingClientRect()` から先頭カード基準の
  相対オフセットを求め、その位置で複製を積むようにした。列の途中から
  掴む場合も「今見えている位置」を正とする。バネ追随の自然位置もこの
  実オフセット基準になる。実レイアウトが取得できない場合のみ従来の
  30px をフォールバックに使う。E2E に、間隔 30px 未満の長い列と
  34px の広い列で、ドラッグ開始直後の相対オフセットが元の列と一致
  (誤差 2px 以内)することを確認するテストを追加した。

## 2026-11-01

### 機能

- **ホーム移動時のパーティクル花火**。カードがホームセルへ正常に移動し、
  飛行アニメーションの着地が完了したタイミングで、そのホームセルの
  上端から 33% の高さ(x は中央)から花火が 1 回だけ広がる。
  96 個の粒子は輪郭(速さ係数 0.9〜1.0、約 55%)と内側(0.1〜0.9)の
  2 集団で構成され、バーストごとに金(`#e0a916`)・桜色(`#ef7d9c`)・
  水色(`#45a5e8`)・紫(`#8656e8`)・緑(`#34b26b`)の 5 色から、
  直前のバーストと異なる 1 色を選び、全粒が同じ色で始まる。
  速度は `v *= exp(-BRAKE * dt)` の乗算ブレーキのみで減衰し、弱い重力
  (115px/s^2)で自然に沈む。寿命は 1000ms、粒ごとに 0.7〜1.0 倍の
  ばらつきがある。寿命の 70% までは alpha・大きさを変えず、そこから
  alpha → 0、大きさ → 40% へ速く消える。下向きに転じ、粒ごとの進行度
  しきい値(0.55〜0.68)を超えた粒だけが赤黒(`#571f16`)へ寿命比 0.10 で
  変色する。各粒は約 120ms 間隔で残像を残し、残像は 12〜48px/s で
  沈みながら 0.5〜0.8 秒で薄れる(総数上限 240、粒より先に描画)。
  canvas は加算合成(`globalCompositeOperation: "lighter"`)で描画する。
  直径は 1280x720・DPR 1 の実測で 216〜232px。音・テキスト・
  画面シェイクは伴わない。
  - `src/js/fx.js`(新規): `PARTICLE_COUNT` / `COLORS` / `DURATION_MS` /
    `GRAVITY` / `SPEED` / `PARTICLE_SIZE` / `BRAKE` / `FADE_START` /
    `OUTLINE_RATIO` / `OUTLINE_SPEED_MIN` / `OUTLINE_SPEED_MAX` /
    `INNER_SPEED_MIN` / `INNER_SPEED_MAX` / `EMBER_ENABLED` /
    `EMBER_COLOR` / `EMBER_THRESHOLD_MIN` / `EMBER_THRESHOLD_MAX` /
    `EMBER_TRANSITION` / `TRAIL_*` / `MAX_TRAILS` / `BASE_CARD_WIDTH` /
    `ORIGIN_Y_RATIO` / `MAX_BURSTS` を先頭に集約し、値だけで調整できる構成。
    現在は `GRAVITY=115` / `SPEED=300` / `DURATION_MS=1000` /
    `BRAKE=2.2` / `FADE_START=0.7` / `MAX_TRAILS=240`。
    `devicePixelRatio` 対応の canvas 描画、同時 3 バースト(最大 288 粒)までの
    制限、`prefers-reduced-motion: reduce` 時の抑止、E2E 用
    `window.__fxDebug = { bursts, lastScale, lastColor, trails }` を実装。
  - レスポンシブ追従: 発火時に実際のホームセル幅を測り、
    `scale = セル幅 / BASE_CARD_WIDTH(88px)`(上限 1)を広がり・粒サイズ・
    重力・残像の沈みに掛ける。狭い画面では花火全体がカード幅に比例して
    縮小する。幅 390px では `scale ≈ 0.465` となる。
  - `index.html` / `src/css/style.css`: `pointer-events: none` の
    `#fx-canvas` を全画面固定で追加。盤面より上、オーバーレイより下に配置。
  - `src/js/view.js`: `burstAtHome(cardId)` を追加し、ホームスロットの
    上端 33% の座標で発火する。
  - `src/js/app.js`: クリック/ドラッグ、ダブルクリック、自動ホーム送り、
    自動解答の各成功経路で、ホームへ移動したカードだけを検出する。飛行が
    ある場合は `view.runAfterAnimations()` で着地後に発火し、アニメーション
    なしの経路では描画直後に発火する。
  - テスト: E2E に「視覚効果 (ホーム移動の花火)」を追加(発火回数と canvas
    ピクセル、着地前後の発火タイミング、発火直後の重心が上端 25〜40%、
    時間経過で重心が下がる重力、中央 30% 円内と輪郭帯域の彩色ピクセル比率、
    乗算ブレーキで広がりの伸びが緩やかになること、後半の平均輝度低下、
    ピーク時の直径 205〜235px、残像の描画、連続バーストでの異色選択、
    幅 390px での scale 比例縮小、ホーム以外では非発火、reduced-motion で
    非発火)。単体テストで色・重力・初速・発火位置・基準幅・粒子数・
    2 集団の比率と速度レンジ・フェード・余燼の条件と色・乗算ブレーキ・
    直前と同色を続けない色選択を照合する。
  - 検証: `npm test`(単体 166 / E2E 96)がすべて成功。

## 2026-10-31

### その他

- OGP(Open Graph Protocol)に対応。`index.html` の `<head>` に
  description と `og:title` / `og:description` / `og:type` /
  `og:url` / `og:image`、`twitter:card` のメタタグを追加し、
  Qiita や X などに URL を貼った際のリンクカードでタイトル・
  説明文・画像が表示されるようにした。カード画像はゲーム画面の
  スクリーンショット `ogp.png`(1335x668)をリポジトリ直下に配置し、
  GitHub Pages 経由の絶対 URL で参照する。ゲーム自体の挙動に
  変更はない。
  - 配置場所の訂正: デプロイワークフローが配信するのは
    `index.html` と `src/` のみのため、カード画像は
    リポジトリ直下ではなく `src/img/ogp.png` に置く。

## 2026-08-23

### 機能

- ファビコンを追加。フェルト緑の背景に白いカード(ハート)と金色のカードを
  重ねて描いた SVG(`src/img/favicon.svg`)で、`index.html` の
  `<link rel="icon">` から参照する。配色はゲーム画面の CSS 変数
  (`--felt` / `--gold` / カード赤)に合わせている。SVG のみで PNG/ICO は
  生成しない(モダンブラウザ向け)。
- ページ最下部にフッターを追加。コピーライト(© 2026 Sadao Hiratsuka)と
  GitHub リポジトリ(sh2/freecell-classic)へのリンクを GitHub マーク付きで
  常時表示する。フェルト背景に溶け込む半透明の文字色で、ホバー時に金色に
  変化する。MIT ライセンス化に伴う表示。
  - 配置は sticky footer 方式(`body` を縦フレックス + フッターを
    `margin-top: auto`)。コンテンツが画面より短い間はビューポート下端に
    張り付いて動かず、カードの増減で上下しない。盤面が画面を超えて伸びた
    ときだけ下へ押し出され、スクロールで到達できる。
    ビューポート高は `100dvh`(非対応環境は `100vh` フォールバック)。
- **解法キャッシュ(ソルバー結果の再利用)**。ヒントのたびに Web Worker を
  新規起動してフル探索していたのを、直近に求めた解を盤面スナップ照合で
  再利用する方式に変更(docs/solution-cache-plan.md の実装)。
  「ヒント → 従う → ヒント」のループで再探索が発生しなくなり、
  2 回目以降のヒントは同期表示・自動解答は即再生になる。
  - `src/js/solution-cache.js`(新規): キャッシュエントリ構築
    (`buildSolutionCacheEntry`: シャドウ state 再生により B0〜勝利までの
    盤面フィンガープリント列と手順列を作る)と照合
    (`findProgressIndex`: 末尾側からの一致探索)、`boardFingerprint` を
    提供する純粋モジュール。game-state.js / rules.js のみに依存し
    DOM・Worker に触れない。
  - `src/js/solver-client.js`: 未使用だった `solution` 変数をキャッシュ
    エントリで置き換え。`requestSolution()` の冒頭(計算中ガードの直後)で
    現在盤面を照合し、パス上なら残り手順を供給(ヒントは Worker 起動なしの
    同期表示、自動解答は既存パスと同じ事前準備をしてから `startAnimatedReplay()`)。
    供給時は先頭手の合法性検証 + count 再計算の防御チェックを行い、失敗時は
    キャッシュ破棄して通常探索へフォールバック。Worker 解の受信時
    (stale チェック通過後)にエントリを構築・保存。`boardSnapshot()` は
    `solution-cache.js` の `boardFingerprint()` へ統合。
    E2E 観測用の `getCacheInfo()` を追加。
  - `src/js/main.js`: 新規ゲーム系ボタンの後始末(`clearSolutionOnNewGame`)から
    `solverClient.clearSolution()` 呼び出しを削除。キャッシュの寿命は盤面照合に
    一任し、リスタート後の同番号ディールではキャッシュが即答に使われる。
    テスト API に `solverCacheInfo()` を追加。
  - テスト: 単体 `tests/unit/solution-cache.test.js`(エントリ構築 4件 /
    照合 6件)を新規、E2E `tests/e2e/freecell.spec.js` に「解法キャッシュ」
    ブロック(ヒント→従う→ヒントで再探索なし、逸脱で破棄・再探索、
    アンドゥで維持、リスタートで B0 一致即答、新規ゲームで無効化、
    自動解答のキャッシュ再生)を追加。helpers.js に `solverCacheInfo()` を追加。
  - 検証: `npm test`(単体 144 / E2E 71)がすべて成功。

- **ヒント計算中の進捗表示**。ヒントは自動解答と同じ探索(高速→安全)を
  内部で行いながら、UI 上はボタンが無効になるだけで長時間の沈黙があり
  ユーザーが困惑する問題を改善。
  - `src/js/view.js`: ヒント計算中は `hint-btn` 自体にスピナー(`.busy` クラス +
    `aria-busy`)を即表示し、300ms 経過しても計算が続く場合だけボタンの文字を
    段階表示(「高速探索中…」/「安全探索中…」)へ切り替える
    (`beginHintBusy()` / `endHintBusy()` / `setSolverStage()` の hint 分岐)。
    即答する盤面(キャッシュヒット・高速で解ける配置)では遅延内に完了するため
    文字は変化せずチラつかない。自動解答ラベルはヒント中も不変(従来通り)。
  - `src/css/style.css`: スピナー(CSS アニメ)とヒントボタンの常時最小幅固定
    (10.5em)を追加。押下・段階切替・完了復元のどの遷移でもツールバーの
    配置が動かない(自動解答ラベルの min-width 固定と同じ方針)。
    `prefers-reduced-motion` では回転を停止。
  - `index.html`: `hint-btn` に `aria-live="polite"` を追加(段階表示の読み上げ)。
  - テスト: E2E にモック Worker で段階表示を検証するテストを追加
    (スピナー即時表示 → 高速探索中… → 安全探索中… → 完了で復元、
    自動解答ラベル不変)。
  - 検証: `npm test`(単体 144 / E2E 72)がすべて成功。

- **やり直しの確認ダイアログ**。進行がある状態で「やり直す」を押すと、
  盤面と手数が失われる旨の確認ダイアログを表示する。誤クリックによる
  不可逆なリセット(Undo 履歴ごと消える)を防ぐ。
  - 表示条件は「Undo 履歴がある(= 復元できない進行がある)かつ勝利済みで
    ない」。進行がないときや勝利後は従来どおり確認なしで即座にリセットする
    (フル Undo 後のタイマーリセットなど、無確認で押す意味のある操作を妨げない)。
  - `index.html`: `#confirm-dialog`(勝利オーバーレイと同系のモーダル)を追加。
  - `src/js/view.js`: `showConfirmRestart()`(実行で `true` / 中止で `false` に
    解決する Promise を返す)と `resolveConfirmDialog()` を追加。表示中は
    キャンセルボタンへフォーカスし、閉じたら元の要素へフォーカスを戻す。
    ダイアログ内の Enter=実行 / Esc=中止。キーイベントは `stopPropagation()` し、
    Ctrl+Z 等のショートカットがダイアログの裏で効かないようにしている。
  - `src/js/app.js`: `restart-btn` の直接リスナーを廃止し、同じ番号で
    再スタートする `restartGame()` と判定用の `needsRestartConfirm()` を新設
    (main.js から呼び出す)。
  - `src/js/main.js`: `requestRestart()` で確認フローを配線。実行時は新規ゲーム系と
    同じ後始末(`clearSolutionOnNewGame`)をしてから再スタートする。ダイアログの
    OK / キャンセル / 背景クリックもここで接続。
  - `src/css/style.css`: `.confirm-actions` とキャンセルボタン用の
    `.btn-secondary`(地味な配色で安全な選択肢を示す)を追加。
  - テスト: E2E に確認ダイアログのテスト(キャンセル/Esc/背景クリックで中止、
    Enter で実行、進行がないときは即リセット、勝利後は無確認)を追加し、
    既存のタイマーリセットテストをダイアログ経由に更新。
  - 検証: `npm test`(単体 144 / E2E 76)がすべて成功。

### 修正

- カスケードのカードは `position: absolute` でレイアウト高さに反映されないため、
  `#game` のフロー上の高さが山の実高さより小さくなり、後続要素(フッター)が
  カードの下に回り込む問題を修正。`view.js` の `render()` で各カスケードの
  wrap 要素に山の見た目の高さ(`(枚数 - 1) × overlap + カード高`)を設定する。
- 山の重なり圧縮計算(`budget`)の下側予約域を「`#game` の下パディング +
  フッター高さ + 余白」に拡張。通常のディールでは山が画面内に収まり、
  フッターが押し出されない。予約域を超える極端な積み上げでは従来どおり
  下限 280px が優先され、フッターはコンテンツに押されて追い出される。
- 自動解答のキャッシュヒットパスのコメントを修正。busy 表示の担当を
  `startAnimatedReplay()` 側と記載していたが、実際は直上の `setBusy()` が
  担当する(自動ホーム送りの一時無効化とステージ表示のみが `startAnimatedReplay()` 側)。
  コメントのみの変更で動作への影響なし。
- 勝利直後にツールバーの一部ボタンが無効化されない問題を修正。`view.js` の
  `showWin()` が `syncControls()` を呼んでおらず、最後の render 時点(まだ
  `won` が false)のコントロール状態のままになっていたため、勝利後に
  「ヒント」「ホームへ送る」や自動解答トグルなどが押せていた。
  `showWin()` 内で `syncControls()` を再実行し、UI 状態表
  (docs/ui-state-matrix.md)の「勝利」行どおり完了済みの操作を無効化する。

### テスト

- 自動解答まわりの未テスト挙動を補うテストを追加(単体 +6 / E2E +6)。
  - 単体 `tests/unit/app.test.js`: 自動解答中の排他ガード(`attemptMove` が
    `auto-solving` で拒否される、`undo` / `autoMoveHome` / `dblClickAutoMove`
    も拒否、解除で操作可能に戻る)。モック View に `setAutoSolving()` を追加。
  - 単体 `tests/unit/solution-cache.test.js`: `boardFingerprint` の直接テスト
    (同一盤面は一致、列分割の違い・ゾーンの違いは不一致)。
  - E2E: 自動解答の計算中にクリック/ドラッグが無視されることの実挙動検証
    (既存テストを強化)、計算中のトグル OFF によるキャンセル(Worker 停止・
    ラベル復元・盤面操作の復帰)、Worker エラー時のヒント/自動解答の復帰、
    ドラッグ中のドロップ候補表示(`.drop-hint`)とドロップ先強調
    (`.drop-target`)、勝利後のコントロール無効化(UI 状態表の「勝利」行)。
  - 検証: `npm test`(単体 150 / E2E 82)がすべて成功。

### その他

- MIT ライセンスを適用。`LICENSE`(Copyright (c) 2026 Sadao Hiratsuka)を
  新設し、`package.json` に `"license": "MIT"` を追加、README に
  「ライセンス」セクションを追記。

## 2026-08-22

### リファクタリング

- **未使用コードの削除(整理計画フェーズ 1)**。挙動は変更しない。
  - `src/js/game-state.js`: 未使用の `autoMoveHome()`(バッチ版)を削除。
    自動ホーム送りは `autoMoveOne()` の連鎖方式(`app.js: chainAutoNext`)に
    一本化済みのため。対応する単体テスト(`tests/unit/game-state.test.js` の
    `autoMoveHome` ブロック)も削除。
  - `src/js/view.js`: 未使用の `solutionPanelEl()` を削除。
  - `src/js/main.js`: E2E テストから未使用のテスト API 5 エントリ
    (`requestSolution` / `replaySolution` / `hasSolverSolution` /
    `isAutoSolving` / `cancelAutoSolve`)を削除。常に真になる防御的
    `typeof` チェックを削除。
  - `src/js/solver-client.js`: 旧 API 互換の `replaySolution()` と
    `hasSolution()` を削除。`replaySolution()` 専用だった `applyMove()` と、
    `applyMoveAnimated()` 内の常に真になる `typeof` フォールバックを削除。
  - `src/js/app.js`: 上記により未使用になった `applyMoveInstant()` を削除。
  - `src/js/solver.worker.js`: クライアントが送信しない `fastOptions` /
    `safeOptions` の受け取りを削除(メッセージ契約を `type` / `requestId` /
    `board` / `strategy` に明示)。
  - 検証: `npm test`(単体 137 / E2E 65)がすべて成功。
- **ソルバーの legacy オプション整理(整理計画フェーズ 2)**。挙動は変更しない。
  - `src/js/solver.js`: 後方互換用の `SOLVER_PROFILES.safeRetry` と、
    `solveWithFallback()` の `safeRetry` / `safeRetryOptions` オプション、
    `attempts.safe2` を削除。探索は `fast + safe` の二本構成に一本化
    (旧三本構成は既定で無効だったため、実挙動は不変)。
  - `tests/unit/solver.test.js`: `safe2` 再試行のテスト 2 件を削除し、
    Worker プロトコルテストのモックを二本構成(fast→safe)に合わせた。
  - 検証: `npm test`(単体 135 / E2E 65)がすべて成功。`sample-bench.js`
    (ゲーム 1〜3)でソルバー動作を確認(3/3 解決)。
- **スクリプトと非コード資産の整理(整理計画フェーズ 3)**。挙動は変更しない。
  - `scripts/benchmark/fast-cap-sensitivity.js` を削除(完了済みの 32,000
    ゲーム評価に対するワンオフ解析のため。git 履歴に残る)。
  - `docs/benchmark/README.md`: 補助スクリプト(`sample-bench.js` /
    `profile.js` / `analyze-profile.js`)を「構成」表と「補助スクリプト」節へ
    追記し、使い方を文書化。
  - `.github/workflows/deploy-pages.yml`: 削除済み `game.js` への言及を
    現状に合わせて整理。
  - 計測データ(`docs/benchmark/data/`、約 29 MB)は現状維持(計画の既定案)。
    `npm run benchmark:report` で 32,000 ゲームすべて読み込めることを確認。
- **ドキュメントの整合(整理計画フェーズ 4)**。挙動は変更しない。
  - `docs/archive/ui-state-matrix.md` を「生きた仕様」として `docs/` 直下へ
    戻した。5 章「既知の不整合」を「解決済みの不整合」に書き換え、7 章
    「今後の修正方針」を削除。3 章の「現在の制御箇所」を `syncControls()`
    実装に合わせて更新し、ヒント 10 秒自動消去(2026-08-21)を 4.3 に追記。
  - `README.md`: ソルバー改善記録へのリンクを `docs/archive/` 配下へ修正。
  - `src/js/view.js`: `syncControls()` のコメント参照先
    (`docs/ui-state-matrix.md`)はファイル移動により正しくなったため変更不要。
- **構造改善リファクタリング(整理計画フェーズ 5)**。挙動は変更しない。
  - `src/js/solver-client.js`: `cancelAutoSolve()` / `cancel()` を簡素化。
    到達しない「保険」分岐と重複したトグル OFF 処理を削除し、未使用の
    `cancelReplay()` を削除。`cancel()` は `activeRequest.autoPlay=true` なら
    常に `autoSolving=true` になる不変条件から、`wasAuto` 判定を廃止して
    mode を `"hint"` に固定。
  - `src/js/view.js`: `syncControls()` 周りの 4 変数(`_lastState` /
    `_autoSolvingFlag` / `_solverBusyFlag` / `solverMode`)を 1 つの
    `controlsState` オブジェクトへ集約。
  - `src/js/game-state.js`: 内部利用のみの `findAutoMoveCard()` を非公開化。
  - `src/js/view.js` / `src/js/app.js`: 内部利用のみの `makeCardEl()` /
    `newRandomGame()` を返り値オブジェクトから除外。
  - `tests/unit/smoke.test.js` を削除(Phase 1 名残の冗長なスモークテスト)。
  - 検証: `npm test`(単体 134 / E2E 65)がすべて成功。ブラウザで手動確認
    (初期コントロール状態・自動解答トグル ON/OFF・ヒント・新規ゲーム・移動)。

### ドキュメント

- **README.md を現状に追従**。2026-08-15 以降に追加された機能(ヒント、自動解答、
  詰み検出、内蔵ソルバー)を「機能」へ追記し、ツールバー改名後の表記
  (「ホームへ送る」「自動で送る」)へ統一した。「技術構成」へ `solver.js` /
  `solver.worker.js` / `solver-client.js` を追加し、「開発」へソルバーベンチマーク
  の説明、「ドキュメント」セクション(`docs/` 資料へのリンク集)を新設した。
- **AGENTS.md へ README 更新のガイドラインを追記**。ソースファイル変更のうち
  ユーザー向けの挙動(機能の追加・廃止・UI / 操作の変更)が変わるものは
  `README.md` の「機能」「技術構成」も更新する旨を明記した。

## 2026-08-21

### 改善

- **ヒントのハイライトを10秒で自動消去するように変更**
  （`src/js/view.js`）。従来は `hint-source` / `hint-target` が手動操作
  （移動・Undo・自動解答開始・新規ゲーム）まで残り続けたため、放置時に
  視覚ノイズになっていた。`showHint` で 10 秒後の `clearHint` を
  `setTimeout` で予約し、`clearHint` でタイマーを解除するようにした。
  手動操作時の既存の解除パスは維持し、タイマーは上書き・解除で多重発火しないようにした。

### 修正

- **ヒントのカスケード宛先がハイライトされない不具合を修正**
  （`src/css/style.css`）。`src/js/view.js:showHint` はカスケード宛のとき
  最上段カード（空列ならスロット）に `hint-target` を付与するが、CSS は
  `.slot.hint-target` のみで `.card.hint-target` が未定義のため、カードが
  ある列では不可視だった。`.card.hint-target` に `.card.hint-source` と
  同等の緑枠スタイルを追加し、ターゲット列の1枚（最上段カード）が
  ハイライトされるようにした。
- **ヒントの移動元と移動先を破線で区別**
  （`src/css/style.css`）。列→列などで両方がカードになる場合に
  `hint-source`（実線）と `hint-target`（破線）が同色で区別できないため、
  `hint-target`（`.card.hint-target` / `.slot.hint-target`）を破線に変更した。
- **ヒントのホーム宛先を山の最上段カードをハイライトするように修正**
  （`src/js/view.js`）。従来は `home` 宛が常にスロット枠を光らせていたため、
  スートが積み上がっている場合に空き部分が光って見えていた。カスケードと
  同様に最上段カードがあればそのカード（破線）、空ならスロットを `hint-target`
  にするようにした。
- **ヒントでホームの誤った空き枠が光る不具合を修正**
  （`src/js/view.js`）。ソルバーは `home` の `destIndex` をスート固定
  （0=♣,1=♦,2=♥,3=♠）で返すが、UIの `foundations`/`homeSlotEls` は置かれた順
  （スロット順）のため、`♥A` が `slot0` にあるのに `♥2` のヒントが
  `slot2` の空き枠を光らせる事があった。表示側でスートから正しい
  スロット（同スートの山、なければ空きスロット）を探してハイライトする
  ようにし、`game-state.js:113-119` の移動時補正と整合させた。

## 2026-08-20

### ドキュメント

- **`docs/ui-state-matrix.md` を追加**。ゲーム状態を3層に整理し、
  状態遷移図（Mermaid）、全コントロール一覧、状態 × コントロール対応表、
  既知の不整合、推奨ポリシー、今後の修正方針を定義した。

### 修正

- **クリア済みゲームは元に戻せないように修正**
  （`src/js/app.js` / `src/js/view.js`）。勝利後、`state.won` が残ったまま
  `undo` すると盤面は戻るが操作不能になる不具合があった。クリア済みは
  `undo` を無効化（`app.undo` で `state.won` 時に早期 return）、ツールバーの
  Undo ボタンも `won` 時に disabled にした。詰み時の「1手戻す」は従来通り有効。
- **ヒント押下時の自動解答ラベルのチカチカを解消**
  （`src/js/view.js` / `src/css/style.css`）。ヒント計算中は自動解答ラベル
  （`#auto-solve-label`）を変更せず、トグルのみ無効化する。ラベル幅は
  `min-width: 6em` で固定し、自動解答中の状態表示（計算中…/高速探索中…/
  安全探索中…/自動解答中…）でボタン位置が動かないようにした。
- **自動解答中にトグルをOFFへ戻せるように修正**
  （`src/js/solver-client.js` / `src/js/view.js`）。自動解答（探索中・再生中）
  はトグルを有効のまま保ち、OFF操作で `cancelAutoSolve` により計算/再生を
  中断してトグルをOFFに戻す。盤面ブロック（`#game.auto-solving`）は維持。
- **UI状態表に基づく Enable/Disable の一貫性を改善**
  （`src/js/view.js` / `src/js/solver-client.js` / `src/js/app.js` /
  `src/css/style.css` / `tests/e2e/freecell.spec.js`）。
  `docs/ui-state-matrix.md` の「あるべき姿」に準拠して以下を修正した。
  - `view.js` に `syncControls()` を新設し、`updateStatus()` /
    `setAutoSolving()` / `setSolverBusy()` から呼び出して有効/無効を一元管理。
    自動解答 計算中・再生中は「新しいゲーム」「やり直す」「開始」「No.入力」
    「元に戻す」「自動移動」「自動でホームへ送る」を無効化し、勝利時は
    該当コントロールを無効化、詰み時は自動移動を無効化する。
    `setSolverBusy()` のラベル復元は `dataset.prevText` の有無に依存せず
    必ず「自動解答」に戻すように修正。
  - `solver-client.js` で `finishAutoSolve()` は
    `view.setSolverBusy(false,"auto")` を直接呼んでラベル復元を確実化し、
    `cancelAutoSolve()` / `cancel()` の全パスでモードを明示。
    `startAnimatedReplay()` と `requestSolution({autoPlay:true})` で
    元の `autoMoveEnabled` を保存し終了時に復元する（`true` 固定を廃止）。
    `app.getAutoMoveEnabled()` を追加。
  - `style.css` で `disabled` のトグルラベルに透過スタイルを追加。
  - `freecell.spec.js` で「移動できるカードがなければトースト」テストを
    「ボタンは無効化される」へ更新（状態表で `auto-move-btn` は
    送れるカードがなければ無効化されるため）。
- **ツールバーのグループ化と「ホームへ送る」への改名**
  （`index.html` / `src/css/style.css`）。5つの `control-group` に分割し、
  「新しいゲーム」/「やり直しとアンドゥ」/「ホーム回収」/
  「ヒントと自動解答」/「情報」で視覚的に区別した。「自動移動」→
  「ホームへ送る」、「自動でホームへ送る」→「自動で送る」に改名し、
  対で意味が通るようにした。

## 2026-08-19

### 機能

- **ヒントを「次の一手だけ」に変更**（`src/js/solver-client.js` / `src/js/view.js` / `index.html`）。探索後に解答パネルは出さず、次の一手の移動元カード（`hint-source`）と移動先スロット（`hint-target`）をハイライトし、トーストで手順を表示する。手動操作でハイライトは自動解除される。
- **自動解答をトグル化し、1手ずつアニメーションで再生**
  （`src/js/solver-client.js` / `src/js/app.js` / `src/js/view.js` /
  `src/js/main.js` / `src/js/interactions.js` / `index.html` /
  `src/css/style.css`）。`#solve-btn` をチェックボックス型の
  `auto-solve-toggle` に置換。ONで解を探索し、1手ずつ飛行アニメーション
  （完了後250ms待機）で自動再生する。解き終わったら全解答手順パネルを表示し、
  トグルは自動でOFFに戻る。自動解答中（探索中・再生中）は盤面操作
  （クリック/ドラッグ/`undo`/`autoMove`）をブロックし、`#game.auto-solving`
  で視覚的に示す。新しいゲーム/やり直しで自動解答・ヒント・パネルをリセットする。

### リファクタリング

- **fast 上限を 2M → 1M に縮小、safe 上限を 12M → 10M に縮小**
  （`src/js/solver.js`）。全32,000件を `fast 1M + safe改 10M adaptive(1.2→1.5)`
  で再計測し **31,999/32,000** を維持（`#11982` のみ node-limit、フォールバック23件、
  総ノード358,718,165 / 総時間646,333ms）。`safe` 10M でも `#10353:16,941` /
  `#13331:5,135,191` / `#17978:3,354,164` / `#1941:584,400` を余裕で解決
  （上限5Mでも同解決率だが10Mで余裕を確保）。適応閾値を `33%/83% → 50%/85%`
  （5M/8.5M）に変更し、`#17978`（w1.2で3.35M要する）が閾値直前で切り替わらないようにした。
- **fast の moveScore を最適化**（`src/js/solver.js`）。`nonEmpty`
  （空き列より既存列優先）加点を `5000 → 8000` に上げ、`safeFoundationMoves` で
  fast のみ適用（safe改は `1941` 等で空列生成が重要なため分離）。500件/1000件で
  A/B 計測し `fast 1-1000 total 10,686,877 → 10,082,983（-5.6%）`、
  `fast-safe 1-200 total 1,836,387 → 1,678,627（-8.5%）`。共通適用では
  `safe改 #10353` が `16,941 → 433,019` に悪化するため fast 専用化で回避。
- **safe 改(案B)へ統合 — fast + safe の二本構成に簡素化**（`src/js/solver.js` /
  `tests/unit/solver.test.js`）。旧三本構成 `fast 2M + safe 10M/w1.1 + safe2 2M/w1.5`
  を `fast 1M + safe改 10M/適応` の二本に統合した。`safe改` は単一 `solve` 内で
  `tailStartWeight` を 1.2 → 1.35 → 1.5 に段階的に上げる適応スケジュールで、
  固定 w1.1 は `#10353`/`#13331` が、固定 w1.5 は `#17978` が解けないトレードオフを
  解消する。外部は `fast`/`safe` の二本のみに見え、旧 `safe2` は `safeRetry:true`
  指定時のみ後方互換として動作する。単一探索内に統合したことで置換表の再利用も改善した。
  難関8件(旧 safe2 対象含む)は `safe改 10M` 単独で 8/8 解決を維持し、
  通常 1-200 の総ノードは `fast-safe` で1,678,627と改善。

### アーキテクチャ評価

- フェーズDを実施。最終ヒューリスティックで通常800ゲーム + 難関8ゲームを比較し、
  `fast` / `safe` / `fast-safe` の解決率・ノード数・時間を測定した。`safe` 単一モードは
  `fast-safe` より通常サンプルの総ノード数・総時間が大きく、解決率も改善しなかったため
  不採用とした。
- `fast-safe` の二段階構成を維持する。全32,000ゲームを現行ロジックで再計測し、
  **31,999/32,000 解決**（`node-limit` は `#11982` のみ）を確認した。
  旧ロジックの履歴値（31,974/32,000、`node-limit` 26件）から解決率が改善した。
- **safe2 再試行を追加**（`src/js/solver.js` / `src/js/view.js`）。safe が上限で打ち切られた
  ときに、より強いヒューリスティック（`tailStartWeight=1.5`、上限2M）で再試行する。
  これにより `#10353` / `#13331` が解決可能になった（`node-limit` 3件 → 1件）。
  既に safe で解けるゲームは safe2 に到達しないため挙動は不変。`options.safeRetry` で無効化可。
  ※本日後半に案Bで `safe改 12M/適応` に統合し、二本構成へ簡素化した。
- fast 上限の感度分析を実施（`scripts/benchmark/fast-cap-sensitivity.js`）。fast で解けるが
  safe では解けないゲーム（`#17978`）が存在するため、上限を 130万 未満に下げると解決率が
  下がる。解決率を維持するには上限 130万 以上が必要。上限 200万 → 150万 への変更を推奨するが、
  実際の効果は上限変更後の全32,000ゲーム再計測で確認する。
- 詳細な比較値と今後の課題は `docs/solver-insights-and-improvement-plan.md` §3.4.1–3.4.3 に記録。

### 性能改善

- フェーズB（1ノードあたりの処理速度向上）を実施(`src/js/solver.js` /
  `docs/solver-insights-and-improvement-plan.md` /
  `docs/benchmark/data/profile-*-after-b.cpuprofile`)。
  - 手を 32bit 整数にパックして move オブジェクトの生成を廃止。スコアは並列配列で管理し、
    `Array.prototype.sort` の比較器をやめて連動型の安定挿入ソートへ変更した。
    探索終了時にオブジェクト形式へアンパックして返すため API・UI・テストは不変。
  - `getStateHash()` を軽量化。`Array.from` + `Array.prototype.sort` をやめ、再利用バッファの
    安定挿入ソートへ変更（8列固定で比較は高々28回）。順序は従来と完全一致するため探索結果は不変。
  - 置換表の `tt.stats()` をカウンタ管理化し、容量 $2^{22}$ の配列全走査（1回 37〜46ms）を廃止。
  - `canPlace()` が候補ごとに再計算していた移動可能枚数上限を、`generateMoves()` の冒頭で
    移動先ごとに1回だけ計算する `maxMoveByDest` 配列へ変更し、重複走査を排除した。
  - 効果（探索ノード数は完全に同一で実行時間のみ短縮）:
    - #720 (fast): 1,297 ms → 約 794 ms（約1.6倍）
    - #14212 (safe): 9,235 ms → 約 4,890 ms（約1.9倍）
  - `getStateHash` のクラスタは #14212 で約41% → 9.75% に減少し、ボトルネックの主役が
    `generateMoves` へ移った。

### 探索効率改善

- フェーズC（探索ノード数削減）の対称性削減と置換表の置換方針を実施(`src/js/solver.js` /
  `docs/solver-insights-and-improvement-plan.md`)。
  - 空きフリーセルへの移動先を先頭スロットへ正規化。フリーセルはスロット番号を状態ハッシュが
    区別しないため、複数の空きスロットへ置く遷移は同値であり、先頭1スロットだけに限定した。
  - 列全体を空列へ移す自己対称手を除外。列順を正規化する状態表現では列ラベルの入れ替えに
    過ぎないため、移動前と同一状態になる分岐を生成しない。
  - 置換表の置換方針を改善。プローブ上限到達時、先頭スロットを無条件上書きするのをやめ、
    窓内で最も g が大きい（枝刈り価値が低い）エントリを置き換える（現負荷では overwrites=0 のため
    実測効果なし、高負荷時の防御）。
  - ノード数削減効果:
    - #720 (fast): 1,538,122 → 1,449,895（-5.7%）
    - #14212 (safe): 8,832,537 → 8,501,203（-3.8%）
    - #6240 / #3670 / #4016 (safe): 各 -3.9% / -7.7% / -4.7%
  - 検証: ゲーム1〜200 は 200/200 解決、難関ゲームも解決継続（#11982 は node-limit のまま）、
    単体 140 件・E2E 63 件すべて成功。

### 手順評価・ヒューリスティック改善

- フェーズC の A/B 比較により、`moveScore` とヒューリスティック $h$ を改善
  (`src/js/solver.js` / `docs/solver-insights-and-improvement-plan.md` /
  `scripts/benchmark/sample-bench.js`)。
  - `moveScore`: 露出カードが低ランク（rank ≤ 3）なら +6000 を加点。将来のホーム送り素材を
    早期に露出させることで探索を効率化。
  - $h$: `tailStart` の重みを1.1倍に変更。難関ゲームが1回の反復で解を見つけるようになり
    大幅に縮小、通常ゲームも効率が改善（固定サンプルでの A/B 比較で1.1倍が最良と判定。
    1.25倍以上は通常ゲームで逆効果、2倍では node-limit 発生のため不採用）。
  - 残余 cutoff の保存は「最初（最浅）の訪問で cutoff が既にルートへ伝播するため冗長」として
    見送り（計画書に根拠を記録）。
  - 効果:
    - 通常ゲーム1〜400: すべて解決。200ゲームあたり合計ノード約1.84M（ベースラインの
      約2.84M から約35%削減）。
    - 高速モード未解決26ゲーム: 25/26 解決（#11982 のみ node-limit）。**20ゲームが
      fast モードだけで解決**（従来 0 ゲーム）。**#26334 は従来未解決だったが fast で解決可能に**。
  - 検証: 単体 140 件・E2E 63 件すべて成功。markdownlint 診断クリア。

## 2026-08-18

### 性能計測

- フェーズA（CPUプロファイリングとボトルネック特定）を実施
  (`docs/solver-insights-and-improvement-plan.md` / `docs/benchmark/data/profile-*.cpuprofile`)。
  - `node --cpu-prof` で通常ゲーム（#720, fast）と難関ゲーム（#14212, safe, 8.8M nodes）の
    プロファイルを採取し、関数単位の自己時間を集計した。難関ゲームは安全モードで
    数百万ノードをスキャンする代表として選定（#3670 から差し替え）。
  - `getStateHash()` が最大のボトルネック（内部のソート比較器を含むクラスタ合計で
    通常 27% / 難関 41%）、`generateMoves()` が続く（クラスタ合計 通常 23% / 難関 19%）
    ことを定量化した。`moveScore()` は呼び出し最多だが約 1% と安価で、
    `tt.lookup()` / `tt.store()` も軽量（合計 0.7%）と判明した。
  - 詳細な数値・フェーズBへの示唆は計画書 §3.1.1 に記載。

### 機能追加

- ソルバーにプロファイリング用の呼び出し回数カウンタを追加(`src/js/solver.js`)。
  `options.trackCounters` が真のとき `stats.profile` に関数別の呼び出し回数
  （getStateHash / generateMoves / moveScore / movesGenerated /
  ttLookup / ttStore / makeMove / findHomeMove）を記録する。
  既定では無効で探索結果に影響しない。

### 開発ツール

- CPUプロファイリング用ドライバと解析スクリプトを追加
  (`scripts/benchmark/profile.js` / `scripts/benchmark/analyze-profile.js`)。
  - `profile.js`: 指定ゲーム・戦略でソルバーを実行し、ノード数・時間・置換表統計・
    呼び出し回数カウンタを表示する（`--cpu-prof` と組み合わせて使用）。
  - `analyze-profile.js`: `.cpuprofile` を関数単位の自己時間・総時間に集計して表示する。
    無名関数は「ファイル:行」単位で分離して集計する（`Array.sort` の比較コールバック等が
    1つに混ざらないように）。

## 2026-08-17

### 修正

- フェーズ4の全32,000ゲーム性能評価を完了(`docs/benchmark/data/` /
  `docs/benchmark/report.html` / `docs/benchmark/`)。`fast-safe` 戦略で31,974件を
  解決し、解決率99.919%となった。26件は高速・安全モードともに`node-limit`、
  `time-limit` と `unsolvable` は0件だった。`unsolvable` は64bit Zobrist衝突を
  無視した探索上の結果であり、数学的な完全証明ではない。

- フェーズ3レビュー指摘を反映(`src/js/solver.js` / `tests/unit/solver.test.js` /
  `docs/`)。両モードで安全化した逆手除外を有効化し、APIコメントへ
  `search-exhausted` と、64bit Zobrist衝突を無視した `unsolvable` の意味を追記した。
  逆手除外の有効・無効で小規模盤面の解決可能性が一致する回帰テストを追加し、
  ソルバー実装レポートの古い容量・ヒューリスティック・自動ホームの説明を更新した。

- フェーズ3の安全モード基盤を整理(`src/js/solver.js` / `tests/unit/solver.test.js`)。
  置換表は計算量とメモリ使用量を抑えるため64bit Zobristハッシュのみで状態を
  識別する方針に統一した。ハッシュ衝突は実用上無視するが、`unsolvable` は衝突が
  発生していないという仮定付きの探索結果であり、数学的な完全証明ではないことを
  文書化した。プローブ数、最大プローブ長、上書き数、負荷率の統計は維持した。

- ソルバーを二段階探索へ変更(`src/js/solver.js` / `src/js/solver.worker.js` /
  `src/js/solver-client.js` / `src/js/view.js` / `src/js/main.js`)。高速モード(200万ノード)
  で解けなかった場合、同じ開始盤面から安全モード(1,000万ノード)へフォールバックする。
  Workerの段階通知、探索中の表示、リクエストID、盤面スナップショット照合、キャンセルを
  追加し、古い盤面への解答適用を防止した。

- 二段階探索結果の集計を修正(`src/js/solver.js` / `tests/unit/solver.test.js`)。
  `totalTimeMs` を各段の探索時間の合計として算出し、安全モード単独実行を
  `fallbackUsed` と誤認しないようにした。未知の戦略値はエラーとして拒否する。

- フェーズ2のテスト・計測基盤を追加(`tests/unit/solver.test.js` /
  `tests/e2e/freecell.spec.js` / `scripts/benchmark/` / `docs/benchmark/README.md`)。
  Workerの段階通知を単体・E2Eで検証し、ベンチマークを `fast` / `safe` /
  `fast-safe` 戦略、段別設定、フォールバック率、追加解決数、合計ノード・時間の
  記録とレポート表示に対応した。

- ソルバーに自動ホーム方式の切替と探索カウンターを追加
  (`src/js/solver.js` / `scripts/benchmark/run.js`)。安全条件付き方式と無条件自動ホーム
  方式を比較できる `safeFoundationMoves` / `--unsafe-home` を追加し、安全でないホーム
  手の生成・試行・解決到達・行き止まり、置換表ヒット数、探索深度などを結果へ記録する。

- ソルバーの自動ホーム移動に Horne's Rule に基づく安全条件を追加
  (`src/js/solver.js` / `tests/unit/solver.test.js`)。A は常に自動移動し、低ランクの
  カードは反対色スートの土台が必要な位置まで進んだ場合だけ自動移動する。安全でない
  合法なホーム移動は探索分岐として残し、解を取りこぼさないようにした。

- ソルバーの経過時間測定を `Date.now()` から `performance.now()` へ変更
  (`src/js/solver.js`)。VirtualBox Guest Additions などによるシステム時刻の補正で
  測定時間が逆行する問題を防ぎ、時間上限判定と `timeMs` の測定を単調増加タイマーに
  統一した。

- ソルバーの列正規化キーを修正(`src/js/solver.js` / `tests/unit/solver.test.js`)。
  - 従来の全列カードを位置ごとに XOR する方式では列の境界を失い、異なる列構成を
    同一状態として置換表で誤って枝刈りする可能性があった。
  - 列ごとのハッシュを計算してソート後に結合する方式へ変更し、列の順序だけを
    正規化しつつ、列境界と列内順序を保持するようにした。
  - 列順序の同一視、列境界、列内順序を検証する単体テストを追加した。

### 開発ツール

- node-limit ゲームの再検証スクリプトを追加(`scripts/benchmark/verify-node-limit.js`)。
  - 既存バッチ結果(`batch-XX.json`)で `status` が `node-limit` のゲームだけを、
    より大きい `maxNodes` で再計測して比較する。バッチ進捗には影響しない。
  - 結果は `docs/benchmark/data/verify-node-limit-<batch>-<maxNodes>.json` に保存。
  - バッチ 1 (ゲーム 1〜1000) の node-limit 134 ゲームを `maxNodes=5,000,000` で
    再検証した結果、**37 ゲームが solved に、97 ゲームは node-limit のまま**だった
    (time-limit / unsolvable は 0)。結果は
    `docs/benchmark/data/verify-node-limit-01-5000000.json` に記録。

## 2026-08-16

### 機能追加

- 詰み(ゲームオーバー)検出を追加(`src/js/game-state.js` / `src/js/app.js` /
  `src/js/view.js` / `index.html` / `src/css/style.css`)。
  - 合法手が 1 つも残っていない状態を検出し、オーバーレイ「詰みました」を
    表示する。ボタンは「1手戻す」「新しいゲーム」の 2 つ(既存 `#overlay` を
    流用し、背景クリックで閉じられる)。
  - `game-state.js` に純粋関数 `hasAnyMove` と `checkStuck` を追加し、
    `createState` に `stuck` フラグを追加。単独カードの移動だけを確認すれば
    十分(複数枚移動は空きフリーセル/空きカスケードが必須で、その場合は
    必ず単独カードの移動も成立するため)。
  - 勝利(`won`)とは独立。詰みではタイマーを止めず、Undo で脱出できる。
    `undo` は `stuck` を解除する。
  - テスト API の `snapshot` に `stuck` を追加。

- フリーセルソルバーを追加(`src/js/solver.js` / `src/js/solver.worker.js` /
  `src/js/solver-client.js` / `src/js/view.js` / `src/js/main.js` /
  `index.html` / `src/css/style.css`)。
  - IDA\*(反復深化 A\*) + 自動ホーム + Zobrist ハッシュの置換表による探索。
    盤面はカード id の配列で受け取り、勝ち手順(移動のリスト)を返す。
    ホームへの移動は常に安全なため、分岐ではなく決定的な自動ホームとして
    必ず適用して状態空間を削減する。
  - ツールバーに「ヒント」「自動解答」ボタンを追加。解答は Web Worker で
    実行して画面をブロックせず、結果は「解答手順」パネルに一覧表示する。
    「自動解答」は手順を 1 手ずつ再生してクリアまで進める。
  - 探索はノード数・時間の上限で打ち切り、解けなかった場合はトーストで
    通知する(完全な「解けない」証明は行わず、上限到達として報告する)。

### 性能改善

- ソルバーの探索性能を改善(`src/js/solver.js` / `tests/unit/solver.test.js`)。
  - Zobrist ハッシュの列ハッシュを「列内の位置」だけで決める方式に変更し、
    列の並び順が違うだけの同一局面を同一ハッシュへ帰着させた(列の対称性の
    正規化)。置換表のヒット率が上がり、Game #12 はノード上限(200 万)で
    解けなかった状態から、約 7.2 万ノード / 約 0.14 秒で解けるようになった。
  - 手の試行順を改善。移動で露出するカードが自動ホーム対象になる手と、
    空き列を作る手の重みを引き上げた。
  - 空列への移動手は先頭の空列 1 つに正規化し、重複生成を排除した。
  - 置換表の容量を 2^21 → 2^22 スロットへ引き上げた。
  - 状態空間が縮小したことで、解けない小さい盤面は全状態を探索し尽くして
    `unsolvable`(解けない証明)を返すようになった。テストを追従更新した。

### 修正

- ツールバーのボタン構成を整理(`index.html` / `src/js/app.js`)。
  - 旧「新しいゲーム」(No.入力欄の値で開始)と「ランダム」を統合し、
    「新しいゲーム」を「ランダムな新規ゲーム」に統一。オーバーレイの
    「新しいゲーム」と同じ動作になった。
  - No.入力欄の横に「開始」ボタン(`#start-game-btn`)を追加。番号指定開始は
    Enter でも従来どおり可能。

### 開発ツール

- ソルバーベンチマークの測定ハーネスを追加(`scripts/benchmark/run.js` /
  `scripts/benchmark/report.js` / `docs/benchmark/` / `package.json`)。
  - ゲーム番号 1〜32,000 を 1,000 ゲームずつバッチで**シリアル**計測する。
    `dealGame()` で盤面を生成し、`solve()` を直接呼んで `status` / `nodes` /
    `timeMs` / `moves` 数を記録する。
  - 結果は `docs/benchmark/data/batch-XX.json` に保存。途中経過は
    `batch-XX.partial.json` に毎ゲーム書き出し、中断・再開に対応。
  - `--start` / `--count` で指定範囲も計測可能 (`range-*.json`。バッチ進捗に
    影響しない)。
  - `npm run benchmark:report` で、計測結果を自己完結型 HTML
    (`docs/benchmark/report.html`) にまとめる。サマリ / 状態別内訳 /
    バッチ進捗 / 応答時間・ノード数のヒストグラム(対数ビン)/ ゲーム別結果
    (状態フィルタ・列ソート・ページング)を表示。

## 2026-08-15

### 機能追加

- カード移動アニメーションを追加(`src/js/view.js` / `src/js/app.js` /
  `src/js/interactions.js` / `src/css/style.css`)。
  - 成功した移動(クリック移動・ドラッグ&ドロップ・ダブルクリック自動移動・
    自動移動ボタン・「自動でホームへ送る」)で、カードが移動元の位置から
    目的地まで飛行する。描画(`render()`)は即座に完了した盤面を生成し、
    アニメーションは `#anim-layer` 上のクローンで表現する(実カードは飛行中
    `.anim-hidden` で隠す)。
  - 飛行時間は距離に比例(150〜400ms に clamp)。
  - 自動ホーム送りが複数枚動く場合は 1 枚ずつ順番に送る(はしご状)。
  - 不正なドロップ先へ落としたときは、ドラッグレイヤーが元の位置へ飛んで
    から消える戻りアニメーションを追加。
  - `prefers-reduced-motion: reduce` の環境では既定で無効。テスト API
    (`setAnimationsEnabled`)で切り替え可能。
  - `game-state.js` の `autoMoveHome` は移動したカードの配列(移動順)を
    返すように変更(アニメーションの移動元算出用)。

### 修正

- ホームへ自動移動する際、対象カードがホームセルに一瞬表示されてから
  消え、その後に元の場所から飛んで見える表示崩れを修正(`src/js/view.js`)。
  - 原因 1: 飛行アニメーションが非同期ループ内でカードを 1 ステップずつ
    隠していたため、後続ステップのカードが render 直後〜飛行開始までの間
    ホームセルに表示されたままになっていた。`render()` と同一タスク内で
    **全ステップのカードを同期的に隠す**よう変更し、チラつきを解消。
  - 原因 2: ホームセルが最上位カードしか描画しないため、同じホームへ
    連続移動(例: 2H → ホーム、直後に 3H → ホーム)すると先のカードの
    DOM 要素が存在せず飛行がスキップされていた。ホームの山札を**全カード
    重ねて描画**するよう変更し、各カードが個別に飛行できるようにした
    (見た目は最上位 1 枚と同じ)。
- 複数枚を移動する際、移動元の位置でカードが一瞬消えてから出現して
  動いて見える表示崩れを修正(`src/js/view.js`)。
  - 原因: 実カードの隠蔽は同期的に済ませていたが、クローンは非同期ループ
    内で 1 ステップずつ生成していたため、後続ステップのカードは先行カードの
    飛行中は「実体もクローンも無い」状態になり、移動元から消えて見えた。
    **全ステップのクローンを render と同一タスク内で元の位置に同期的に
    生成**し、飛行だけを順番に開始するよう変更。移動元の矩形取得時に
    元の z-index も保持し、重なったクローンの積み順を元の盤面と一致させる。
- フリーセル経由の 2 段階移動(例: ♠2 をダブルクリック → ♠2 をフリーセルへ
  → 露出した ♠1 をホームへ → ♠2 をフリーセルからホームへ)で、2 回目の
  ♠2 の移動元が山札の位置になってしまう表示崩れを修正(`src/js/app.js` /
  `src/js/game-state.js` / `src/js/view.js`)。
  - 原因: 手動移動と自動移動を 1 回の描画にまとめており、自動移動の移動元
    矩形を「state は更新済み・DOM は未描画」のタイミングで収集していたため、
    手動移動で動いたカードの自動移動の移動元が古い DOM 位置(山札)になっていた。
  - 自動ホーム送りを「1 枚ずつ描画 → 飛行」の連鎖方式に変更し、各ステップの
    移動元を前の描画が終わった DOM から毎回収集するようにした。これにより
    フリーセル経由の連鎖でも正しい位置から飛ぶ。`game-state.js` に
    `findAutoMoveCard` / `autoMoveOne` / `hasAutoMove` を追加し、`view.js` に
    飛行完了後の連鎖コールバック(`runAfterAnimations`)を追加。
- トグルのラベル「毎手自動移動」を「自動でホームへ送る」へ改名。
  「毎手自動移動」は日本語として不自然(直訳調)なため、動作内容を表す
  自然な表現に統一した。`index.html` のラベルと `title` 属性、README、
  テストの describe / test 名、`src/js/app.js` のコメントを追従。
  挙動に変更はない。

## 2026-08-14

### 機能追加

- 「毎手自動移動」トグルを追加(既定オン)。成功手(クリック移動・ドラッグ移動・
  ダブルクリック移動)の直後に、`rules.canAutoHome` で安全と判定できるカードを
  自動でホームへ送る。Microsoft FreeCell の「Auto move to home cells」に相当する
  挙動で、`index.html` のチェックボックスからオン/オフを切り替えられる。
  - 自動発動時は、動かせるカードが無くてもトーストを表示しない(手動の
    「自動移動」ボタンのみ表示)。
  - 配布直後は自動移動を実行しない(最初の手動操作以降のみ)。
  - 自動移動は 1 枚ずつ `attemptMove` を通るため、Undo は引き続き 1 手単位。
  - アプリ層(`src/js/app.js`)に `runAutoMove` / `setAutoMoveEnabled` を追加し、
    `main.js` のテスト API にも `setAutoMoveEnabled` を公開した。

## 2026-08-09

### 修正

- 小さいウィンドウでカードのデザインが崩れる問題を解消(`src/css/style.css`)。
  - 幅 600px 以下では中央のランク/スート(`.center-mark`)を非表示にし、コーナーの
    ランク/スートのみで判別できるようにした。
  - 601〜800px では、中央マークとコーナーのフォントサイズが 800px を境に基本
    デザイン(2.1rem/1.35rem、1.1rem/1.05rem)より逆に大きくなって崩れていた。
    カード幅に対する比率を基本デザインと同じ(中央 4vw/2.6vw、コーナー
    `clamp(0.9rem, 2.1vw, 1.1rem)` / `clamp(0.85rem, 2vw, 1.05rem)`)にして、
    境界での跳ね上がりをなくし、カード縮小に比例したスケールに修正した。
    コーナーは `clamp()` の下限で狭幅でも読めるサイズを保証する。
  - 幅 375px で横スクロールバーが出ていたため、600px 以下で盤面の幾何制約を
    viewport に収める調整を追加。`#game` の左右 padding を 12px → 6px、
    `.top-area` の gap を 16px → 8px、`.free-cells` / `.home-cells` /
    `.cascade-area` の gap を 10px → 5px に縮小し、375px・360px・320px
    でも `overflow: false` で収まることをブラウザ検証で確認した。

### リファクタリング

- View・入力・アプリケーション制御を抽出し、`src/js/game.js` を削除した
  (`docs/refactoring-and-testing-plan.md` の Phase 5)。
  - `src/js/view.js` を新設。`createView` が DOM 構築(`buildBoard`)、描画
    (`render` / `updateHighlights` / `updateStatus`)、タイマー表示
    (`setTimerLabel`)、トースト・シェイク、勝利画面(`showWin` / `hideOverlay`)、
    ドラッグレイヤー・ドロップヒント操作を提供する。DOM 参照はすべて
    View 内へ閉じ込めた。
  - `src/js/interactions.js` を新設。`createInteractions` がクリック
    (`handleClick`)と Pointer Events / ドラッグ&ドロップのハンドラを提供する。
    ダブルクリック判定用の `lastClick` と `dragState` を保持し、移動の実行は
    app 層の `attemptMove` / `dblClickAutoMove` へ委譲する。成功後の副作用
    (タイマー・描画・勝利処理)は app 側が担当する。
  - `src/js/app.js` を新設。`createApp` が state の保持、タイマー管理、モデル
    操作後の副作用順(`onMoveSucceeded`: lastClick リセット → タイマー開始 →
    描画 → 勝利処理)の調停、`mount` でのイベント登録、E2E テスト API
    (`snapshot` / `setBoard` / `setWinBoard` / `maxMovable`)を提供する。
    現在時刻・interval・乱数は `deps` で差し替え可能にし、既定値は
    ブラウザーの `Date.now` / `setInterval` / `clearInterval` / `Math.random`。
    勝利メッセージの経過時間は DOM の時刻テキストを読まず、タイマー状態から
    生成して View へ渡す(計画書 Phase 5 の要件)。
  - `src/js/main.js` を本格的なエントリへ拡張。`createView` → `createApp` →
    `createInteractions` を配線して `app.mount()` を 1 回呼び、`getTestApi()`
    を公開する。`init()` の二重実行はモジュールキャッシュで回避される。
  - `src/js/game.js` を削除。残っていた責務(描画・入力・アプリ制御)が
    上記 3 モジュールへ移り、計画書の目標ディレクトリ構成へ到達した。
  - `.github/workflows/deploy-pages.yml` の構文チェックを
    `node --check src/js/game.js` から `src/js/*.js` のループへ追従
    (game.js 削除で壊れるため)。
  - `tests/unit/app.test.js` を追加(10 件)。最初の成功手でタイマーが 1 回だけ
    開始されること、失敗手では開始しないこと、新規ゲーム・やり直し・勝利で
    interval が停止すること、経過時間が `M:SS` 形式で View に渡されること、
    無効なゲーム番号で注入した乱数が使われること、勝利メッセージへ経過時間が
    渡されること(タイマー未開始は `0:00`)を検証。

- 状態遷移を `src/js/game-state.js` へ抽出した(`docs/refactoring-and-testing-plan.md`
  の Phase 4)。
  - `src/js/game-state.js` を新設。`createState`(状態生成)、`groupFrom` /
    `selectedGroup`(グループ取得)、`attemptMove`(移動)、`undo`(履歴巻き戻し)、
    `autoMoveHome`(自動移動)、`dblClickAutoMove`(ダブルクリック移動)、
    `isWon` / `checkWin`(勝利判定)、`normalizeGameNumber`(番号補正)を純粋関数として
    移動。DOM・時刻・表示には触れず、state オブジェクトをその場で更新する。
    失敗手では状態・履歴・手数を変更せず、成功手では履歴と手数を 1 増やして
    選択を解除する。描画・タイマー・トースト・勝利オーバーレイ・勝利判定は
    呼び出し側(アプリ層)の責務とした。
  - `src/js/game.js` はモジュール変数(`gameNumber` / `cascades` / `freeCells` /
    `foundations` / `moveCount` / `historyStack` / `selected` / `won`)を単一の
    `state` オブジェクトへ統合し、状態遷移を `game-state.js` へ委譲する形に変更。
    成功手の副作用(`lastClick` リセット → タイマー開始 → 描画 → 勝利処理)を
    `onMoveSucceeded()` に集約し、クリック移動・ドラッグ移動・自動移動・
    ダブルクリック移動の 4 経路すべてで連続クリック判定がリセットされるようにした
    (リセットは従来 `attemptMove` 内にあったが、入力状態 `lastClick` の所有責務に
    合わせて入力・アプリ層へ移動)。`newGameFromInput` は `normalizeGameNumber` を
    使い、無効な入力はランダム番号で開始する。
  - `tests/unit/game-state.test.js` を追加(38 件)。移動の合法・不正・枚数上限、
    複数枚移動、既知の 1 枚移動(Game #1 / #12)、Undo(盤面・手数・履歴・won 不変)、
    自動移動(安全判定・カード 1 枚単位の履歴)、ダブルクリック(ホーム優先・次に
    フリーセル)、勝利判定、`normalizeGameNumber`(整数・小数・空値・非数値・範囲外)
    を検証。
  - `tests/e2e/freecell.spec.js` に、クリック移動・ドラッグ移動・自動移動の直後に
    同じカードをクリックしても自動移動が連鎖しないことを検証するテストを 3 件追加。

- ルール判定を `src/js/rules.js` へ抽出した(`docs/refactoring-and-testing-plan.md`
  の Phase 3)。
  - `src/js/rules.js` を新設。`isRed`、`isValidSequence`(色交互降順)、
    `foundationRank`、`foundationTargetFor`、`canDropOnHome`、`canDropOnCascade`、
    `maxMovable`、`canAutoHome`、`findCardLocation`、`isGrabbable` を純粋関数として
    移動し、暗黙のグローバル参照を引数へ置き換えた。DOM・時刻には触れない。
  - `src/js/game.js` は `import * as rules` で委譲する形にし、ルール判定の
    実装を削除。テスト API の `maxMovable` は従来と同じ 1 引数を受け取る
    ラッパーを残した。
  - `tests/unit/rules.test.js` を追加(29 件)。色・配列判定、ホーム、カスケード、
    最大移動枚数、安全な自動移動、カード探索、つかみ判定を検証。

- ES Modules への切り替えと定数・ディールの抽出(`docs/refactoring-and-testing-plan.md`
  の Phase 2)。
  - `index.html` を `<script type="module" src="src/js/main.js">` へ切り替え。
  - `src/js/main.js` を新設。`game.js` の `init()` を 1 回だけ呼び出し、
    E2E テスト用の公開 API(`getTestApi`)を再 export する。
  - `src/js/game.js` を ES Module へ変更。末尾の自動 `init()` を削除し、
    `init`、読み取り専用スナップショット(`snapshot`)、検証付き fixture 読み込み
    (`setBoard` / `setWinBoard`)を export。fixture はカード id の一意性と各ゾーンの
    形式(列数・セル数・id 範囲)を検証してから適用し、内部配列の可変参照は返さない。
  - `src/js/constants.js` を新設。`SUITS`、`RANKS`、各セル数、`MAX_GAME_NUMBER` を
    名前付き export。
  - `src/js/deal.js` を新設。`msRng` と `dealGame(gameNumber)` を移動。
    `dealGame` はグローバル状態を変更せず新しい初期盤面を返す。
  - `tests/e2e/helpers.js` の内部状態アクセスを、クラシックスクリプトのグローバル
    直接参照から `main.js` の公開テスト API(`window.__testApi`)へ差し替え。
    同じ URL の dynamic import でモジュールキャッシュが働き、`init()` は
    二重実行されない。
  - `tests/unit/deal.test.js` を追加。Game #1 の既知配置、52 枚の一意性、
    列長、決定性、配列参照の非共有、`msRng` の決定性を検証。

### 改善

- ローカルテスト基盤を導入した(`docs/refactoring-and-testing-plan.md` の Phase 1)。
  - `package.json`(type: module)、Vitest、Playwright Test を追加。`npm test` で
    単体テストと E2E テストをまとめて実行できる。
  - `tests/unit/smoke.test.js`: Vitest 環境の動作確認用スモークテスト。
  - `tests/e2e/helpers.js`: カード座標探索(`elementFromPoint` 走査)、内部状態への
    直接アクセス、盤面 fixture(`setBoard` / `setWinBoard`)を集約。ESM 移行後の
    公開テスト API へ差し替えやすい構成にした。
  - `tests/e2e/freecell.spec.js`: ディール互換(Game #1 全配置)、クリック・ドラッグ
    移動、複数枚移動(Game #12)、移動枚数上限、ダブルクリック自動移動、自動移動の
    安全性と 1 枚単位 Undo、ドラッグの 6px 閾値、勝利オーバーレイ、指定ホームの
    誘導、ゲーム番号入力補正、タイマーの開始・停止を検証(計 41 件)。
  - `playwright.config.js`: `node:net` でランダムな空きポートを選び webServer /
    baseURL へ埋め込む。config はメインプロセスとワーカーで別々に評価されるため、
    最初に決めたポートを環境変数へ書き戻して共有する(環境変数
    `FREECELL_E2E_PORT` で固定ポートにも変更可能)。

## 2026-08-08

### 修正

- ドラッグ&ドロップで移動枚数上限を超えるグループをドロップしてもトーストが
  表示されない問題を修正。`getValidDropTargets` が枚数超過の候補を除外するため
  `onPointerUp` の too-many 分岐に到達しなかった。ドロップ位置の列が
  「ランク/色は合うが枚数超過」の場合に、クリック操作と同じトーストを表示する
  判定(`tooManyLimitAt`)を追加した。

### 改善

- カード中央の大きなスート単独表示(♠ などが「1」に見える誤認の原因)を廃止し、
  MS FreeCell 風に中央へランクを大きく・その下にスートを小さく表示するデザインに
  変更(J/Q/K も同じレイアウト)。`centerMarkHtml()` を追加。

### リファクタリング

- `src/js/game.js` のブレースなし制御文 65 箇所をすべてブロック `{}` 形式に統一。
  あわせて AGENTS.md に「制御文は必ずブロックを使う」規約を追加。
- CHANGELOG の日付セクション形式(「### 修正」「### リファクタリング」の繰り返し)で
  markdownlint MD024 が出るため、`.markdownlint.json` に `MD024: siblings_only` を設定。

## 2026-08-06

### 修正

- トーストに中国語「更多」が混入していた問題を修正。`toManyMessage()` ヘルパーを新設し、
  「一度に移動できるのは最大 N 枚です(空きセル・空き列が増えるとさらに増えます)」に修正。
  クリック経路(`failFeedback`)とドラッグ経路(`onPointerUp`)の両方でこのヘルパーを使用し、
  メッセージの重複も排除した。
- シード値の範囲チェック不足を修正。`MAX_GAME_NUMBER = 32000` 定数を追加し、
  `newGameFromInput` で 1〜32000 の範囲外は乱数化(範囲内は維持)。
  初期 `gameNumber`・`randomGameNumber`・`newGameFromInput` ですべて同じ定数を使用。
- `startGame` / `newGameFromInput` の重複を整理。`newGameFromInput` から
  冗長な `input.value = num` を削除(`startGame` 内で seedInput へ反映する責務を一本化)。

### リファクタリング

- `foundationTargetFor` と `canDropOnHome` のロジック重複を解消。
  `foundationTargetFor` を `for (i) if (canDropOnHome(card, i)) return i` の形に書き直し、
  `canDropOnHome` を単一の真実源として再利用(検証済み: A♥→空きホーム、
  K♠ は積み上がるまで -1、積み上がれば正しいインデックスを返す)。
- `updateHighlights` 内の `cardElById()` の毎回の `querySelector` 走査を改善。
  `render()` 時に `cardElMap` (`Map<cardId, el>`) を構築し、`cardElById` が
  それを優先して返すよう変更(52 枚でも無害だが高速化・簡潔化を達成)。
- `#restart-btn` の `won` 後の盤面リセットを再検証し、問題なしと確認。
  `startGame` 経由で `won` フラグも降りるためコメントで意図を明記した(実装変更は不要)。
