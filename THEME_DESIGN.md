# テーマ機能 設計案

ギャラリー空間の配色（COLORS.md の 30 箇所）を、実行時に切り替えられるようにする設計。
2026-10-30 時点の `xrGallery.ts` / `xr-input.ts` / `photoPlane.ts` を対象。

---

## 1. 目的とスコープ

- **目的**: plain（現状）以外の配色テーマを、VR内の設定から切り替えられるようにする。テーマは**サーバ上の JSON で配信**し、内蔵は `plain` のみ（フォールバック）。
- **非スコープ（当面）**: 写真画像そのものの色加工、照明モデルの変更（MeshBasicMaterial 維持）。

---

## 2. 現状の課題

- 30 箇所の色が 3 ファイルにハードコードされている（COLORS.md 参照）。
- 空間色は `buildRoom()` 内で CanvasTexture を生成し、マテリアルに焼き付けている。
- UI色（枠・ラベル）はマテリアル `color` と Canvas 描画の両方に散在。
- 設定パネル（`openSettings`）は数値スライダー（`SettingDef`）のみ。テーマは離散値なので既存モデルに合わない。

---

## 3. 設計方針

**「1つの Palette オブジェクトを唯一の色の供給源にする」**

- すべての色参照を `palette.<slot>` 経由に置き換える。
- `currentTheme` をモジュールレベルで保持し、テーマ切替で Palette を差し替える。
- 空間（床・壁）はテクスチャ再生成、UI（枠・文字）はマテリアル/Canvas 更新で反映。

**「作成者は2色だけ書く」**

- 内部 Palette は30スロットだが、テーマ作成者の入口は **base（空間基調）＋ accent（アクセント）の2色**。
- `buildPalette(spec)` が HSL の導出規則で30スロットを自動生成（4.2）。作成負担を30→2に削減。

**「テーマはサーバ配信、内蔵は plain のみ」**

- 内蔵（バンドル同梱）は `plain` 1つだけ。他テーマは `themes/*.json` を `GET /api/themes` で配信（§6.5）。
- localStorage には**テーマ名だけ**保存。その名前の JSON がサーバに無ければ plain を使用。
- テーマの追加・変更はサーバ側だけで完結（フロント再ビルド不要）。

---

## 4. データ構造

### 4.1 Palette 型（新ファイル `web/src/theme.ts`）

COLORS.md の ID をキーに、意味のある名前で集約する。

```ts
export interface Palette {
  // 空間
  bg: number;            // S1 シーン背景
  fog: number;           // S2 フォグ色（通常 bg と同値）
  fogDensity: number;    // S3 フォグ濃度
  floorCenter: number;   // S4
  floorMid1: number;     // S5
  floorMid2: number;     // S6
  floorEdge: number;     // S7
  gridMajor: number;     // S8
  gridMinor: number;     // S9
  wallTop: number;       // S10
  wallMid: number;       // S11
  wallBottom: number;    // S12
  // UI アクセント
  accent: number;        // P2/A2/U2 ホバー・選択の青
  frame: number;         // P1/D5 枠（通常）
  chipFrame: number;     // A1/U1/U3/U5 チップ枠・面（通常）
  panelFace: number;     // D6 詳細背景面
  // 文字・ラベル
  labelText: string;     // H2/L2/D2 主文字（Canvas 用なので string）
  labelTextDim: string;  // L3/D3 補助文字
  labelTextHi: string;   // D4 強調文字
  labelBg: string;       // H1/L1/D1 ラベル背景（rgba 文字列）
  // コントローラー
  ray: number;           // C1 レイトレー
  hitBox: number;        // C2 ヒットボックス
  // 2Dビューア
  viewerBg: number;      // V1
}
```

### 4.2 2色オーサリング（テーマ作成者の入口）

**作成者が指定するのは2色だけ。** 30スロットは導出規則で自動生成する。

