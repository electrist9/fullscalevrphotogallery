// M3: WebXR immersive-vr ギャラリー＋原寸大モード（PLAN §5.1 / §7 M3）
// 弧状の壁面にサムネイルパネルを配置 → レイで選択 → **原寸大で開く**（フォールバック写真のみフィット）。
// 詳細表示のモードは開いた時点で固定: 顔認識できれば原寸大、できなければフィット（切替なし）。
// 移動: 左スティック=スムース移動、右スティック=スナップターン。
// 詳細表示中: トリガー=一覧に戻る、右スティック左右=次/前の画像（スナップターン停止）、左Xボタン=情報ラベル表示/非表示（デフォルト非表示）。
// M3アルバム整理: Photos/サブフォルダ=アルバム。上部チップ行で切替、グリッドは選択中アルバムのみ。
// XR設定: チップ行末尾の「⚙ 設定」で設定パネルを開く。写真推定IPD（mm）・半身の目の高さ（m）・スクロール速度（rad/s）をボタンで調整・localStorage保存。
import * as THREE from "three";
import type { Photo } from "./api";
import { planeSizeMm } from "./photoPlane";
import { getIpdMm, setIpdMm, getEyeLifeM, setEyeLifeM, EYE_LIFE_MIN, EYE_LIFE_MAX, getScrollRadPerSec, setScrollRadPerSec, SCROLL_DEFAULT, SCROLL_MIN, SCROLL_MAX } from "./settings";
import { createControllerRig, controllerRay, setRayLength, onControllerEvent, Locomotion } from "./xr-input";

const R = 3.4; // パネル配置半径 (m)
const PANEL_H = 0.42; // サムパネル高さ (m)
const PANEL_GAP = 0.14;
const ROW_Y = 1.3; // 2026-10-28 要望: ギャラリー1段化（旧3段 [1.3, 1.8, 2.3]）
const EYE_Y = 1.5; // フィット表示の中心高さ (m)
const DETAIL_DIST = 2.4; // フィット表示の距離 (m)
const DETAIL_FIT = 2.2; // フィット表示の最大辺 (m)
const LIFE_DIST = 1.0; // 原寸大: 視聴距離 (m、§4.2既定2.0m→Quest実機体感で1.0mに調整)
const NAV_COOLDOWN = 0.5; // 詳細表示中の右スティック画像切替クールダウン (秒)
// 2026-10-28 要望: アルバムチップをテキストボタン→アルバム先頭画像のサムネイル化。行はギャラリー上（旧2段目 y=1.8）。
// ギャラリー上端1.51m / チップ画像 1.66〜1.94m / 名下ラベル下端≈1.59m で干渉なし。枚数増時はギャラリーと同じ連続スクロール。
const CHIP_Y = 1.8; // アルバムチップ行の高さ (m)
const CHIP_THUMB_H = 0.28; // アルバムサムネイルの最大高さ (m)。幅=高さ×写真アスペクトで**アスペクト比は常に正確**（2026-10-28 実機指摘: 幅クランプで縦圧縮されていたため廃止）
const CHIP_THUMB_W_MAX = 0.42; // アルバムサムネイルの最大幅 (m)。超える横長写真のみ高さをアスペクト比維持で縮小
const CHIP_GAP = 0.14;
const CHIP_LABEL_MAX = 12; // チップ名の省略長（フォント4.5cm固定）
const SETTINGS_BTN_Y = 0.86; // ⚙設定ボタンの高さ (m)。ファイル名ラベル（y=1.0・下端0.966）の直下。galleryBand 下端0.95と重ならない
const SETTINGS_DIST = 1.2; // 設定パネルの頭からの距離 (m)
const IPD_MIN = 50; // 写真推定IPDの範囲 (settings.ts と同じ)
const IPD_MAX = 80;
const IPD_DEFAULT = 63;
const VISIBLE_ARC = 2.4; // 2026-10-28: 1段スクロールの表示ウィンドウ合計円弧角 (rad)
const BUILD_MARGIN = 0.7; // 表示ウィンドウ外に事前生成するパネルの円弧角余裕 (rad)
// 2026-10-28 要望: スクロール速度は定数化せず scrollSpeed 変数（既定1.2 rad/s、XR設定パネルで 0.4〜3.0 の範囲で変更可・localStorage保存。settings.ts 参照）
const TEX_CACHE_MAX = 48; // サムネイルテクスチャのLRU上限（ウィンドウ約16枚＋余裕。1000枚分は常駐させない）

interface Panel {
  group: THREE.Group;
  mesh: THREE.Mesh;
  frameMat: THREE.MeshBasicMaterial;
}

interface Chip {
  group: THREE.Group;
  mesh: THREE.Mesh; // レイキャストの当たり面（userData.album / userData.settings）
  frameMat: THREE.MeshBasicMaterial;
  album: string | null; // null=すべて
  settings?: boolean; // ⚙設定チップ
}

interface SettingsButton {
  group: THREE.Group;
  mesh: THREE.Mesh; // userData.action
  frameMat: THREE.MeshBasicMaterial;
  action: string;
}

interface SettingsPanel {
  root: THREE.Group;
  bodyCanvas: HTMLCanvasElement;
  bodyTex: THREE.CanvasTexture;
  buttons: SettingsButton[];
}

interface Detail {
  root: THREE.Group; // 配置（プレイヤー正面、y=0床基準）
  photoGroup: THREE.Group; // 実寸ジオメトリの平面（開いた時点でフィット or 原寸大に固定）
  photoMesh: THREE.Mesh;
  guide: THREE.Mesh; // 床接地ガイド（原寸大時のみ表示）
  guideMat: THREE.MeshBasicMaterial;
  label: THREE.Mesh;
  photo: Photo;
  wM: number;
  hM: number;
  lifeSize: boolean; // 原寸大可能か
  feetOnFloor: boolean; // 原寸大で画像内の足元(sole_y)が床接地（接地ガイドを出すか）
}

