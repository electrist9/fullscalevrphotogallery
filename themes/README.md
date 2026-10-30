# themes/ — サーバーテーマ作者ガイド

このディレクトリの **JSON 1ファイル = 1テーマ**。サーバーはリクエストごとにこのディレクトリを読み直すため、
**ファイルを追加・編集するだけでテーマが増えます**（サーバー再起動不要・Web再ビルド不要・コード変更不要）。
Questブラウザでページを再読み込みすると、⚙設定 → テーマ 画面に新しい行が現れます。

- 実装（導出ロジックの正典）: [`web/src/theme.ts`](../web/src/theme.ts)
- 設計書: [`THEME_DESIGN.md`](../THEME_DESIGN.md)　スロットID対応: [`COLORS.md`](../COLORS.md)
- 内蔵テーマ `plain` はクライアント側に固定（このディレクトリに置かない。フォールバック基準）

## 1. 追加手順

1. このディレクトリに `<英数名>.json` を作成する（UTF-8。BOM付きでも読めます）。
2. Questブラウザでページを再読み込み → ⚙ → テーマ に新行が表示されることを確認。
3. 一覧の並び順は **ファイル名のソート順**（例: `cool.json` < `forest.json` < `neon.json`）。表示名（`name`）の順ではない。

## 2. JSON スキーマ

```json
{
  "id": "mytheme",
  "name": "My Theme",
  "base": "#3f5c46",
  "accent": "#d9b64a",
  "vivid": 0.55,
  "overrides": { "heading": "#eef3ef" }
}
```

| キー | 必須 | 意味 |
|---|---|---|
| `id` | 必須 | 内部識別子（英数）。**一意**にする（重複時はファイル名順で先頭が採用される）。`plain` は使えない（内蔵）。ユーザーのブラウザの localStorage（キー `fsvg.theme`）に保存されるのはこの id |
| `name` | 必須 | テーマ選択画面に表示される表示名 |
| `base` | 必須 | **空間色**（床中心の色）。HEX `#rrggbb`（`#rgb` 短縮形も可） |
| `accent` | 必須 | **差し色**（ホバー枠・選択チップ・レイ線）。HEX `#rrggbb` |
| `vivid` | 任意 | 0..1（既定 0.5）。彩度・明るさの強さ。0=抑制的、1=原色に迫る |
| `overrides` | 任意 | 導出**後**に特定スロットを手動上書き（§5）。キーはスロット名（§4 の表） |

**注意**: JSON が壊れている、または `id` / `base` / `accent` のいずれかが欠けているファイルは
**エラーにならず黙って一覧から除外**されます。反映されないときはまず JSON の妥当性を確認してください。

## 3. 導出の仕組み（作者は base + accent の2色だけ書く）

`buildPalette(spec)` が HSL 空間で 30 スロット全部を導出します。

- **環境彩度の上限** = `0.30 + 0.70 × vivid`。base の彩度がこの上限で抑えられる（vivid 0.5 → 上限 0.65、vivid 1.0 → 上限 1.00）。
- **床中心の明度** = base の明度を `0.28` 以上、`0.28 + 0.32 × vivid` 以下にクランプ（暗すぎ・明るすぎ防止）。
- **accent の正規化**: 彩度 `0.45..0.85`、明度 `0.45..0.65` に収める（読みやすい差し色帯）。
- **空間スロット**は base の色相・環境彩度を保ち、明度ラダーで振る:

| 明度 L | 使われるスロット |
|---|---|
| 0.05 | `bg` / `fog` / `floorEdge` / `wallTop` |
| 0.10 | `floorMid2` / `chipFrame` / `settingsChipFrame` / `exitChipFrame` / `chipFace`（ラベル・情報バーの半透明背景の地色） |
| 0.13 | `detailFace`（詳細面・設定ボタン面） |
| 0.15 | `wallMid` |
| 0.20 | `floorMid1` / `frame` / `detailFrame` |
| 0.26 | `hitBox` |
| 0.28 | `wallBottom` |
| 床中心 Lc（上記クランプ後） | `floorCenter` / `gridMinor` |
| min(0.47, Lc+0.12) | `gridMajor` |

- **テキスト色**は base 色相の低彩度・高明度（明文字）で作られ、**床中心色の輝度が 0.45 を超えると暗文字に反転**します。
- `labelBg`（alpha 0.85）と `infoBarBg`（alpha 0.92）は半透明で、下地の `chipFace`（L10）と合成されて見えます。