```ts
// 作成者が書くのはこれだけ
export interface ThemeSpec {
  id: string;
  name: string;
  base: string;     // 空間基調色（例 "#4a5568"）。床中心＝この色
  accent: string;   // アクセント色（例 "#2f6feb"）。ホバー・選択・レイ
  overrides?: Partial<Palette>; // 任意: 特定スロットだけ上書き（通常不要）
}
```

`buildPalette(spec)` が HSL 空間で以下を適用し、内部の完全 `Palette`（4.1）を生成する。
`hsl(h,s,l)` / `shade(c, dl)`（明度加算）/ `desat(c, s)` をヘルパーとする。

#### 導出規則（base → 空間・UI構造、accent → 操作系、文字は base 由来の中立色）

| スロット | 導出 | plain での実測値 |
|---|---|---|
| S1 bg / S2 fog | `hsl(Hb, Sb, 0.05)` | #0b0d10 (L5%) ✓ |
| S7 floorEdge | = bg | #0b0d10 ✓ |
| S6 floorMid2 | `hsl(Hb, Sb, 0.10)` | #141820 ✓ |
| S5 floorMid1 | `hsl(Hb, Sb, 0.20)` | #2a3040 ✓ |
| S4 floorCenter | `base` そのもの | #4a5568 ✓ |
| S10 wallTop | = bg | #0b0d10 ✓ |
| S11 wallMid | `hsl(Hb, Sb, 0.15)` | #1e2530 ✓ |
| S12 wallBottom | `shade(base, -0.07)` | #3a4555 (L28%) ✓ |
| S8 gridMajor | `shade(base, +0.12)` | #6a7585 (L47%) ✓ |
| S9 gridMinor | `base` | #4a5568 ✓ |
| P1 frame / D5 | `shade(base, -0.12)` | #2c3038 ✓ |
| A1/U1 chipFrame・面 | `hsl(Hb, Sb, 0.10)` | #14161a ✓ |
| D6 panelFace | `hsl(Hb, Sb, 0.13)` | #1d2025 ✓ |
| C2 hitBox | `shade(base, -0.08)` | #39404c ✓ |
| P2/A2/U2 accent | `accent` そのもの | #2f6feb ✓ |
| C1 ray | `desat(accent, 0.5)` + `shade(+0.2)` | #9db8ff ✓ |
| H2/L2/D2 labelText | `hsl(Hb, 0.10, 0.92)` | #e8eaed ✓ |
| L3/D3 labelTextDim | `hsl(Hb, 0.10, 0.65)` | #9aa5b1 ✓ |
| D4 labelTextHi | `hsl(Hb, 0.10, 0.88)` | #dfe3e8 ✓ |
| H1/L1/D1 labelBg | `hsla(Hb, Sb, 0.08, 0.85)` | rgba(20,22,26,.85) ✓ |
| V1 viewerBg | `hsl(Hb, Sb, 0.07)` | #101216 ✓ |

**要点**:
- 空間の濃淡はすべて base の**色相・彩度を保ち明度だけ変える**ランプ。だから床・壁・グリッドが必ず調和する。
- 文字は base の色相を**脱色（S→10%）＋明色**した中立色。作成者は文字色を書かなくてよい。
- accent は1色でホバー・選択・レイが揃う。
- `overrides` で例外的なテーマ（例: 文字をアクセント色にしたい等）だけ部分指定できる。

#### 正規化と vivid（極端な入力色・わざと派手にしたい両対応）

`base`/`accent` は**色相の指定**とみなす。ただし空間の彩度・明度を**固定で抑え込むと、わざと派手にしたいテーマを潰す**。そこで `vivid`（0〜1、既定 0.5）で「抑える度合い」を作成者が決め、**可読性は文字色の自動選択で担保**する。

