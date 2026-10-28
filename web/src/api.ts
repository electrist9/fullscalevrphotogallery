export interface FaceInfo {
  bbox: [number, number, number, number];
  pupil_px: number | null;
  roll_deg: number | null;
  yaw_deg: number | null;   // 首振り推定 (deg)。§4.2 姿勢補正
  conf: number | null;      // 信頼度 0〜1
  eye_cx: number | null;    // 虹彩中心中点 (px) — 原寸大の目の高さ配置
  eye_cy: number | null;
  crown_y: number | null;   // 頭頂推定 y (px)。身長=頭頂→足元
  sole_y: number | null;    // Pose検出の足元 y (px)。足先=床接地。未検出は null
  height_mm: number | null; // 身長 (mm)。算出不可は null
  method: string | null;
  is_main: boolean;
}

export interface Photo {
  id: number;
  filename: string;
  relpath: string;
  album: string; // '' = Photos/直下（無アルバム）
  width: number;
  height: number;
  size_bytes: number;
  thumb_url: string | null;
  photo_url: string;
  faces: FaceInfo[];
}

export interface Album {
  name: string; // '' = 直下
  count: number;
}

export interface IndexProgress {
  running: boolean;
  total: number;
  done: number;
  skipped: number; // 差分再スキャンでスキップした枚数
  current: string; // 処理中のファイル（relpath）
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
}

export async function fetchPhotos(): Promise<Photo[]> {
  const res = await fetch("/api/photos");
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function fetchAlbums(): Promise<Album[]> {
  const res = await fetch("/api/albums");
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// 2026-10-26: 再スキャンは非同期化。進捗は fetchIndexProgress でポーリング
export async function reindex(force = true): Promise<{ started: boolean; running: boolean }> {
  const res = await fetch(`/api/reindex?force=${force ? 1 : 0}`, { method: "POST" });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function fetchIndexProgress(): Promise<IndexProgress> {
  const res = await fetch("/api/index/progress");
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