export async function startXRGallery(photos: Photo[], initialAlbum: string | null = null): Promise<void> {
  if (!navigator.xr) throw new Error("navigator.xr がありません（HTTPSとWebXR対応ブラウザが必要）");
  let ipdMm = getIpdMm(); // 写真推定IPD (mm)。XR設定パネルで変更・localStorage保存（settings.ts）
  let eyeLifeM = getEyeLifeM(); // 半身原寸大の目の高さ (m)。XR設定パネルで変更・localStorage保存（2026-10-26 要望）
  let scrollSpeed = getScrollRadPerSec(); // 2026-10-28 要望: 右スティック最大倒し時のスクロール角速度 (rad/s)。設定パネルで変更可・localStorage保存
  const session = await navigator.xr.requestSession("immersive-vr", {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["bounded-floor", "hand-tracking"],
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  await renderer.xr.setSession(session);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d10);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  const player = new THREE.Group();
  player.add(camera);
  scene.add(player);

  const texLoader = new THREE.TextureLoader();
  const ownedTextures: THREE.Texture[] = [];
  const getTex = (url: string): THREE.Texture => {
    const t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    ownedTextures.push(t);
    return t;
  };

  buildRoom(scene);

  // M3アルバム: サブフォルダ単位でグリッドを切り替える（null=すべて）
  const albums = deriveAlbums(photos);
  // 2026-10-28 要望: 2Dページで選択中のアルバムを VR 開始時にも引き継ぐ（存在しないアルバム名は「すべて」にフォールバック）
  const startAlbum = initialAlbum !== null && photos.some((p) => p.album === initialAlbum) ? initialAlbum : null;
  let currentAlbum: string | null = startAlbum;
  let visiblePhotos: Photo[] = startAlbum === null ? photos : photos.filter((p) => p.album === startAlbum);
  // 2026-10-28 要望: 1段＋右スティック連続スクロール（ページング廃止）。
  // 1000枚規模の快適性: スクロール位置のウィンドウ（VISIBLE_ARC＋余裕分）だけ生成し、外れた分は破棄する。
  const gridContainer = new THREE.Group();
  scene.add(gridContainer);
  let panels: Panel[] = [];
  let panelMeshes: THREE.Mesh[] = [];

  // サムネイルテクスチャのLRUキャッシュ（パネル破棄でもテクスチャは消さず、スクロール戻りを即表示。セッション終了時に全破棄）
  const texCache = new Map<string, THREE.Texture>();
  const getThumbTex = (url: string): THREE.Texture => {
    let t = texCache.get(url);
    if (t) {
      texCache.delete(url);
      texCache.set(url, t); // LRU更新
      return t;
    }
    t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    ownedTextures.push(t);
    texCache.set(url, t);
    while (texCache.size > TEX_CACHE_MAX) {
      const first = texCache.entries().next();
      if (first.done) break;
      const [k, old] = first.value;
      if (panels.some((p) => (p.mesh.material as THREE.MeshBasicMaterial).map === old)) break; // 最古が現用: 一時的に上限超過を許容
      if (chips.some((c) => (c.mesh.material as THREE.MeshBasicMaterial).map === old)) break; // 2026-10-28: アルバムサムネイルチップも現用扱い（表示中の黒面化防止）
      texCache.delete(k);
      old.dispose();
    }
    return t;
  };

  // 1段レイアウト: 各写真の累積円弧角を事前計算（pw/ph=パネル寸法、aCenter=全体帯における中心円弧角）
  interface Slot {
    pw: number;
    ph: number;
    aCenter: number;
  }
  let slots: Slot[] = [];
  let totalArc = 0;
  const computeLayout = () => {
    slots = [];
    let arc = 0;
    for (const p of visiblePhotos) {
      const aspect = p.width / p.height;
      let pw = PANEL_H * aspect;
      if (pw > 0.85) pw = 0.85; // 横長パノラマの暴走防止
      slots.push({ pw, ph: pw / aspect, aCenter: arc + pw / 2 / R });
      arc += (pw + PANEL_GAP) / R;
    }
    totalArc = arc;
  };
  const maxScroll = () => Math.max(0, totalArc - VISIBLE_ARC);
  let scrollArc = 0; // スクロール位置 (rad、0..maxScroll)
  const gridOffset = () => scrollArc + Math.min(totalArc, VISIBLE_ARC) / 2; // aCenterから引いて表示角にする（全枚数が窓内のときは中央寄せ）
  const built = new Map<number, Panel>(); // 写真index -> パネル

  const placePanel = (p: Panel, i: number) => {
    const a = slots[i].aCenter - gridOffset();
    p.group.position.set(R * Math.sin(a), ROW_Y, -R * Math.cos(a));
    p.group.rotation.y = -a; // 円弧中心（原点）の方を向く
  };

  const updateGridWindow = () => {
    const off = gridOffset();
    const lo = -VISIBLE_ARC / 2 - BUILD_MARGIN;
    const hi = VISIBLE_ARC / 2 + BUILD_MARGIN;
    for (const [i, p] of [...built]) {
      const a = slots[i].aCenter - off;
      if (a < lo || a > hi) {
        gridContainer.remove(p.group);
        disposeSubtree(p.group); // テクスチャはLRUキャッシュに残す
        built.delete(i);
      }
    }
    for (let i = 0; i < slots.length; i++) {
      const a = slots[i].aCenter - off;
      if (a > hi) break;
      if (a < lo || built.has(i)) continue;
      const it = slots[i];
      const photo = visiblePhotos[i];
      const group = new THREE.Group();
      const frameMat = new THREE.MeshBasicMaterial({ color: 0x2c3038 });
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(it.pw + 0.04, it.ph + 0.04), frameMat);
      frame.position.z = -0.006;
      group.add(frame);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(it.pw, it.ph),
        new THREE.MeshBasicMaterial({ map: getThumbTex(photo.thumb_url ?? photo.photo_url) }),
      );
      mesh.userData.photo = photo;
      group.add(mesh);
      gridContainer.add(group);
      const panel: Panel = { group, mesh, frameMat };
      built.set(i, panel);
      placePanel(panel, i);
    }
    for (const [i, p] of built) placePanel(p, i);
    panels = [...built.values()];
    panelMeshes = panels.map((p) => p.mesh);
  };

  const rebuildGrid = () => {
    for (const p of panels) {
      gridContainer.remove(p.group);
      disposeSubtree(p.group); // テクスチャはLRUキャッシュに残す（アルバム切替でも再利用）
    }
    built.clear();
    computeLayout();
    scrollArc = Math.min(scrollArc, maxScroll());
    updateGridWindow();
  };
  rebuildGrid();

  // 2026-10-28 要望: 写真と写真の間の隙間へ照準中も連続スクロールを継続したい（隙間ではスナップターンになるのが使いにくい）。
  // パネルの裏（半径 R+0.06）に透明の帯を張り、ギャラリー円弧窓＋余裕分の範囲でレイを受け止める。
  // visible=false でも three.js の Raycaster はヒットさせる（visible は描画のみ）。スクロール不可（maxScroll=0）のときはホバー対象に入れない。
  // セッション終了時の disposeSubtree(scene) で geometry/material も破棄される。
  const BAND_A = VISIBLE_ARC / 2 + BUILD_MARGIN; // 帯が覆う円弧の半幅 (rad)
  const galleryBand = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.06, R + 0.06, 0.7, 48, 1, true, Math.PI - BAND_A, BAND_A * 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }),
  );
  galleryBand.position.y = ROW_Y; // 2026-10-28: 高さ0.9→0.7（0.95〜1.65m）。アルバムサムネイル行（1.66m〜）とy範囲を排他にし、隙間照準のスクロール先を明確化
  galleryBand.visible = false;
  scene.add(galleryBand);

  // 2026-10-28 要望: アルバムサムネイル行の隙間照準でも連続スクロールを継続（ギャラリーの galleryBand と同じ仕組み）
  const albumBand = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.06, R + 0.06, 0.4, 48, 1, true, Math.PI - BAND_A, BAND_A * 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }),
  );
  albumBand.position.y = CHIP_Y + 0.05; // 1.65〜2.05m（チップ画像 1.66〜1.94m を覆う）
  albumBand.visible = false;
  scene.add(albumBand);

  // 2026-10-26 要望: サムネイルのファイル名はホバー時のみギャラリー中央下部の固定位置に表示
  const hoverCanvas = document.createElement("canvas");
  hoverCanvas.width = 1024;
  hoverCanvas.height = 64;
  const hoverTex = new THREE.CanvasTexture(hoverCanvas);
  hoverTex.colorSpace = THREE.SRGBColorSpace;
  hoverTex.anisotropy = 4;
  const hoverLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, (1.1 * hoverCanvas.height) / hoverCanvas.width),
    new THREE.MeshBasicMaterial({ map: hoverTex, transparent: true }),
  );
  hoverLabel.position.set(0, 1.0, -R + 0.06); // 最下行（y=1.35）の真下、円弧中央の正面を向く
  hoverLabel.userData.labelTexture = hoverTex; // disposeSubtree で消す
  hoverLabel.visible = false;
  scene.add(hoverLabel);
  let hoverLabelName: string | null = null;
  const drawHoverLabel = (name: string) => {
    const ctx = hoverCanvas.getContext("2d")!;
    ctx.fillStyle = "rgba(20,22,26,0.85)";
    ctx.fillRect(0, 0, hoverCanvas.width, hoverCanvas.height);
    ctx.font = "40px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8eaed";
    ctx.fillText(truncate(name, 40), hoverCanvas.width / 2, hoverCanvas.height / 2);
    hoverTex.needsUpdate = true;
  };

  // 2026-10-28 要望: アルバムチップ行をサムネイル化（各アルバムの先頭画像＝relpath順の最初。サーバーは ORDER BY relpath で返すため決定論的）。
  // ギャラリーと同じ窓方式の連続スクロール（窓内生成/窓外破棄、albumBand で隙間照準もスクロール）。
  // ⚙設定ボタンはスクロール行に含めず、ファイル名ラベルの下（円弧中央・固定）に常設（2026-10-28 要望: 歯車アイコンのみ）。
  interface ChipItem {
    label: string;
    album: string | null;
    first: Photo; // サムネイル元（アルバム先頭画像）
    fw: number; // サムネイル幅 (m)。アスペクト比維持
    fh: number; // サムネイル高さ (m)。標準は CHIP_THUMB_H、横長で幅上限に達したときのみ小さくなる
    aCenter: number; // 行全体における中心円弧角 (rad)
  }
  const chipItems: ChipItem[] = [];
  if (photos.length > 0) {
    const defs = [
      { label: `すべて (${photos.length})`, album: null as string | null, first: photos[0] },
      ...albums.map((a) => ({ label: `${a.name === "" ? "直下" : a.name} (${a.count})`, album: a.name as string | null, first: a.first })),
    ];
    for (const d of defs) {
      // 2026-10-28 実機指摘: 高さ固定＋幅クランプは縦圧縮（アスペクト比ゆがみ）を生むため、
      // アスペクト比を維持したまま「高さ≤0.28m・幅≤0.42m」の箱に収める（標準写真の高さは 0.28m）
      const aspect = d.first.width / d.first.height;
      let fw = CHIP_THUMB_H * aspect;
      let fh = CHIP_THUMB_H;
      if (fw > CHIP_THUMB_W_MAX) {
        fw = CHIP_THUMB_W_MAX;
        fh = fw / aspect;
      }
      chipItems.push({ label: d.label, album: d.album, first: d.first, fw, fh, aCenter: 0 });
    }
  }
  let chipTotalArc = 0;
  const computeChipLayout = () => {
    let arc = 0;
    for (const it of chipItems) {
      it.aCenter = arc + it.fw / 2 / R;
      arc += (it.fw + CHIP_GAP) / R;
    }
    chipTotalArc = arc;
  };
  const albumMaxScroll = () => Math.max(0, chipTotalArc - VISIBLE_ARC);
  let albumScrollArc = 0; // アルバム行のスクロール位置 (rad、0..albumMaxScroll)
  const chipOffset = () => albumScrollArc + Math.min(chipTotalArc, VISIBLE_ARC) / 2;
  const chipContainer = new THREE.Group();
  scene.add(chipContainer);
  const chipBuilt = new Map<number, Chip>();
  let chips: Chip[] = [];
  let chipMeshes: THREE.Mesh[] = [];

  const placeChip = (c: Chip, i: number) => {
    const a = chipItems[i].aCenter - chipOffset();
    c.group.position.set(R * Math.sin(a), CHIP_Y, -R * Math.cos(a));
    c.group.rotation.y = -a; // 円弧中心（原点）の方を向く
  };

  const buildChip = (it: ChipItem): Chip => {
    const group = new THREE.Group();
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x14161a }); // 枠は黒（ホバー/選択時のみ青）
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(it.fw + 0.04, it.fh + 0.04), frameMat); // 枠はサムネイルに密着（高さは写真アスペクトで可変）
    frame.position.z = -0.006;
    group.add(frame);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(it.fw, it.fh), // 2026-10-28 実機指摘: 元画像と同じアスペクト比（縦圧縮の修正）
      new THREE.MeshBasicMaterial({ map: getThumbTex(it.first.thumb_url ?? it.first.photo_url) }),
    );
    face.userData.album = it.album;
    group.add(face);
    const label = makeLabel(truncate(it.label, CHIP_LABEL_MAX), it.fw, 0.045); // 名下ラベル（フォント4.5cm）
    label.position.set(0, -(it.fh / 2 + 0.075), 0.004);
    group.add(label);
    chipContainer.add(group);
    return { group, mesh: face, frameMat, album: it.album };
  };

  const updateChipWindow = () => {
    const off = chipOffset();
    const lo = -VISIBLE_ARC / 2 - BUILD_MARGIN;
    const hi = VISIBLE_ARC / 2 + BUILD_MARGIN;
    for (const [i, c] of [...chipBuilt]) {
      const a = chipItems[i].aCenter - off;
      if (a < lo || a > hi) {
        chipContainer.remove(c.group);
        disposeSubtree(c.group); // テクスチャはLRUキャッシュに残す
        chipBuilt.delete(i);
      }
    }
    for (let i = 0; i < chipItems.length; i++) {
      const a = chipItems[i].aCenter - off;
      if (a > hi) break;
      if (a < lo || chipBuilt.has(i)) continue;
      const c = buildChip(chipItems[i]);
      chipBuilt.set(i, c);
      placeChip(c, i);
    }
    for (const [i, c] of chipBuilt) placeChip(c, i);
    chips = [...chipBuilt.values()];
    chipMeshes = chips.map((c) => c.mesh);
  };

  const rebuildChips = () => {
    computeChipLayout();
    albumScrollArc = Math.min(albumScrollArc, albumMaxScroll()); // アルバム切替でも行のスクロール位置は維持（上限クランプのみ）
    updateChipWindow();
  };
  rebuildChips();

  // ⚙設定ボタン（固定。一覧画像のファイル名ラベルの直下、歯車アイコンのみ。2026-10-28 要望）
  const settingsChipGroup = new THREE.Group();
  settingsChipGroup.position.set(0, SETTINGS_BTN_Y, -R + 0.06); // ファイル名ラベルと同じ正面平面（円弧中央、回転なしで原点を向く）
  const settingsChipFrameMat = new THREE.MeshBasicMaterial({ color: 0x14161a });
  const settingsIcon = makeLabel("⚙", 0, 0.06); // 歯車アイコンのみ（フォント6cm）
  const iconW = (settingsIcon.geometry as THREE.PlaneGeometry).parameters.width;
  const iconH = (settingsIcon.geometry as THREE.PlaneGeometry).parameters.height;
  {
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(iconW + 0.04, iconH + 0.04), settingsChipFrameMat);
    frame.position.z = -0.006;
    settingsChipGroup.add(frame);
  }
  const settingsChipMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(iconW, iconH),
    new THREE.MeshBasicMaterial({ color: 0x14161a }),
  );
  settingsChipMesh.userData.settings = true;
  settingsChipGroup.add(settingsChipMesh);
  settingsIcon.position.z = 0.004;
  settingsChipGroup.add(settingsIcon);
  scene.add(settingsChipGroup);

  // 没入モード終了ボタン（固定。⚙ボタンの右、同じ正面平面。押すと immersive-vr セッションを終了し 2D ページ（ブラウザ）へ戻る。2026-10-28 要望・案A）
  const exitChipGroup = new THREE.Group();
  const exitChipFrameMat = new THREE.MeshBasicMaterial({ color: 0x14161a });
  const exitIcon = makeLabel("🚪", 0, 0.06); // ドアアイコンのみ（フォント6cm）
  const exitW = (exitIcon.geometry as THREE.PlaneGeometry).parameters.width;
  const exitH = (exitIcon.geometry as THREE.PlaneGeometry).parameters.height;
  exitChipGroup.position.set((iconW + exitW) / 2 + 0.06, SETTINGS_BTN_Y, -R + 0.06); // ⚙の枠と2cm空けて右隣
  {
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(exitW + 0.04, exitH + 0.04), exitChipFrameMat);
    frame.position.z = -0.006;
    exitChipGroup.add(frame);
  }
  const exitChipMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(exitW, exitH),
    new THREE.MeshBasicMaterial({ color: 0x14161a }),
  );
  exitChipMesh.userData.exit = true;
  exitChipGroup.add(exitChipMesh);
  exitIcon.position.z = 0.004;
  exitChipGroup.add(exitIcon);
  scene.add(exitChipGroup);

  const rig = createControllerRig(renderer, player);
  const loco = new Locomotion();
  const raycaster = new THREE.Raycaster();

  let detail: Detail | null = null;

  // 2026-10-28 要望: 情報ラベルはデフォルト非表示。詳細画像上のトリガーで表示/非表示トグル（Xボタン操作は廃止）。
  let labelVisible = false;

  const closeDetail = () => {
    if (!detail) return;
    scene.remove(detail.root);
    disposeSubtree(detail.root);
    detail = null;
  };

  const detailLines = (d: Detail): string[] => {
    const sc = planeSizeMm(d.photo, ipdMm);
    const flag = sc.clamped ? " ⚠推定に自信なし" : sc.lifeSize ? "" : " ⚠原寸大不可";
    const modeLine = !d.lifeSize
      ? "フィット表示（原寸大不可: 顔なし/低信頼） ・ トリガー=一覧に戻る ・ 右スティック=次/前 ・ Xボタン=情報表示/非表示"
      : `モード: 原寸大（${d.feetOnFloor ? "足元=床接地" : `目の高さ${eyeLifeM.toFixed(2)}m`}） ・ トリガー=一覧に戻る ・ 右スティック=次/前 ・ Xボタン=情報表示/非表示`;
    return [
      d.photo.album ? `${d.photo.filename}（📁 ${d.photo.album}）` : d.photo.filename,
      `原寸 ${d.wM.toFixed(2)}×${d.hM.toFixed(2)}m${sc.heightM != null ? ` ・ 身長推定 ${sc.heightM.toFixed(2)}m（頭頂→足元）` : ""} ・ mm/px=${sc.mmPerPx.toFixed(4)} ・ ${sc.source}${flag}`,
      modeLine,
    ];
  };

  const openDetail = (photo: Photo) => {
    closeDetail();
    const sc = planeSizeMm(photo, ipdMm);
    const wM = sc.w / 1000;
    const hM = sc.h / 1000;
    const fitScale = DETAIL_FIT / Math.max(wM, hM);

    // 原寸大の縦配置（2026-10-26）: Poseで足元(sole_y)検出済みなら画像内の足先を床y=0に接地。
    // 足元が画像下端より上なら画像下端は床より下側に延びてよい（床で隠れるだけ）。
    // 足元未検出（半身等）は目線を eyeLifeM（デフォルト1.45m、XR設定パネルで変更可）に固定。
    let lifeY: number;
    let feetOnFloor = false;
    if (sc.lifeSize && sc.soleYpx != null) {
      const belowSoleM = ((photo.height - sc.soleYpx) * sc.mmPerPx) / 1000; // 足元→画像下端 (m)
      lifeY = hM / 2 - belowSoleM; // sole_y の位置が y=0 になる
      feetOnFloor = true;
    } else if (sc.lifeSize && sc.eyeYpx != null) {
      const eyeFromBottomM = ((photo.height - sc.eyeYpx) * sc.mmPerPx) / 1000;
      lifeY = eyeLifeM - eyeFromBottomM + hM / 2; // 半身: 目線を eyeLifeM に固定
    } else {
      lifeY = hM / 2 + 0.05;
    }

    // M3: 選択画面から原寸大で開く（原寸大不可＝フォールバック写真のみフィット表示で開く）
    const startLife = sc.lifeSize;
    const startZ = startLife ? DETAIL_DIST - LIFE_DIST : 0;

    // 2026-10-26: 原寸大全身表示で足元より下の余白（sole_y→画像下端）を折り曲げ、床面に平置きする
    // （写真の地面が部屋へ続く見せ方）。主プレインは sole_y→画像上端のみを映し、余白ストリップは
    // 同じテクスチャを UV 再マッピングで共有する（vSole = sole_y の位置、v: 0=画像下端/1=画像上端）。
    const stripBelowM = feetOnFloor && sc.soleYpx != null ? ((photo.height - sc.soleYpx) * sc.mmPerPx) / 1000 : 0;
    const useFold = feetOnFloor && stripBelowM >= 0.02; // 余白が2cm未満なら折り曲げない（ガイド従来通り）
    const vSole = sc.soleYpx != null ? 1 - sc.soleYpx / photo.height : 0;
    const mainHM = useFold ? hM - stripBelowM : hM; // 主プレインの高さ（sole_y→画像上端）

    const root = new THREE.Group(); // y=0（床基準）。photoGroup/label/guide を相対配置
    const photoGroup = new THREE.Group();
    photoGroup.position.y = startLife ? lifeY : EYE_Y;
    photoGroup.position.z = startZ;
    photoGroup.scale.setScalar(startLife ? 1 : fitScale);

    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(wM + 0.06, mainHM + 0.06),
      new THREE.MeshBasicMaterial({ color: 0x2c3038 }),
    );
    frame.position.z = -0.008;
    if (useFold) frame.position.y = stripBelowM / 2 + 0.03; // フレーム下端を床面（y=0）に合わせる（折り目 y=0 + 枠3cm。2026-10-28 修正: 主プレインのずれに連動）
    photoGroup.add(frame);

    const photoGeo = new THREE.PlaneGeometry(wM, mainHM);
    if (useFold) {
      // 主プレインは画像の上部（v: vSole〜1）だけを映す
      const uv = photoGeo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, vSole + (1 - vSole) * uv.getY(i));
    }
    const photoMesh = new THREE.Mesh(photoGeo, new THREE.MeshBasicMaterial({ map: getTex(photo.photo_url) }));
    if (useFold) photoMesh.position.y = stripBelowM / 2;
    // 2026-10-28 実機指摘（ComfyUI_00025_.png の斜線で判明）: photoGroup.position.y は画像全体（hM）基準の
    // lifeY だが、主プレインは切り抜き後 mainHM = hM − stripBelowM の高さでローカル y=0 に置かれていたため、
    // 主プレイン全体が stripBelowM/2 下がっていた。その結果 折り目（sole_y, v=vSole）が床 y=0 より
    // stripBelowM/2 下に隠れ、床面上では主プレインの下端（v=vSole+α）とストリップ折り目（v=vSole）の
    // 間で画像が stripBelowM/2 欠損し、直線がずれて見えた。主プレインを stripBelowM/2 上げて
    // 折り目を床 y=0（ストリップ折り目 y=0.002 と一致）に合わせ、UV を連続させる。
    photoGroup.add(photoMesh);

    // 余白ストリップ: 画像下端を折り曲げて床面に敷き、視聴者側（rootローカル +z、頭方向）へ延ばす
    let floorStrip: THREE.Mesh | null = null;
    if (useFold) {
      const stripGeo = new THREE.PlaneGeometry(wM, stripBelowM);
      const uv = stripGeo.attributes.uv as THREE.BufferAttribute;
      // +y 端（写真プレイン側=折り目）→ vSole、−y 端（視聴者側）→ 0（画像下端）
      for (let i = 0; i < uv.count; i++) uv.setY(i, vSole * uv.getY(i));
      floorStrip = new THREE.Mesh(stripGeo, new THREE.MeshBasicMaterial({ map: getTex(photo.photo_url) }));
      floorStrip.rotation.x = -Math.PI / 2; // 法線上向き、−y 端が +z（視聴者側）へ延びる
      floorStrip.position.set(0, 0.002, startZ + stripBelowM / 2); // 床より2mm上（Zファイティング回避）。+y端（折り目）は z=startZ の y≈0 で主プレイン下端（y=0）と接する
    }

    // 床接地ガイド: 平面下端から手前へ伸びる帯（原寸大時のみ opacity でフェード）
    const guideMat = new THREE.MeshBasicMaterial({
      color: 0x2f6feb,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const guide = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(wM, 0.4), 0.34), guideMat);
    guide.rotation.x = -Math.PI / 2;
    guide.position.set(0, 0.006, startZ + 0.18);
    guideMat.opacity = startLife ? 0.55 : 0;
    guide.visible = startLife && feetOnFloor && !useFold; // 余白ストリップを平置きする場合はガイド不要（折り目が見える）

    const d: Detail = {
      root, photoGroup, photoMesh, guide, guideMat,
      label: new THREE.Mesh(),
      photo, wM, hM,
      lifeSize: sc.lifeSize, feetOnFloor,
    };

    d.label = makeLabel(detailLines(d), Math.min(Math.max(wM, 0.9), 1.7));
    let labelY = photoGroup.position.y - (hM * photoGroup.scale.x) / 2 - 0.12;
    if (feetOnFloor) labelY = Math.max(labelY, 0.06); // 足元接地で画像下端が床より下でもラベルは床より上
    d.label.position.y = labelY;
    // ラベルは写真プレインと同じ奥行き＋手前2cm（rootローカル+z=頭方向）。
    // 原寸大（写真が頭から1.0m）でも写真の背面に回らず、下端真下で視認できる。
    d.label.position.z = photoGroup.position.z + 0.02;
    d.label.visible = labelVisible; // デフォルト非表示（詳細画像上のトリガーでトグル、状態はセッション中維持）

    root.add(photoGroup);
    root.add(guide);
    if (floorStrip) root.add(floorStrip);
    root.add(d.label);

    // 選択瞬間のプレイヤー正面に配置（頭位置基準・y=0床）
    anchorToHead(d);
    scene.add(root);
    detail = d;
  };

  // 詳細グループを頭の位置・向き基準でアンカーし直す（rootは床y=0、正面DETAIL_DIST）
  const anchorToHead = (d: Detail) => {
    const head = new THREE.Vector3();
    camera.getWorldPosition(head);
    const yaw = player.rotation.y;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    d.root.position.set(head.x, 0, head.z).addScaledVector(fwd, DETAIL_DIST);
    d.root.rotation.y = yaw;
  };

  // M3: 次/前の画像切替（詳細表示中の右スティック左右。周回・表示中のアルバム内）。頭の正面で開き直す（原寸大可なら原寸大で）
  const switchPhoto = (dir: number) => {
    const d = detail;
    const n = visiblePhotos.length;
    if (!d || n === 0) return;
    const i = visiblePhotos.indexOf(d.photo);
    const next = visiblePhotos[(((i < 0 ? 0 : i) + dir) % n + n) % n];
    closeDetail();
    openDetail(next);
  };

  // 2026-10-26: XR設定パネル（PLAN §5④）。「IPD」だとHMD側のIPDと誤解されるためラベルは「写真推定IPD」。
  // 2026-10-26 要望: 「半身の目の高さ」(EYE_LIFE) もパネルで変更可（1.00〜2.00m、±1/±5cm、localStorage保存）。
  // 2026-10-28 要望: 「スクロール速度」(0.4〜3.0 rad/s、±0.1/±0.4、localStorage保存) も追加。IPD/目の高さは次に写真を開いたときから反映、スクロール速度は次フレームから即反映。
  // 値はボタンで調整（VRにキーボードはない）。変更は次に写真を開いたときから反映（openDetail 時点で ipdMm/eyeLifeM を読む）。
  let settings: SettingsPanel | null = null;

  const drawSettingsBody = (sp: SettingsPanel) => {
    const c = sp.bodyCanvas;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(20,22,26,0.92)";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.textBaseline = "top";
    // 並び順（2026-10-26 要望 / 2026-10-28 スクロール速度追加）: タイトル → 操作説明 → IPDラベル → [IPDボタン行] → 目の高さラベル → [目の高さボタン行] → スクロール速度ラベル → [速度ボタン行]
    // ボタン行は Canvas の隙間に重ねて配置（openSettings の y 対応: 1px = bodyH/canvas.height m）
    ctx.fillStyle = "#e8eaed";
    ctx.font = "44px system-ui, sans-serif";
    ctx.fillText("設定", 24, 14);
    ctx.fillStyle = "#9aa5b1";
    ctx.font = "28px system-ui, sans-serif";
    ctx.fillText("ボタンにトリガー=調整 / 他をトリガー=閉じる", 24, 74);
    ctx.fillStyle = "#dfe3e8";
    ctx.font = "40px system-ui, sans-serif";
    ctx.fillText(`写真推定IPD: ${ipdMm.toFixed(1)} mm（50〜80）`, 24, 126);
    ctx.fillText(`半身の目の高さ: ${eyeLifeM.toFixed(2)} m（1.00〜2.00）`, 24, 300);
    ctx.fillText(`スクロール速度: ${scrollSpeed.toFixed(1)} rad/s（0.4〜3.0）`, 24, 474);
    sp.bodyTex.needsUpdate = true;
  };

  const closeSettings = () => {
    if (!settings) return;
    scene.remove(settings.root);
    disposeSubtree(settings.root);
    settings = null;
  };

  const openSettings = () => {
    closeSettings();
    const root = new THREE.Group();

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 640; // 2026-10-28: スクロール速度行の追加で 480→640（1px=0.001172m は幅固定なので不変）
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const bodyW = 1.2;
    const bodyH = (bodyW * canvas.height) / canvas.width;
    const body = new THREE.Mesh(
      new THREE.PlaneGeometry(bodyW, bodyH),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
    );
    body.userData.labelTexture = tex; // disposeSubtree で消す
    body.position.y = 0.1;
    root.add(body);

    const buttons: SettingsButton[] = [];
    const addButtonRow = (defs: [string, string][], y: number) => {
      const BW = 0.2;
      const BH = 0.11;
      const GAP = 0.035;
      const total = defs.length * BW + (defs.length - 1) * GAP;
      defs.forEach(([text, action], i) => {
        const g = new THREE.Group();
        g.position.set(-total / 2 + BW / 2 + i * (BW + GAP), y, 0.01); // 本文Canvasの手前に重ねる（ラベル行の隙間に配置）
        const frameMat = new THREE.MeshBasicMaterial({ color: 0x2c3038 });
        const frame = new THREE.Mesh(new THREE.PlaneGeometry(BW + 0.03, BH + 0.03), frameMat);
        frame.position.z = -0.006;
        g.add(frame);
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(BW, BH),
          new THREE.MeshBasicMaterial({ color: 0x1d2025 }),
        );
        face.userData.action = action;
        g.add(face);
        const lab = makeLabel(text, BW - 0.08);
        lab.position.z = 0.004;
        g.add(lab);
        root.add(g);
        buttons.push({ group: g, mesh: face, frameMat, action });
      });
    };
    // ボタン行の y は Canvas 上の隙間に対応（本文中心0.1・bodyH=0.75・上端0.475・1px=0.001172m）:
    // 1行目=IPD（キャンバスy230付近）、2行目=半身の目の高さ（キャンバスy408付近）、3行目=スクロール速度（キャンバスy576付近・2026-10-28追加）
    addButtonRow(
      [
        ["−1.0", "ipd_minus1"], // 2026-10-26 要望: 「−1」→「−1.0」表記（0.5刻みと揃える）
        ["−0.5", "ipd_minus05"],
        ["+0.5", "ipd_plus05"],
        ["+1.0", "ipd_plus1"], // 2026-10-26 要望: 「+1」→「+1.0」表記
        ["初期化", "ipd_reset"],
      ],
      0.205,
    );
    addButtonRow(
      [
        ["−5cm", "eye_minus5"],
        ["−1cm", "eye_minus1"],
        ["+1cm", "eye_plus1"],
        ["+5cm", "eye_plus5"],
        ["実測", "eye_measure"], // 2026-10-26 要望: 「初期化」→「実測」。HMDの床からの高さを自動入力（local-floor基準）
      ],
      -0.003,
    );
    addButtonRow(
      [
        ["−0.4", "scroll_minus04"],
        ["−0.1", "scroll_minus01"],
        ["+0.1", "scroll_plus01"],
        ["+0.4", "scroll_plus04"],
        ["初期化", "scroll_reset"], // 2026-10-28 要望: ギャラリー連続スクロール速度（rad/s）を調整。変更は次フレームから即反映
      ],
      -0.2,
    );

    const sp: SettingsPanel = { root, bodyCanvas: canvas, bodyTex: tex, buttons };
    drawSettingsBody(sp);

    // 頭の正面にアンカー（詳細と同じ向き。床基準でなく目の高さに浮かせる）
    const head = new THREE.Vector3();
    camera.getWorldPosition(head);
    const yaw = player.rotation.y;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    root.position.copy(head).addScaledVector(fwd, SETTINGS_DIST);
    root.position.y = 1.38; // 縦長パネル（2026-10-26 並び順変更）で上下の余白を調整
    root.rotation.y = yaw;
    scene.add(root);
    settings = sp;
  };

  const applySettingsAction = (action: string) => {
    if (action.startsWith("ipd_")) {
      const clamp = (v: number) => Math.min(IPD_MAX, Math.max(IPD_MIN, Math.round(v * 2) / 2));
      if (action === "ipd_minus1") ipdMm = clamp(ipdMm - 1);
      else if (action === "ipd_minus05") ipdMm = clamp(ipdMm - 0.5);
      else if (action === "ipd_plus05") ipdMm = clamp(ipdMm + 0.5);
      else if (action === "ipd_plus1") ipdMm = clamp(ipdMm + 1);
      else if (action === "ipd_reset") ipdMm = IPD_DEFAULT;
      setIpdMm(ipdMm);
    } else if (action.startsWith("eye_")) {
      const clamp = (v: number) => Math.min(EYE_LIFE_MAX, Math.max(EYE_LIFE_MIN, Math.round(v * 100) / 100));
      if (action === "eye_minus5") eyeLifeM = clamp(eyeLifeM - 0.05);
      else if (action === "eye_minus1") eyeLifeM = clamp(eyeLifeM - 0.01);
      else if (action === "eye_plus1") eyeLifeM = clamp(eyeLifeM + 0.01);
      else if (action === "eye_plus5") eyeLifeM = clamp(eyeLifeM + 0.05);
      else if (action === "eye_measure") {
        // 2026-10-26 要望: HMDの床からの高さ（local-floor基準のカメラy）を自動入力。
        // local フォールバック（y≈0）や異常値のときは適用しない。適用後 ±1cm/±5cm で微調整可。
        const hp = new THREE.Vector3();
        camera.getWorldPosition(hp);
        if (hp.y > 0.3) eyeLifeM = clamp(hp.y);
      }
      setEyeLifeM(eyeLifeM);
    } else if (action.startsWith("scroll_")) {
      // 2026-10-28 要望: ギャラリー連続スクロール速度（rad/s、0.4〜3.0、0.1刻み）。変数は毎フレーム読まれるので次フレームから即反映
      const clamp = (v: number) => Math.min(SCROLL_MAX, Math.max(SCROLL_MIN, Math.round(v * 10) / 10));
      if (action === "scroll_minus04") scrollSpeed = clamp(scrollSpeed - 0.4);
      else if (action === "scroll_minus01") scrollSpeed = clamp(scrollSpeed - 0.1);
      else if (action === "scroll_plus01") scrollSpeed = clamp(scrollSpeed + 0.1);
      else if (action === "scroll_plus04") scrollSpeed = clamp(scrollSpeed + 0.4);
      else if (action === "scroll_reset") scrollSpeed = SCROLL_DEFAULT;
      setScrollRadPerSec(scrollSpeed);
    }
    if (settings) drawSettingsBody(settings);
  };

  for (const c of rig.controllers) {
    onControllerEvent(c, "selectstart", () => {
      // 2026-10-26: 設定パネル表示中は ボタン=調整 / 他=閉じる で終了（グリッド選択は通さない）
      if (settings) {
        const btnHit = raycastPanel(raycaster, c, settings.buttons.map((b) => b.mesh));
        if (btnHit) applySettingsAction((btnHit.object as THREE.Mesh).userData.action as string);
        else closeSettings();
        return;
      }
      // 2026-10-28 要望: 詳細表示中は 詳細画像上のトリガー=情報パネルのトグル / 画像外のトリガー=一覧に戻る
      if (detail) {
        const imgHit = raycastPanel(raycaster, c, [detail.photoMesh]);
        if (imgHit) {
          labelVisible = !labelVisible;
          detail.label.visible = labelVisible;
        } else closeDetail();
        return;
      }
      // M3アルバム: サムネイルチップ選択でグリッドを再構築。⚙ボタン（ファイル名ラベル下・固定）で設定パネルを開く。🚪ボタン（⚙の右・固定）でVR終了→ブラウザへ戻る
      const chipHit = raycastPanel(raycaster, c, chipMeshes.concat([settingsChipMesh, exitChipMesh]));
      if (chipHit) {
        const obj = chipHit.object as THREE.Mesh;
        if (obj.userData.exit) {
          session.end(); // 「end」イベントでクリーンアップ→startXRGallery の Promise が解け、2D ページに戻る（main.ts の status 表示）
          return;
        }
        if (obj.userData.settings) {
          openSettings();
          return;
        }
        const album = obj.userData.album as string | null;
        if (album !== currentAlbum) {
          currentAlbum = album;
          visiblePhotos = album === null ? photos : photos.filter((p) => p.album === album);
          scrollArc = 0; // 2026-10-28: アルバム切替ではスクロールを先頭に戻す（旧: ページを先頭に）
          rebuildGrid();
          rebuildChips();
        }
        return;
      }
      const hit = raycastPanel(raycaster, c, panelMeshes);
      if (hit) openDetail((hit.object as THREE.Mesh).userData.photo as Photo);
    });
    // M3: グリップ（squeezestart）操作は廃止（詳細はトリガーで戻る）
  }

  const clock = new THREE.Clock();
  let navLast = -1;
  let pointingAtGrid = false; // 2026-10-28: 前フレームにレイがギャラリー（パネルまたは写真間の隙間）へ当たっていたか（右スティック=スクロール）
  let pointingAtAlbums = false; // 2026-10-28: 同上、アルバムサムネイル行（チップまたはその隙間帯）。両方当たった場合はアルバム行を優先
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;
    loco.setGamepads(Array.from(session.inputSources));
    // 2026-10-28: 詳細表示中は右スティック=画像切替 / ギャラリー・アルバム行へ照準中は右スティック=スクロール（いずれもスナップターン停止）
    loco.snapEnabled = !detail && !pointingAtGrid && !pointingAtAlbums;
    loco.update(dt, elapsed, camera, player);

    // 2026-10-28 要望: アルバム行の連続スクロール（ギャラリーと同じ窓方式。albumScrollArc で窓内生成/窓外破棄）
    if (!detail && !settings && pointingAtAlbums) {
      const rs = loco.rightStickRaw();
      if (rs !== 0) {
        const ns = Math.max(0, Math.min(albumMaxScroll(), albumScrollArc + rs * scrollSpeed * dt));
        if (ns !== albumScrollArc) {
          albumScrollArc = ns;
          updateChipWindow();
        }
      }
    } else if (!detail && !settings && pointingAtGrid) {
      // 2026-10-28 要望: 1段ギャラリーの右スティック左右による連続スクロール（パネルへ照準中のときのみ。窓外の生成/破棄は updateGridWindow）
      const rs = loco.rightStickRaw();
      if (rs !== 0) {
        const ns = Math.max(0, Math.min(maxScroll(), scrollArc + rs * scrollSpeed * dt));
        if (ns !== scrollArc) {
          scrollArc = ns;
          updateGridWindow();
        }
      }
    }

    // M3: 詳細表示中の右スティック左右 → 次/前の画像（周回、クールダウン付き）
    if (detail) {
      const rs = loco.rightStick();
      if (rs !== 0 && elapsed - navLast > NAV_COOLDOWN) {
        switchPhoto(rs > 0 ? 1 : -1);
        navLast = elapsed;
      }
    }

    // 2026-10-28 要望: X ボタンによる情報ラベルトグルは廃止（詳細画像上のトリガーでトグル）

    // ホバー表示（両コントローラのレイで照合。パネル・アルバムサムネイルチップ・⚙チップ・設定ボタンが対象）
    const targets = panelMeshes.concat(chipMeshes, [settingsChipMesh, exitChipMesh]);
    if (settings) targets.push(...settings.buttons.map((b) => b.mesh));
    // 2026-10-28 要望: 写真と写真の間の隙間への照準もスクロール対象に（パネル裏の透明帯。スクロール可能なときのみ有効）
    if (!detail && maxScroll() > 0) targets.push(galleryBand);
    // 2026-10-28 要望: アルバム行の隙間も同様（y範囲は galleryBand と排他: 0.95〜1.65m / 1.65〜2.05m）
    if (!detail && albumMaxScroll() > 0) targets.push(albumBand);
    const hovered = new Set<THREE.Mesh>();
    for (const c of rig.controllers) {
      const hit = raycastPanel(raycaster, c, targets);
      if (hit) {
        setRayLength(c, hit.distance);
        hovered.add(hit.object as THREE.Mesh);
      } else {
        setRayLength(c, 5);
      }
    }
    // 2026-10-28: 右スティック・スクロール切替の条件（レイがギャラリーパネル、またはその裏の透明帯＝写真と写真の隙間に当たっていること。
    // 次フレーム冒頭で参照され、体感遅延はなし。スクロール不可（maxScroll=0）のときはスナップターンを止めない）
    pointingAtGrid =
      !detail &&
      maxScroll() > 0 &&
      (hovered.has(galleryBand) || panels.some((p) => hovered.has(p.mesh)));
    // 2026-10-28: アルバム行も同様（チップまたは albumBand に当たっていること）
    pointingAtAlbums =
      !detail &&
      albumMaxScroll() > 0 &&
      (hovered.has(albumBand) || chips.some((ch) => hovered.has(ch.mesh)));
    let hoverName: string | null = null;
    for (const p of panels) {
      const on = hovered.has(p.mesh);
      p.frameMat.color.setHex(on ? 0x2f6feb : 0x2c3038);
      p.group.scale.setScalar(on ? 1.06 : 1);
      if (on) hoverName = (p.mesh.userData.photo as Photo).filename;
    }
    // ホバー中のファイル名を中央下部の固定ラベルに表示（変化があったフレームだけ再描画）
    if (hoverName !== hoverLabelName) {
      hoverLabelName = hoverName;
      if (hoverName) drawHoverLabel(hoverName);
      hoverLabel.visible = hoverName !== null;
    }
    for (const ch of chips) {
      const on = hovered.has(ch.mesh);
      const sel = ch.album === currentAlbum;
      ch.frameMat.color.setHex(on || sel ? 0x2f6feb : 0x14161a); // 非ホバー・非選択は枠を黒（面・ラベル背景と同色）に
      ch.group.scale.setScalar(on ? 1.06 : 1);
    }
    // 2026-10-28: ⚙設定ボタン（ファイル名ラベル下・固定）のホバー枠
    settingsChipFrameMat.color.setHex(hovered.has(settingsChipMesh) ? 0x2f6feb : 0x14161a);
    settingsChipGroup.scale.setScalar(hovered.has(settingsChipMesh) ? 1.06 : 1);
    exitChipFrameMat.color.setHex(hovered.has(exitChipMesh) ? 0x2f6feb : 0x14161a);
    exitChipGroup.scale.setScalar(hovered.has(exitChipMesh) ? 1.06 : 1);
    for (const b of settings?.buttons ?? []) {
      b.frameMat.color.setHex(hovered.has(b.mesh) ? 0x2f6feb : 0x2c3038);
    }

    renderer.render(scene, camera);
  });

  return new Promise<void>((resolve) => {
    session.addEventListener("end", () => {
      renderer.setAnimationLoop(null);
      rig.dispose();
      disposeSubtree(scene);
      for (const t of ownedTextures) t.dispose();
      renderer.dispose();
      resolve();
    });
  });
}