```
// ThemeSpec に vivid?: number を追加（既定 0.5）
Hb, Sb, Lb = hsl(base)
Ha, Sa, La = hsl(accent)

// 空間の彩度上限は vivid で線形に開く: 0=30%(抑制) / 1=base の彩度をフルに使用
Sb_env = min(Sb, 0.30 + 0.70 * vivid)
// 床中心の明度帯も vivid で上限側を広げる（ネオンに明るい床を許容）
Lc     = clamp(Lb, 0.28, 0.42 + 0.18 * vivid)
// 空間ランプは (Hb, Sb_env, Lc) を基準に明度のみ振る

Sa_ui  = clamp(Sa, 0.45, 0.85)    // accent は視認帯へ（背景に埋もれない）
La_ui  = clamp(La, 0.45, 0.65)

// 可読性: 床中心の相対輝度から文字色を自動選択（vivid で床が明るくなっても破綻しない）
textLight = hsl(Hb, 0.10, 0.92); textDark = hsl(Hb, 0.20, 0.12)
labelText = luminance(hsl(Hb, Sb_env, Lc)) > 0.45 ? textDark : textLight
```

**検算 A: base=deepskyblue × accent=deeppink, vivid=0.5（既定＝抑制）**

| 生成色 | 結果 |
|---|---|
| 床中心 | hsl(195, 30, 42) 落ち着いたスチールシアン |
| bg/fog | hsl(195, 30, 5) 深い青 |
| ホバー/選択 | hsl(328, 85, 54) 鮮やかなピンク |
| 文字 | 白（床が暗いので textLight） |

→ 青みの暗い空間＋ピンクのハイライト。

**検算 B: 同2色, vivid=1.0（わざと派手）**

| 生成色 | 結果 |
|---|---|
| 床中心 | hsl(195, 100, 50) = deepskyblue そのもの（ネオン） |
| bg/fog | hsl(195, 100, 5) 彩度満タンの深い青 |
| 壁下部 | hsl(195, 100, 43) 鮮烈なシアン |
| ホバー/選択 | hsl(328, 85, 54) ピンク |
| 文字 | **暗色** textDark（床が明るいので自動で反転） |

→ 彩度満タンのシアン空間＋ピンクの光。派手だが文字は自動で暗色になり読める。

**plain は無影響**: base `#4a5568`(S17 L35)・accent `#2f6feb`(S83 L55) は vivid=0.5 でエンベロープ内。彩度上限 65% > 17% なのでクランプされず、床輝度も低く textLight のまま。既存の plain 値はそのまま再現される。

**要点**:
- `vivid` が「空間の彩度・明るさを出す度合い」。0=上品に抑制、1=base の色をフルに空間へ。
- 色相は base と accent で大きく離れてよい（補色的な組み合わせも成立・むしろ映える）。
- 可読性は固定の白文字ではなく**床の輝度で文字色を自動選択**して担保。派手でも読める。
- `overrides` でさらに個別スロットを直接指定可能。

### 4.3 内蔵テーマは `plain` のみ

**バンドル同梱のテーマは `plain` 1つだけ。** 他テーマ（warm/cool/noir 等）はサーバ上の JSON で配信する（§6.5）。

```ts
// theme.ts — 唯一のバンドル同梱テーマ（サーバ不要のフォールバック）
export const PLAIN_SPEC: ThemeSpec = {
  id: "plain", name: "Plain", base: "#4a5568", accent: "#2f6feb",
};
export const PLAIN_PALETTE: Palette = buildPalette(PLAIN_SPEC);
```

- `plain` はネットワーク無しでも必ず使える（初期テーマ・フォールバック）。
- warm/cool/noir は `themes/*.json` としてサーバに置く（§6.5）。追加・変更はサーバ側だけで再ビルド不要。

---

## 6.5 サーバ配信（テーマ JSON）

### 配置

リポジトリ直下に `themes/` を新設し、**1テーマ=1 JSON ファイル**（ファイル名 = テーマ id）:

```
themes/
  warm.json
  cool.json
  noir.json
```

各 JSON は `ThemeSpec` そのもの:

```json
// themes/warm.json
{ "id": "warm", "name": "Warm", "base": "#6a5540", "accent": "#eb8f2f", "vivid": 0.6 }
```

