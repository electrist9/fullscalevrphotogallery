import * as THREE from "three";
import type { Photo } from "./api";
import type { Palette } from "./theme";

// 原寸大平面: mm_per_px = ipd_real / pupil_px（PLAN §4.2、server/scale.py と同じ計算）
// 姿勢補正 pupil_px/cos(yaw)、安全クランプ 0.3〜3.0m、顔なしは高さ1.0m固定フォールバック。
export interface PlaneScale {
  w: number; h: number;          // プレイン実寸 (mm)
  mmPerPx: number;
  source: string;
  clamped: boolean;              // クランプ適用 = 「推定に自信なし」
  lifeSize: boolean;             // false = 原寸大不可（フォールバック）
  eyeYpx: number | null;         // 虹彩中心 y (px)。原寸大の縦配置（半身: 目線1.55m）に使用
  soleYpx: number | null;        // Pose検出の足元 y (px)。全身: 足先=床接地に使用
  heightM: number | null;        // 身長 (m) = 頭頂→足元。詳細表示の表示用
}

const MAX_YAW_DEG = 60;
const MIN_PLANE_M = 0.3;
const MAX_PLANE_M = 3.0;

export function planeSizeMm(p: Photo, ipdMm: number): PlaneScale {
  const main = p.faces.find((f) => f.is_main) ?? p.faces[0];
  const yaw = main?.yaw_deg ?? 0;
  if (main?.pupil_px && Math.abs(yaw) <= MAX_YAW_DEG) {
    const pupilCorr = main.pupil_px / Math.cos((yaw * Math.PI) / 180); // ① 姿勢補正
    let mmPerPx = ipdMm / pupilCorr;
    let clamped = false;
    const planeMaxM = (Math.max(p.width, p.height) * mmPerPx) / 1000;
    if (planeMaxM > MAX_PLANE_M) { mmPerPx *= MAX_PLANE_M / planeMaxM; clamped = true; }
    else if (planeMaxM < MIN_PLANE_M) { mmPerPx *= MIN_PLANE_M / planeMaxM; clamped = true; }
    const yawNote = Math.abs(yaw) > 5 ? `, yaw ${yaw.toFixed(0)}°補正` : "";
    return {
      w: p.width * mmPerPx,
      h: p.height * mmPerPx,
      mmPerPx,
      source: `pupil_px=${main.pupil_px.toFixed(1)} (${main.method}${yawNote})`,
      clamped,
      lifeSize: true,
      eyeYpx: main.eye_cy ?? null,
      soleYpx: main.sole_y ?? null,
      heightM: main.height_mm != null ? main.height_mm / 1000 : null,
    };
  }
  const mmPerPx = 1000 / p.height; // 高さ1.0m 扱い
  const source = main?.pupil_px
    ? `yaw低信頼(${yaw.toFixed(0)}°): 高さ1.0m固定`
    : "顔なし: 高さ1.0m固定";
  return { w: p.width * mmPerPx, h: 1000, mmPerPx, source, clamped: false, lifeSize: false, eyeYpx: null, soleYpx: null, heightM: null };
}

export interface ViewerHandle { dispose(): void }

export function openViewer(container: HTMLElement, p: Photo, ipdMm: number, pal: Palette): ViewerHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(pal.viewerBg);
  const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.01, 100);

  const { w, h, mmPerPx, source, clamped, lifeSize } = planeSizeMm(p, ipdMm);
  const geo = new THREE.PlaneGeometry(w / 1000, h / 1000); // mm → m
  const tex = new THREE.TextureLoader().load(p.photo_url);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  scene.add(mesh);

  // 平面中央・見やすい距離にカメラ（M0: フラットビューア。M1 で XR 化）
  const dist = Math.max(0.6, Math.max(w, h) / 1000 * 0.9);
  camera.position.set(0, 0, dist);
  camera.lookAt(0, 0, 0);

  const info = document.getElementById("viewerinfo")!;
  const flag = clamped ? " ⚠推定に自信なし" : lifeSize ? "" : " ⚠原寸大不可";
  info.innerHTML = `<b>${p.filename}</b> 原寸 ${(w / 1000).toFixed(2)}×${(h / 1000).toFixed(2)}m ・ mm/px=${mmPerPx.toFixed(4)} ・ ${source} ・ 写真推定IPD=${ipdMm}mm${flag}`;

  // ドラッグで平行移動・ホイールで前後（簡易操作。M1 で本格的な移動）
  let dragging = false, px = 0, py = 0;
  const onDown = (e: PointerEvent) => { dragging = true; px = e.clientX; py = e.clientY; };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    mesh.position.x += (e.clientX - px) * dist * 0.001;
    mesh.position.y -= (e.clientY - py) * dist * 0.001;
    px = e.clientX; py = e.clientY;
  };
  const onUp = () => { dragging = false; };
  const onWheel = (e: WheelEvent) => {
    camera.position.z = THREE.MathUtils.clamp(camera.position.z * (1 + e.deltaY * 0.001), 0.2, 20);
  };
  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  container.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  container.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("resize", onResize);

  let raf = 0;
  const loop = () => { renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
  loop();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      container.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      container.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      tex.dispose(); geo.dispose();
      (mesh.material as THREE.MeshBasicMaterial).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