function raycastPanel(
  raycaster: THREE.Raycaster,
  c: THREE.Group,
  targets: THREE.Mesh[],
): THREE.Intersection | null {
  if (targets.length === 0) return null;
  const { origin, dir } = controllerRay(c);
  raycaster.set(origin, dir);
  raycaster.far = 10;
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length > 0 ? hits[0] : null;
}

function buildRoom(scene: THREE.Scene): void {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(R + 3.5, 48),
    new THREE.MeshBasicMaterial({ color: 0x14161a }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const grid = new THREE.GridHelper((R + 3.5) * 2, 28, 0x2c3038, 0x1d2025);
  grid.position.y = 0.002;
  scene.add(grid);

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 3.5, R + 3.5, 4, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x171a20, side: THREE.BackSide }),
  );
  wall.position.y = 2;
  scene.add(wall);
}

// 写真一覧からアルバム（''=直下）を件数＋先頭画像付きで抽出。'' は先頭、以降は名前順。
// 2026-10-28: first = そのアルバムの最初の画像（photos はサーバーが relpath 順に返すため決定論的）。サムネイルチップの表示元に使用。
function deriveAlbums(photos: Photo[]): { name: string; count: number; first: Photo }[] {
  const m = new Map<string, { count: number; first: Photo }>();
  for (const p of photos) {
    const e = m.get(p.album);
    if (e) e.count++;
    else m.set(p.album, { count: 1, first: p });
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] === b[0] ? 0 : a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0])))
    .map(([name, e]) => ({ name, count: e.count, first: e.first }));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// キャンバス→CanvasTexture でテキストパネル（フォント読み込み不要）