```json
// themes/cool.json
{ "id": "cool", "name": "Cool", "base": "#40556a", "accent": "#2fb0eb", "vivid": 0.5 }
```

```json
// themes/noir.json
{ "id": "noir", "name": "Noir", "base": "#555555", "accent": "#e0e0e0", "vivid": 0.4 }
```

（`plain` はサーバに置かない＝クライアント内蔵。置いても上書きされない。）

### API（`server/app.py` に追加）

```python
THEME_DIR = os.path.join(ROOT, "themes")

@app.get("/api/themes")
def list_themes():
    """themes/*.json を読んだ ThemeSpec の一覧。不正 JSON・id不一致はスキップ。"""
    out = []
    if os.path.isdir(THEME_DIR):
        for fn in sorted(os.listdir(THEME_DIR)):
            if not fn.endswith(".json"):
                continue
            try:
                with open(os.path.join(THEME_DIR, fn), encoding="utf-8-sig") as f:
                    spec = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue
            if isinstance(spec, dict) and spec.get("id") and spec.get("base") and spec.get("accent"):
                out.append(spec)
    return out
```

- `GET /api/themes` → `ThemeSpec[]`。**ピッカー生成と起動時解決の両方に使う**（一覧を1回取れば per-id 取得は不要）。
- 静的配信（`/themes/`）でも代替可だが、一覧取得とバリデーションが1本で済むためエンドポイント方式を推奨。

### 解決フロー（`xrGallery.ts` 起動時）

```
name = getThemeName()            // localStorage "fsvg.theme"（既定 "plain"）
if name == "plain":
    palette = PLAIN_PALETTE      // fetch 不要・即時
else:
    specs = await fetchThemes()  // GET /api/themes
    spec  = specs.find(s => s.id == name)
    palette = spec ? buildPalette(spec) : PLAIN_PALETTE   // 無ければ plain
buildRoom(palette)
```

- **localStorage に保存するのはテーマ名（文字列）だけ**。Palette 本体は保存しない（サーバ JSON が正本）。
- 保存名がサーバ一覧に無い／サーバ到達不能 → **内蔵 plain を使用**（保存名は消さず維持。次回サーバ復帰で復活）。
- `plain` 選択時は fetch を省略し即表示（初回描画をブロックしない）。

---

## 5. 適用メカニズム（要素種別ごと）

| 種別 | 例 | 反映方法 | コスト |
|------|----|----------|--------|
| マテリアル `color` | 枠 P1/P2、チップ A1、ヒットボックス C2 | `mat.color.setHex(palette.x)` | 極小（即時） |
| シーンプロパティ | 背景 S1、フォグ S2/S3 | `scene.background.setHex` / `scene.fog.color.setHex` / `.density=` | 極小（即時） |
| CanvasTexture（空間） | 床 S4–S7、壁 S10–S12 | `buildRoom()` を再実行し旧メッシュ dispose → 新テクスチャ | 小（ms級・1回） |
| CanvasTexture（ラベル） | H1–H2、L1–L3、D1–D4 | 該当 Canvas を再描画し `tex.needsUpdate = true` | 小（該当分のみ） |

**方針**: テーマ切替時は **空間を丸ごと再構築**（`buildRoom` はメッシュ数個で ms 級、安全）＋ **UIマテリアルは setHex で即時更新**＋ **開いている設定/詳細の Canvas だけ再描画**。既存の `disposeSubtree` を再利用。

---

## 6. テーマ切替 UI（VR内）

既存の設定パネル（⚙ → `openSettings`）に **「テーマ」行を追加**し、押すと専用画面（`mode: "theme"`）を開く。

```
設定一覧（list）
  👁 写真推定IPD
  ↕ 半身の目の高さ
  ➡ スクロール速度
  🧍 原寸大全身の距離
  ◐ 原寸大半身の距離
  🖼 フィット表示の距離
  🎨 テーマ            ← 新規（押すと theme 画面）

テーマ画面（theme）
  [← 戻る]
  [Plain] [Warm] [Cool] [Noir] ...   ← swatch 色付きボタン。選択中は枠を accent 色で強調
```

