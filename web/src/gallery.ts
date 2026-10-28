import type { Photo } from "./api";

export function renderGrid(photos: Photo[], onOpen: (p: Photo) => void): void {
  const grid = document.getElementById("grid")!;
  grid.innerHTML = "";
  for (const p of photos) {
    const card = document.createElement("div");
    card.className = "card";
    const main = p.faces.find((f) => f.is_main) ?? p.faces[0];
    const badge = main?.pupil_px
      ? `<span class="badge ok">pupil ${main.pupil_px.toFixed(1)}px (${main.method})</span>`
      : `<span class="badge ng">顔なし → フォールバック</span>`;
    const albumBadge = p.album ? `<span class="badge album">📁 ${p.album}</span>` : "";
    card.innerHTML = `
      <img loading="lazy" src="${p.thumb_url ?? p.photo_url}" alt="${p.filename}" />
      <div class="meta"><b>${p.filename}</b>${p.width}×${p.height}px<br/>${albumBadge}${badge}</div>`;
    card.addEventListener("click", () => onOpen(p));
    grid.appendChild(card);
  }
}