// fontWorldH 指定時は Canvas を文字数分の幅に保ったまま、ワールド上のフォント高さだけ固定にする（チップラベル用）
function makeLabel(lines: string[] | string, worldW: number, fontWorldH?: number): THREE.Mesh {
  const arr = Array.isArray(lines) ? lines : [lines];
  const pad = 12;
  const fontPx = arr.length === 1 ? 40 : 30;
  const lineH = fontPx * 1.35;
  const canvas = document.createElement("canvas");
  let ctx0 = canvas.getContext("2d")!;
  ctx0.font = `${fontPx}px system-ui, sans-serif`;
  const textW = Math.max(...arr.map((l) => ctx0.measureText(l).width));
  canvas.width = Math.ceil(textW + pad * 2);
  canvas.height = Math.ceil(lineH * arr.length + pad * 2);
  let ctx = canvas.getContext("2d")!; // resize で状態はリセットされる
  ctx.font = `${fontPx}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(20,22,26,0.85)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < arr.length; i++) {
    ctx.fillStyle = i === 0 ? "#e8eaed" : "#9aa5b1";
    ctx.fillText(arr[i], pad, pad + i * lineH);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const meshW = fontWorldH ? (fontWorldH * canvas.width) / fontPx : worldW;
  const worldH = fontWorldH ? (fontWorldH * canvas.height) / fontPx : (worldW * canvas.height) / canvas.width;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(meshW, worldH),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
  );
  mesh.userData.labelTexture = tex; // disposeSubtree で消す（ownedTextures には入れない）
  return mesh;
}

function disposeSubtree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    const kill = (x: THREE.Material) => {
      const labelTex = m.userData?.labelTexture as THREE.Texture | undefined;
      labelTex?.dispose();
      x.dispose();
    };
    if (Array.isArray(mat)) mat.forEach(kill);
    else if (mat) kill(mat);
  });
}
