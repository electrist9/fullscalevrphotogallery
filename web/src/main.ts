import { fetchIndexProgress, fetchPhotos, fetchThemes, reindex, type IndexProgress, type Photo } from "./api";
import { renderGrid } from "./gallery";
import { openViewer, type ViewerHandle } from "./photoPlane";
import { getIpdMm, getThemeName } from "./settings";
import { PLAIN_PALETTE, buildPalette, type Palette, type ThemeSpec } from "./theme";
import { startXRGallery } from "./xrGallery";

const albumSel = document.getElementById("albumsel") as HTMLSelectElement;
const statusEl = document.getElementById("status")!;
const viewer = document.getElementById("viewer")!;

let current: Photo | null = null;
let handle: ViewerHandle | null = null;

// テーマ（THEME_DESIGN.md §6.5/§7）。localStorage には名前だけ保存。サーバ配信一覧で名前解決し、
// 見つからなければ内蔵 plain にフォールバック（保存名は保持）。2DビューアとVRの両方で同じ pal を使う。
let serverThemes: ThemeSpec[] = [];
let pal: Palette = PLAIN_PALETTE;

async function resolveTheme(): Promise<void> {
  try {
    serverThemes = await fetchThemes();
  } catch {
    serverThemes = [];
  }
  const name = getThemeName();
  if (name === "plain") {
    pal = PLAIN_PALETTE;
    return;
  }
  const spec = serverThemes.find((t) => t.id === name);
  pal = spec ? buildPalette(spec) : PLAIN_PALETTE;
}

function closeViewer() {
  handle?.dispose();
  handle = null;
  current = null;
  viewer.classList.remove("active");
}

function showPhoto(p: Photo) {
  closeViewer();
  current = p;
  viewer.classList.add("active");
  handle = openViewer(viewer, p, getIpdMm(), pal);
}

document.getElementById("back")!.addEventListener("click", closeViewer);
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeViewer(); });

// M3アルバム: Photos/サブフォルダ=アルバム。セレクトで2D一覧を絞り込む（''=直下）
let allPhotos: Photo[] = [];

function albumLabel(name: string): string {
  return name === "" ? "直下" : name;
}

function populateAlbums(photos: Photo[]): void {
  const counts = new Map<string, number>();
  for (const p of photos) counts.set(p.album, (counts.get(p.album) ?? 0) + 1);
  const names = [...counts.keys()].sort((a, b) =>
    a === b ? 0 : a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
  );
  albumSel.innerHTML =
    `<option value="__all__">すべて (${photos.length})</option>` +
    names.map((n) => `<option value="${n}">${albumLabel(n)} (${counts.get(n)})</option>`).join("");
}

function renderFiltered(): void {
  const v = albumSel.value;
  const list = v === "__all__" ? allPhotos : allPhotos.filter((p) => p.album === v);
  renderGrid(list, showPhoto);
  statusEl.textContent = v === "__all__" ? `${list.length}枚` : `${list.length}枚（${albumLabel(v)}）`;
}

albumSel.addEventListener("change", renderFiltered);

// 2026-10-26: インデックス進捗UI。再スキャンは非同期開始し、/api/index/progress をポーリング
let pollTimer: number | null = null;

function fmtProgress(p: IndexProgress): string {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const cur = p.current ? `（${p.current.split("/").pop()}）` : "";
  return `インデックス中 ${p.done}/${p.total} ${pct}%${cur}`;
}

async function reloadPhotos(): Promise<void> {
  allPhotos = await fetchPhotos();
  populateAlbums(allPhotos);
  renderFiltered();
}

function stopPoll(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPoll(): void {
  stopPoll();
  pollTimer = window.setInterval(async () => {
    try {
      const p = await fetchIndexProgress();
      if (p.running) {
        statusEl.textContent = fmtProgress(p);
      } else {
        stopPoll();
        if (p.error) {
          statusEl.textContent = `インデックスエラー: ${p.error}`;
          return;
        }
        if (p.started_at !== null) {
          const secs = p.finished_at !== null ? Math.max(0, Math.round(p.finished_at - p.started_at)) : null;
          await reloadPhotos();
          statusEl.textContent = `インデックス完了 ${p.total}枚${secs !== null ? `（${secs}秒）` : ""}`;
        }
      }
    } catch (e) {
      statusEl.textContent = `進捗取得失敗: ${e}`;
    }
  }, 1000);
}

// 2026-10-26: 通常クリックは差分再スキャン（新規/変更のみ・1000枚でも即完了）。
// Shift+クリックで従来通りの全再実行（顔検出・サムネイルを全張り替え）。
document.getElementById("reindex")!.addEventListener("click", async (ev) => {
  const force = (ev as MouseEvent).shiftKey;
  statusEl.textContent = force ? "全再スキャン開始中…" : "差分再スキャン開始中…";
  try {
    await reindex(force);
    startPoll();
  } catch (e) {
    statusEl.textContent = `エラー: ${e}`;
  }
});

// M1: VRセッション（immersive-vr）起動。対応ブラウザ（Quest 3 等）でのみ有効化。
const vrBtn = document.getElementById("vrbtn") as HTMLButtonElement;
if (navigator.xr) {
  navigator.xr.isSessionSupported("immersive-vr").then((ok) => {
    if (!ok) {
      vrBtn.disabled = true;
      vrBtn.textContent = "VR非対応";
    }
  }).catch(() => {
    vrBtn.disabled = true;
    vrBtn.textContent = "VR非対応";
  });
} else {
  vrBtn.disabled = true;
  vrBtn.textContent = "VR非対応";
}

vrBtn.addEventListener("click", async () => {
  statusEl.textContent = "VRセッション開始中…（ヘッドセットを着用してください）";
  try {
    const photos = await fetchPhotos();
    await resolveTheme(); // VR起動直前にサーバテーマを再解決（テーマ追加/変更を反映）
    // 2026-10-28 要望: 2Dページで選択中のアルバムを VR に引き継ぐ（「すべて」は null）
    const v = albumSel.value;
    await startXRGallery(photos, v === "__all__" ? null : v, pal, serverThemes); // 写真推定IPDは xrGallery 内で settings.ts（localStorage）から取得
    statusEl.textContent = `VRセッション終了（${photos.length}枚）`;
  } catch (e) {
    statusEl.textContent = `VR起動失敗: ${e}`;
  }
});

(async () => {
  try {
    await resolveTheme(); // 2Dビューアの背景(V1)等に使う pal を先に解決
    allPhotos = await fetchPhotos();
    populateAlbums(allPhotos);
    renderFiltered();
    // 起動直後の差分インデックス（バックグラウンド）が続いていれば進捗UIを再開
    const p = await fetchIndexProgress();
    if (p.running) {
      statusEl.textContent = fmtProgress(p);
      startPoll();
    }
  } catch (e) {
    statusEl.textContent = `読み込み失敗: ${e}`;
  }
})();