## 4. 全30スロット一覧（`overrides` のキーに使用）

| 領域 | スロット |
|---|---|
| 空間 | `bg` `fog` `fogDensity`(数値) `floorCenter` `floorMid1` `floorMid2` `floorEdge` `gridMajor` `gridMinor` `wallTop` `wallMid` `wallBottom` |
| パネル | `frame` `hover` |
| アルバムチップ | `chipFrame` `chipHover` |
| 設定/終了チップ | `settingsChipFrame` `settingsChipHover` `exitChipFrame` `exitChipHover` `chipFace` |
| 詳細ビュー | `infoBarBg` `heading` `aux` `hi` `detailFrame` `detailFace` |
| ホバーラベル | `labelBg` `labelText` |
| アルバムラベル | `albumLabelBg` `albumLabelSel` `albumLabelUnsel` |
| コントローラ | `ray` `hitBox` |
| 2Dビューア | `viewerBg` |

## 5. 既知の落とし穴

### ① 明るい base で文字が読めなくなる（最重要・Neon で実測済み）

文字色の反転判定は「**床中心色**の輝度 > 0.45」ですが、文字が載る面（`labelBg` / `infoBarBg` / `chipFace` / `detailFace`）は
**常に明度ラダー由来の暗色（L10/L13）** です。base を明るくすると「暗文字 × 暗背景」（コントラスト比 1.4 程度・読めない）になります。

**対処**: `overrides` でテキスト系スロットを明色に固定する。実例 [`neon.json`](./neon.json) では
`heading` / `labelText` / `albumLabelSel` を明色、`aux` / `albumLabelUnsel` を中間色、`hi` を差し色寄りに固定している。

**目安（コントラスト比・合成後）**: 見出し/ラベル背景 **7 以上**、補足テキスト **4.5 以上**（WCAG AA 相当）。

### ② accent が空間色に近すぎるとホバーが見えない

accent は床（`floorCenter`）の上に表示されることが多い。色相が近い同系色だと選択状態が判別できません。
色相で **60° 以上**離すか、明度差を大きく取る（例: Neon = 空色床 × ピンク差し色、約133°差）。

### ③ テーマ削除時の挙動

ファイル削除・id 変更・id 重複解消でユーザーの localStorage に保存された id が一覧から消えると、
そのユーザーは **Plain に自動フォールバック**します（エラーにはならない）。id は安定させるのが親切です。

## 6. 実例

最小構成（[`forest.json`](./forest.json)）:

```json
{ "id": "forest", "name": "Forest", "base": "#3f5c46", "accent": "#d9b64a", "vivid": 0.55 }
```

overrides 付き（[`neon.json`](./neon.json)、明るい床の落とし穴①への対処込み）:

```json
{
  "id": "neon",
  "name": "Neon",
  "base": "#00bfff",
  "accent": "#ff1493",
  "vivid": 1.0,
  "overrides": {
    "heading": "#e9f2f5",
    "aux": "#9fc0ca",
    "hi": "#dd89b5",
    "labelText": "#e9f2f5",
    "albumLabelSel": "#e9f2f5",
    "albumLabelUnsel": "#9fc0ca"
  }
}
```

## 7. 検証方法

**PC（推奨・再実行可）**:

```powershell
tools\node\node.exe .tmp\theme_check.ts
```

`themes/*.json` 全件に対し、サーバーと同じフィルタ（id/base/accent 揃っているか）の通過確認、
`buildPalette` の導出値表示、コントラスト比（見出し/ラベル背景・補足/ラベル背景・ホバー/床）の算出まで行います。
（`.tmp/` は gitignore の検証用スクラッチで、このスクリプトはリポジトリに含まれません。無い場合は
`web/src/theme.ts` を `import` する同種スクリプトを `.tmp/` に再作成できます。Node は `tools\node\node.exe` v22 で、`.ts` を直接実行できます）

**実機（Quest 3）**: サーバー起動 → Questブラウザでページ再読み込み → ⚙ → テーマ →
①新行が並ぶ ②床・壁・グリッドの空間色 ③ホバー/選択/レイの差し色 ④ラベル・情報バー・設定パネルの文字が読める
⑤2Dビューアの背景 ⑥Plain に戻して従来どおり — を確認。
