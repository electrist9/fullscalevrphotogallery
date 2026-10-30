// テーマシステム（THEME_DESIGN.md §4）。作成者は base（空間色）+ accent（差し色）の2色だけ書く。
// buildPalette(spec) が HSL 規則で 30 スロット全部を導出する。内蔵テーマは plain のみ。
// サーバ配信テーマ（warm/cool/noir…）は GET /api/themes で ThemeSpec[] を取り、ここで buildPalette する。

// ---- 30 スロットのカラーパレット（COLORS.md の ID に対応）----
export interface Palette {
  // 空間（buildRoom）
  bg: string;            // S1 シーン背景
  fog: string;           // S2 フォグ色
  fogDensity: number;    // S3 フォグ濃度（数値）
  floorCenter: string;   // S4 床中心（= base）
  floorMid1: string;     // S5 床中間1（stop0.35）
  floorMid2: string;     // S6 床中間2（stop0.70）
  floorEdge: string;     // S7 床外周
  gridMajor: string;     // S8 グリッド主線
  gridMinor: string;     // S9 グリッド副線
  wallTop: string;       // S10 壁上端（天井側）
  wallMid: string;       // S11 壁中間（stop0.50）
  wallBottom: string;    // S12 壁下端（床側）
  // パネル
  frame: string;         // P1 サムネイル枠（非ホバー）
  hover: string;         // P2 ホバー枠（= accent）
  // アルバムチップ
  chipFrame: string;     // A1 チップ枠（非選択）
  chipHover: string;     // A2 チップ枠（ホバー/選択 = accent）
  // 設定/終了チップ
  settingsChipFrame: string; // U1
  settingsChipHover: string; // U2（= accent）
  exitChipFrame: string;     // U3
  exitChipHover: string;     // U4（= accent）
  chipFace: string;          // U5 チップ面
  // 詳細ビュー
  infoBarBg: string;     // D1 情報バー背景（rgba）
  heading: string;       // D2 見出しテキスト
  aux: string;           // D3 補助テキスト
  hi: string;            // D4 強調テキスト
  detailFrame: string;   // D5 詳細枠
  detailFace: string;    // D6 詳細面／設定ボタン面
  // ホバーラベル
  labelBg: string;       // H1 ラベル背景（rgba）
  labelText: string;     // H2 ラベルテキスト
  // アルバムラベル
  albumLabelBg: string;  // L1 ラベル背景（rgba）
  albumLabelSel: string; // L2 選択テキスト
  albumLabelUnsel: string; // L3 非選択テキスト
  // コントローラ
  ray: string;           // C1 レイ線
  hitBox: string;        // C2 グリップボックス
  // 2D ビューア
  viewerBg: string;      // V1 ビューア背景
}

// ---- 作成者が書くテーマ仕様（サーバ JSON のスキーマ）----
export interface ThemeSpec {
  id: string;
  name: string;
  base: string;    // 空間色（床中心）。HEX "#rrggbb"
  accent: string;  // 差し色（ホバー/選択/レイ）。HEX "#rrggbb"
  vivid?: number;  // 0..1 彩度正規化（既定 0.5）
  overrides?: Partial<Palette>; // 例外スロットの手動上書き
}

// ---- 色ユーティリティ（HSL 空間で操作）----
interface HSL { h: number; s: number; l: number }

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// "#rrggbb" / "#rgb" → HSL（h: 0..360, s/l: 0..1）
export function hexToHsl(hex: string): HSL {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let hue = 0;
  let sat = 0;
  if (d !== 0) {
    sat = d / (1 - Math.abs(2 * l - 1));
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: clamp01(sat), l: clamp01(l) };
}

