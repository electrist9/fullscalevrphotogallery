// IPD 設定: デフォルト63mm + 設定で上書き（PLAN §10 決定事項）
const KEY = "fs…pdmm";

export function getIpdMm(): number {
  const v = parseFloat(localStorage.getItem(KEY) ?? "");
  return Number.isFinite(v) && v >= 50 && v <= 80 ? v : 63;
}

export function setIpdMm(mm: number): void {
  localStorage.setItem(KEY, String(mm));
}

// 半身原寸大の目の高さ (m): デフォルト1.45 + XR設定パネルで上書き（2026-10-26 要望）
const EYE_KEY = "fs…emm";
export const EYE_LIFE_DEFAULT = 1.45;
export const EYE_LIFE_MIN = 1.0;
export const EYE_LIFE_MAX = 2.0;

export function getEyeLifeM(): number {
  const v = parseFloat(localStorage.getItem(EYE_KEY) ?? "");
  return Number.isFinite(v) && v >= EYE_LIFE_MIN && v <= EYE_LIFE_MAX ? v : EYE_LIFE_DEFAULT;
}

export function setEyeLifeM(m: number): void {
  localStorage.setItem(EYE_KEY, String(m));
}

// ギャラリー連続スクロール速度 (rad/s): デフォルト1.2 + XR設定パネルで上書き（2026-10-28 要望）
const SCROLL_KEY = "fs…csec";
export const SCROLL_DEFAULT = 1.2;
export const SCROLL_MIN = 0.4;
export const SCROLL_MAX = 3.0;

export function getScrollRadPerSec(): number {
  const v = parseFloat(localStorage.getItem(SCROLL_KEY) ?? "");
  return Number.isFinite(v) && v >= SCROLL_MIN && v <= SCROLL_MAX ? v : SCROLL_DEFAULT;
}

export function setScrollRadPerSec(rps: number): void {
  localStorage.setItem(SCROLL_KEY, String(rps));
}

// 詳細画像の表示距離 (m): 2026-10-28 要望 — 原寸大全身 / 原寸大半身 / フィットの3種を個別設定（0.50〜5.00、XR設定パネルで変更可・localStorage保存）
export const DIST_MIN = 0.5;
export const DIST_MAX = 5.0;
export const DIST_LIFE_FULL_DEFAULT = 1.0; // 現状の LIFE_DIST と同じ
export const DIST_LIFE_HALF_DEFAULT = 1.0; // 現状の LIFE_DIST と同じ
export const DIST_FIT_DEFAULT = 2.4; // 現状の DETAIL_DIST と同じ
const DIST_FULL_KEY = "fsvg.distLifeFullM";
const DIST_HALF_KEY = "fsvg.distLifeHalfM";
const DIST_FIT_KEY = "fsvg.distFitM";

function getDistM(key: string, def: number): number {
  const v = parseFloat(localStorage.getItem(key) ?? "");
  return Number.isFinite(v) && v >= DIST_MIN && v <= DIST_MAX ? v : def;
}

export function getDistLifeFullM(): number {
  return getDistM(DIST_FULL_KEY, DIST_LIFE_FULL_DEFAULT);
}
export function setDistLifeFullM(m: number): void {
  localStorage.setItem(DIST_FULL_KEY, String(m));
}
export function getDistLifeHalfM(): number {
  return getDistM(DIST_HALF_KEY, DIST_LIFE_HALF_DEFAULT);
}
export function setDistLifeHalfM(m: number): void {
  localStorage.setItem(DIST_HALF_KEY, String(m));
}
export function getDistFitM(): number {
  return getDistM(DIST_FIT_KEY, DIST_FIT_DEFAULT);
}
export function setDistFitM(m: number): void {
  localStorage.setItem(DIST_FIT_KEY, String(m));
}