- ボタン一覧は **`[内蔵 plain] + GET /api/themes` の結果**で動的生成（swatch = base 色）。
- `applySettingsAction` に `theme_<id>` アクションを追加。
- 選択で `setThemeName(id)` → Palette 差し替え → 反映 → localStorage 保存 → 設定画面を再描画（選択強調）。
- 既存の `SettingDef`（数値）とは別枠。`settingDefs` に「テーマ」行だけ混ぜ、`open_theme` で分岐。

---

## 7. 永続化

- localStorage キー **`fsvg.theme`**（既存 `fsvg.ipdmm` 等と同じ層に `getThemeName/setThemeName` を追加）。**保存するのはテーマ名（文字列）のみ**。
- 起動時、`buildRoom()` 前に §6.5 の解決フローで `currentPalette` を解決（`plain` は即時、他はサーバ一覧から検索、無ければ plain）。
- 未保存・不正名・サーバ到達不能は `plain` にフォールバック（保存名は保持）。

---

## 8. 実装ステップ（M1＋M2 統合）

| フェーズ | 内容 | 完了条件 |
|---------|------|---------|
| **M1** | `theme.ts`（Palette/ThemeSpec/`buildPalette`＋vivid＋文字自動選択、内蔵は plain のみ）。`server/app.py` に `GET /api/themes`。`themes/` に warm/cool/noir JSON。`buildRoom` とUIを palette 参照へ置換。設定にテーマ行＋theme画面（一覧は plain＋`/api/themes`）。localStorage にテーマ名保存。 | Quest3 で plain↔warm↔cool↔noir が切替・保存され、サーバ JSON 追加で再ビルド無しに増える |
| **M2** | （任意）アルバム別テーマ、テーマのフォグ濃度スライダー化、`overrides` の UI 編集。 | — |

M1 が本体（旧 M1＋M2 を統合し、最初からサーバ配信 JSON で運用）。M2 は拡張。

---

## 9. トレードオフと判断ポイント

- **バンドル同梱 vs サーバ配信**: 内蔵は plain のみ（フォールバック）。他テーマはサーバ `themes/*.json`（**追加・変更はサーバ側だけで再ビルド不要**、サーバ再起動も不要＝ファイル読みのみ）。
- **一覧1取得 vs per-id 取得**: 起動・ピッカーとも `GET /api/themes` を1回引くだけで解決。保存名が一覧に無ければ plain。
- **即時反映 vs 再構築**: 空間は再構築が最も安全（グラデの再計算が不要になる）。ms 級で体感なし。
- **ラベル再描画の範囲**: 開いている詳細/設定のみ再描画。全サムネイルのラベルは次回ホバー時に新色で生成（既存の遅延生成に乗る）。
- **フォグと MeshBasicMaterial**: `FogExp2` は Basic マテリアルに自動適用。テーマで fog 色/濃度を変えても追加実装なし。
- **アクセント色の一元化**: `#2f6feb` を `palette.accent` に集約すれば、テーマ全体の色調が1値で変わる。

---

## 10. 影響ファイル

- 新規: `web/src/theme.ts`（Palette/ThemeSpec/`buildPalette`/内蔵 plain）
- 新規: `themes/warm.json` `themes/cool.json` `themes/noir.json`（サーバ配置）
- 変更: `server/app.py`（`GET /api/themes`・`THEME_DIR`）
- 変更: `web/src/api.ts`（`fetchThemes()`）
- 変更: `web/src/settings.ts`（`getThemeName/setThemeName`・キー `fsvg.theme`）
- 変更: `web/src/xrGallery.ts`（buildRoom / UI色 / 設定パネル / 解決フロー）
- 変更: `web/src/xr-input.ts`（ray/hitBox を palette 参照に）
- 変更: `web/src/photoPlane.ts`（viewerBg を palette 参照に）
- 参照: `COLORS.md`（スロット定義の正本）