// HSL → "#rrggbb"
function hslToHex(h: number, s: number, l: number): string {
  s = clamp01(s);
  l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

// HSL スロット生成ヘルパー
const H = (h: number, s: number, l: number) => hslToHex(h, s, l);

// 相対輝度（0..1）。sRGB 近似（ガンマ無視の線形加重で十分：文字色の明暗判定に使用）
function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---- 導出本体 ----
// base の H,S を保ちつつ L だけを明度ラダーで振る。accent はホバー/選択/レイへ。
// vivid（既定0.5）で環境彩度の上限と中心明度の上限を緩める（0=抑制、1=原彩に迫る）。
export function buildPalette(spec: ThemeSpec): Palette {
  const base = hexToHsl(spec.base);
  const accent = hexToHsl(spec.accent);
  const vivid = spec.vivid == null ? 0.5 : clamp01(spec.vivid);

  const Hb = base.h;
  const Sb = base.s;
  const Lb = base.l;

  // 環境（空間）彩度の上限：vivid に応じ 0.30..1.00。base 彩度を上限で抑える。
  const envCap = 0.30 + 0.70 * vivid;
  const Sb_env = Math.min(Sb, envCap);

  // 中心明度（床中心）の上限：vivid に応じ 0.28..0.60。暗すぎ/明るすぎを防ぐ。
  const centerCap = 0.28 + 0.32 * vivid;
  const Lc = Math.min(Math.max(Lb, 0.28), centerCap);

  // UI（accent）彩度・明度の正規化：読みやすい差し色帯に収める。
  const Sa_ui = Math.min(Math.max(accent.s, 0.45), 0.85);
  const La_ui = Math.min(Math.max(accent.l, 0.45), 0.65);
  const Ha = accent.h;

  // 空間色スロット（base 色相・環境彩度、明度ラダー）
  const L5 = H(Hb, Sb_env, 0.05);   // bg / fog / floorEdge / wallTop
  const L10 = H(Hb, Sb_env, 0.10);  // floorMid2 / チップ枠・面
  const L13 = H(Hb, Sb_env, 0.13);  // 詳細面／設定ボタン面
  const L15 = H(Hb, Sb_env, 0.15);  // wallMid
  const L20 = H(Hb, Sb_env, 0.20);  // floorMid1 / 枠
  const L26 = H(Hb, Sb_env, 0.26);  // hitBox
  const L28 = H(Hb, Sb_env, 0.28);  // wallBottom
  const LcHex = H(Hb, Sb_env, Lc);  // floorCenter / gridMinor（= base）
  const L47 = H(Hb, Sb_env, Math.min(0.47, Lc + 0.12)); // gridMajor

  // accent スロット（ホバー/選択/レイ）
  const accentHex = H(Ha, Sa_ui, La_ui);
  const rayHex = H(Ha, Sa_ui * 0.5, Math.min(0.85, La_ui + 0.20)); // C1 レイ（淡い）

  // テキスト色：base 色相を低彩度・高明度に。背景（床中心）が明るければ暗文字へ反転。
  const bgBright = luminance(LcHex) > 0.45;
  const textLight = H(Hb, 0.10, 0.92);
  const textDark = H(Hb, 0.20, 0.12);
  const textMain = bgBright ? textDark : textLight;
  const textDim = bgBright ? H(Hb, 0.18, 0.30) : H(Hb, 0.12, 0.65);
  const textHi = bgBright ? H(Hb, 0.20, 0.18) : H(Hb, 0.10, 0.88);

  // 半透明パネル背景（チップ面色 + alpha）
  const faceRgb = L10.replace("#", "");
  const fr = parseInt(faceRgb.slice(0, 2), 16);
  const fg = parseInt(faceRgb.slice(2, 4), 16);
  const fb = parseInt(faceRgb.slice(4, 6), 16);
  const rgba = (a: number) => `rgba(${fr},${fg},${fb},${a})`;

  const pal: Palette = {
    bg: L5,
    fog: L5,
    fogDensity: 0.15,
    floorCenter: LcHex,
    floorMid1: L20,
    floorMid2: L10,
    floorEdge: L5,
    gridMajor: L47,
    gridMinor: LcHex,
    wallTop: L5,
    wallMid: L15,
    wallBottom: L28,

    frame: L20,
    hover: accentHex,

    chipFrame: L10,
    chipHover: accentHex,

    settingsChipFrame: L10,
    settingsChipHover: accentHex,
    exitChipFrame: L10,
    exitChipHover: accentHex,
    chipFace: L10,

    infoBarBg: rgba(0.92),
    heading: textMain,
    aux: textDim,
    hi: textHi,
    detailFrame: L20,
    detailFace: L13,

    labelBg: rgba(0.85),
    labelText: textMain,

    albumLabelBg: rgba(0.85),
    albumLabelSel: textMain,
    albumLabelUnsel: textDim,

    ray: rayHex,
    hitBox: L26,

    viewerBg: H(Hb, Sb_env, 0.07),
  };

  if (spec.overrides) {
    for (const k of Object.keys(spec.overrides) as (keyof Palette)[]) {
      const v = spec.overrides[k];
      if (v !== undefined) (pal as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return pal;
}

// ---- 内蔵テーマ：plain のみ（サーバには置かない。フォールバック基準）----
// base #4a5568（HSL 218°,17%,35%）/ accent #2f6feb（221°,83%,55%）/ vivid 0.5 で
// COLORS.md の実測値を再現する。
export const PLAIN_SPEC: ThemeSpec = {
  id: "plain",
  name: "Plain",
  base: "#4a5568",
  accent: "#2f6feb",
  vivid: 0.5,
};

export const PLAIN_PALETTE: Palette = buildPalette(PLAIN_SPEC);
