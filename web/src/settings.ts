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
