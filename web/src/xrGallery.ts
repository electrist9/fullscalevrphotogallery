// M3: WebXR immersive-vr ギャラリー＋原寸大モード（PLAN §5.1 / §7 M3）
// 弧状の壁面にサムネイルパネルを配置 → レイで選択 → **原寸大で開く**（フォールバック写真のみフィット）。
// 詳細表示のモードは開いた時点で固定: 顔認識できれば原寸大、できなければフィット（切替なし）。
// 移動: 左スティック=スムース移動、右スティック=スナップターン。
// 詳細表示中: トリガー=一覧に戻る、右スティック左右=次/前の画像（スナップターン停止）、左Xボタン=情報ラベル表示/非表示（デフォルト非表示）。
// M3アルバム整理: Photos/サブフォルダ=アルバム。上部チップ行で切替、グリッドは選択中アルバムのみ。
// XR設定: チップ行末尾の「⚙ 設定」で設定パネルを開く（2026-10-30 2画面化）。画面1=一覧（アイコン+ラベル+現在値。行トリガーで編集へ）、
// 画面2=個別編集（大きな値+範囲バー+±ボタン。戻る/行外トリガーで一覧へ）。写真推定IPD（mm）・半身の目の高さ（m）・スクロール速度（rad/s）・詳細表示距離（m: 原寸大全身/原寸大半身/フィット）を localStorage 保存。
import * as THREE from "three";
import { fetchThemes, type Photo } from "./api";
import { planeSizeMm } from "./photoPlane";
import { getIpdMm, setIpdMm, getEyeLifeM, setEyeLifeM, EYE_LIFE_DEFAULT, EYE_LIFE_MIN, EYE_LIFE_MAX, getScrollRadPerSec, setScrollRadPerSec, SCROLL_DEFAULT, SCROLL_MIN, SCROLL_MAX, getDistLifeFullM, setDistLifeFullM, getDistLifeHalfM, setDistLifeHalfM, getDistFitM, setDistFitM, DIST_MIN, DIST_MAX, DIST_LIFE_FULL_DEFAULT, DIST_LIFE_HALF_DEFAULT, DIST_FIT_DEFAULT, getThemeName, setThemeName } from "./settings";
import { createControllerRig, controllerRay, setRayLength, onControllerEvent, Locomotion } from "./xr-input";
import { PLAIN_PALETTE, PLAIN_SPEC, buildPalette, type Palette, type ThemeSpec } from "./theme";

const R = 3.4; // パネル配置半径 (m)
const PANEL_H = 0.42; // サムパネル高さ (m)
const PANEL_GAP = 0.14;
const ROW_Y = 1.3; // 2026-10-28 要望: ギャラリー1段化（旧3段 [1.3, 1.8, 2.3]）
const EYE_Y = 1.5; // フィット表示の中心高さ (m)
const DETAIL_DIST = 2.4; // 詳細 root の頭からのアンカー距離 (m)。実際の写真距離は photoGroup のオフセット（設定値）で作る（2026-10-28: 距離は設定パネルで3種個別可変化）
const DETAIL_FIT = 2.2; // フィット表示の最大辺 (m)
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
  frameMat?: THREE.MeshBasicMaterial; // 一覧行は帯をCanvas側で描画するため frame なし（undefined）
  action: string;
}

interface SettingsPanel {
  root: THREE.Group;
  bodyCanvas: HTMLCanvasElement;
  bodyTex: THREE.CanvasTexture;
  buttons: SettingsButton[];
  mode: "list" | "detail" | "theme"; // 2026-10-30 2画面化: 一覧 / 個別編集。+ テーマ選択画面
  detailKey: string | null; // mode=detail の編集対象
  hoverKey: string | null; // 一覧でレイが当たっている行の action（変化時のみCanvas再描画）
}

interface Detail {
  root: THREE.Group; // 配置（プレイヤー正面、y=0床基準）
  photoGroup: THREE.Group; // 実寸ジオメトリの平面（開いた時点でフィット or 原寸大に固定）
  photoMesh: THREE.Mesh;
  label: THREE.Mesh;
  photo: Photo;
  wM: number;
  hM: number;
  lifeSize: boolean; // 原寸大可能か
  feetOnFloor: boolean; // 原寸大で画像内の足元(sole_y)が床接地（sole固定・必要なら床折り曲げ）
  distM: number; // 開いたときに適用された表示距離 (m)。情報ラベル表示用
}

export async function startXRGallery(photos: Photo[], initialAlbum: string | null, palette: Palette, serverThemes: ThemeSpec[]): Promise<void> {
  if (!navigator.xr) throw new Error("navigator.xr がありません（HTTPSとWebXR対応ブラウザが必要）");
  let pal = palette; // 現在適用中のカラーパレット。テーマ切替で再代入→room/grid/chips 再構築
  const themes = serverThemes; // サーバ配信テーマ（内蔵 plain は含まない。ピッカー列挙と名前解決に使用）
  // テーマ選択画面の選択肢（内蔵 plain を先頭、続いてサーバ配信テーマ）。swatch=base色。
  const themeOptions = (): { id: string; name: string; base: string }[] => [
    { id: "plain", name: PLAIN_SPEC.name, base: PLAIN_SPEC.base },
    ...themes.map((t) => ({ id: t.id, name: t.name, base: t.base })),
  ];
  // 保存済みテーマ名 → 表示名（不明名は plain 表示）。
  const themeDisplayName = (id: string): string => {
    const opt = themeOptions().find((t) => t.id === id);
    return opt ? opt.name : "Plain";
  };
  let ipdMm = getIpdMm(); // 写真推定IPD (mm)。XR設定パネルで変更・localStorage保存（settings.ts）
  let eyeLifeM = getEyeLifeM(); // 半身原寸大の目の高さ (m)。XR設定パネルで変更・localStorage保存（2026-10-26 要望）
  let scrollSpeed = getScrollRadPerSec(); // 2026-10-28 要望: 右スティック最大倒し時のスクロール角速度 (rad/s)。設定パネルで変更可・localStorage保存
  // 2026-10-28 要望: 詳細画像の表示距離 (m) を3種個別に設定可能に（0.50〜5.00・localStorage保存）。
  // 全身=sole_y検出で足元床接地、半身=原寸大でsole_yなし（目線を eyeLifeM 固定）、フィット=原寸大不可のフォールバック。
  // 変更は次に写真を開いたときから反映（openDetail 時点で読む）。
  let distLifeFullM = getDistLifeFullM();
  let distLifeHalfM = getDistLifeHalfM();
  let distFitM = getDistFitM();
  const session = await navigator.xr.requestSession("immersive-vr", {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["bounded-floor", "hand-tracking"],
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  await renderer.xr.setSession(session);

  const scene = new THREE.Scene();
  // 背景・フォグは buildRoom(scene, pal) 内で pal から設定する（テーマ切替で再構築）
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

  let roomGroup = buildRoom(scene, pal);

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
      const frameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.frame) });
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
    ctx.fillStyle = pal.labelBg;
    ctx.fillRect(0, 0, hoverCanvas.width, hoverCanvas.height);
    ctx.font = "40px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = pal.labelText;
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
    const frameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.chipFrame) }); // 枠はチップ面色（ホバー/選択時のみアクセント色）
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(it.fw + 0.04, it.fh + 0.04), frameMat); // 枠はサムネイルに密着（高さは写真アスペクトで可変）
    frame.position.z = -0.006;
    group.add(frame);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(it.fw, it.fh), // 2026-10-28 実機指摘: 元画像と同じアスペクト比（縦圧縮の修正）
      new THREE.MeshBasicMaterial({ map: getThumbTex(it.first.thumb_url ?? it.first.photo_url) }),
    );
    face.userData.album = it.album;
    group.add(face);
    const label = makeLabel(truncate(it.label, CHIP_LABEL_MAX), it.fw, pal, 0.045); // 名下ラベル（フォント4.5cm）
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
  const settingsChipFrameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.settingsChipFrame) });
  const settingsIcon = makeLabel("⚙", 0, pal, 0.06); // 歯車アイコンのみ（フォント6cm）
  const iconW = (settingsIcon.geometry as THREE.PlaneGeometry).parameters.width;
  const iconH = (settingsIcon.geometry as THREE.PlaneGeometry).parameters.height;
  {
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(iconW + 0.04, iconH + 0.04), settingsChipFrameMat);
    frame.position.z = -0.006;
    settingsChipGroup.add(frame);
  }
  const settingsChipMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(iconW, iconH),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.chipFace) }),
  );
  settingsChipMesh.userData.settings = true;
  settingsChipGroup.add(settingsChipMesh);
  settingsIcon.position.z = 0.004;
  settingsChipGroup.add(settingsIcon);
  scene.add(settingsChipGroup);

  // 没入モード終了ボタン（固定。⚙ボタンの右、同じ正面平面。押すと immersive-vr セッションを終了し 2D ページ（ブラウザ）へ戻る。2026-10-28 要望・案A）
  const exitChipGroup = new THREE.Group();
  const exitChipFrameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.exitChipFrame) });
  const exitIcon = makeLabel("🚪", 0, pal, 0.06); // ドアアイコンのみ（フォント6cm）
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
    new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.chipFace) }),
  );
  exitChipMesh.userData.exit = true;
  exitChipGroup.add(exitChipMesh);
  exitIcon.position.z = 0.004;
  exitChipGroup.add(exitIcon);
  scene.add(exitChipGroup);

  const rig = createControllerRig(renderer, player, pal);
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
      ? `フィット表示（原寸大不可: 顔なし/低信頼）・距離${d.distM.toFixed(2)}m ・ トリガー=一覧に戻る ・ 右スティック=次/前 ・ Xボタン=情報表示/非表示`
      : `モード: 原寸大（${d.feetOnFloor ? "足元=床接地" : `目の高さ${eyeLifeM.toFixed(2)}m`}）・距離${d.distM.toFixed(2)}m ・ トリガー=一覧に戻る ・ 右スティック=次/前 ・ Xボタン=情報表示/非表示`;
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
    let halfBody = false;
    if (sc.lifeSize && sc.soleYpx != null) {
      const belowSoleM = ((photo.height - sc.soleYpx) * sc.mmPerPx) / 1000; // 足元→画像下端 (m)
      lifeY = hM / 2 - belowSoleM; // sole_y の位置が y=0 になる
      feetOnFloor = true;
    } else if (sc.lifeSize && sc.eyeYpx != null) {
      const eyeFromBottomM = ((photo.height - sc.eyeYpx) * sc.mmPerPx) / 1000;
      lifeY = eyeLifeM - eyeFromBottomM + hM / 2; // 半身: 目線を eyeLifeM に固定
      halfBody = true;
    } else {
      lifeY = hM / 2 + 0.05;
    }

    // M3: 選択画面から原寸大で開く（原寸大不可＝フォールバック写真のみフィット表示で開く）
    const startLife = sc.lifeSize;
    // 2026-10-28 要望: 表示距離を全身/半身/フィットの3モード個別に設定（設定パネル・0.50〜5.00m）。
    // root は DETAIL_DIST に固定アンカーし、photoGroup のオフセット startZ = DETAIL_DIST − distM で実距離 distM を作る。
    // 床折り曲げストリップ・接地ガイド・情報ラベルは startZ に連動済みなので追従する。
    const distM = feetOnFloor ? distLifeFullM : halfBody ? distLifeHalfM : distFitM;
    const startZ = DETAIL_DIST - distM;

    // 2026-10-26: 原寸大全身表示で足元より下の余白（sole_y→画像下端）を折り曲げ、床面に平置きする
    // （写真の地面が部屋へ続く見せ方）。主プレインは sole_y→画像上端のみを映し、余白ストリップは
    // 同じテクスチャを UV 再マッピングで共有する（vSole = sole_y の位置、v: 0=画像下端/1=画像上端）。
    const stripBelowM = feetOnFloor && sc.soleYpx != null ? ((photo.height - sc.soleYpx) * sc.mmPerPx) / 1000 : 0;
    const useFold = feetOnFloor && stripBelowM >= 0.02; // 余白が2cm未満なら折り曲げない（ガイド従来通り）
    const vSole = sc.soleYpx != null ? 1 - sc.soleYpx / photo.height : 0;
    const mainHM = useFold ? hM - stripBelowM : hM; // 主プレインの高さ（sole_y→画像上端）

    const root = new THREE.Group(); // y=0（床基準）。photoGroup/label を相対配置
    const photoGroup = new THREE.Group();
    photoGroup.position.y = startLife ? lifeY : EYE_Y;
    photoGroup.position.z = startZ;
    photoGroup.scale.setScalar(startLife ? 1 : fitScale);

    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(wM + 0.06, mainHM + 0.06),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.detailFrame) }),
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

    // 2026-10-29 実機指摘: 床接地ガイド（青帯）が折り曲げ面の前に青い四角として見え、
    // 余白<2cmで折り曲げないケースでも同様に不要な帯として見えた。接地は折り目（余白≥2cm）
    // または写真下端そのもの（余白<2cm）で視認できるためガイド帯を廃止した。

    const d: Detail = {
      root, photoGroup, photoMesh,
      label: new THREE.Mesh(),
      photo, wM, hM,
      lifeSize: sc.lifeSize, feetOnFloor,
      distM,
    };

    d.label = makeLabel(detailLines(d), Math.min(Math.max(wM, 0.9), 1.7), pal);
    let labelY = photoGroup.position.y - (hM * photoGroup.scale.x) / 2 - 0.12;
    if (feetOnFloor) labelY = Math.max(labelY, 0.06); // 足元接地で画像下端が床より下でもラベルは床より上
    d.label.position.y = labelY;
    // ラベルは写真プレインと同じ奥行き＋手前2cm（rootローカル+z=頭方向）。
    // 原寸大（写真が頭から1.0m）でも写真の背面に回らず、下端真下で視認できる。
    d.label.position.z = photoGroup.position.z + 0.02;
    d.label.visible = labelVisible; // デフォルト非表示（詳細画像上のトリガーでトグル、状態はセッション中維持）

    root.add(photoGroup);
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
  // 2026-10-28 要望: 「スクロール速度」(0.4〜3.0 rad/s、±0.1/±0.4、localStorage保存) も追加。
  // 2026-10-28 要望: 「詳細表示距離」を 原寸大全身/原寸大半身/フィット の3種追加（0.50〜5.00m、±0.1/±0.5、localStorage保存）。
  // 2026-10-30 改善: 1画面6行×5ボタン（テキスト約50要素）→ 2画面化。画面1=一覧（アイコン+ラベル+現在値のみ・6行）、
  // 行トリガーで画面2=個別編集（大きな値+範囲バー+±ボタン5個+戻る）へ。範囲表記はバーで視覚化し、
  // 上下限到達時はバーの塗り（目盛り）が赤になる。操作系: 一覧の行外=閉じる / 編集画面の行外=一覧へ戻る。
  // IPD/目の高さ/表示距離は次に写真を開いたときから反映、スクロール速度は次フレームから即反映。
  // 値はボタンで調整（VRにキーボードはない）。
  let settings: SettingsPanel | null = null;

  // 設定の定義テーブル（一覧/編集の両画面とアクション処理が共通参照）
  interface SettingDef {
    key: string;
    icon: string;
    label: string;
    unit: string;
    min: number;
    max: number;
    decimals: number;
    round: number; // 刻み丸め（0.5 / 0.01 / 0.1）
    steps: [number, number]; // [小刻み, 大刻み]（アクション minusL/minusS/plusS/plusL で使用）
    stepLabels: [string, string, string, string]; // ボタン: −大 −小 +小 +大
    resetLabel: string;
    hint: string; // 反映タイミング（編集画面のみ表示）
    get: () => number;
    apply: (v: number) => void; // クランプ+丸め後に変数と localStorage へ
    resetValue: () => number;
    measure?: () => number | null; // 実測（半身の目の高さのみ。null=適用不可）
  }
  const clampRound = (v: number, min: number, max: number, round: number) =>
    Math.min(max, Math.max(min, Math.round(v / round) * round));
  const settingDefs: SettingDef[] = [
    {
      key: "ipd", icon: "👁", label: "写真推定IPD", unit: "mm",
      min: IPD_MIN, max: IPD_MAX, decimals: 1, round: 0.5,
      steps: [0.5, 1],
      stepLabels: ["−1.0", "−0.5", "+0.5", "+1.0"], resetLabel: "初期化",
      hint: "※ 次に写真を開いたときから反映",
      get: () => ipdMm,
      apply: (v) => { ipdMm = clampRound(v, IPD_MIN, IPD_MAX, 0.5); setIpdMm(ipdMm); },
      resetValue: () => IPD_DEFAULT,
    },
    {
      key: "eye", icon: "↕", label: "半身の目の高さ", unit: "m",
      min: EYE_LIFE_MIN, max: EYE_LIFE_MAX, decimals: 2, round: 0.01,
      steps: [0.01, 0.05],
      stepLabels: ["−5cm", "−1cm", "+1cm", "+5cm"], resetLabel: "実測",
      hint: "※ 次に写真を開いたときから反映",
      get: () => eyeLifeM,
      apply: (v) => { eyeLifeM = clampRound(v, EYE_LIFE_MIN, EYE_LIFE_MAX, 0.01); setEyeLifeM(eyeLifeM); },
      resetValue: () => EYE_LIFE_DEFAULT,
      // 2026-10-26 要望: 「実測」= HMDの床からの高さ（local-floor基準のカメラy）を自動入力。
      // local フォールバック（y≈0）や異常値のときは適用しない。適用後 ±1cm/±5cm で微調整可。
      measure: () => {
        const hp = new THREE.Vector3();
        camera.getWorldPosition(hp);
        return hp.y > 0.3 ? hp.y : null;
      },
    },
    {
      key: "scroll", icon: "➡", label: "スクロール速度", unit: "rad/s",
      min: SCROLL_MIN, max: SCROLL_MAX, decimals: 1, round: 0.1,
      steps: [0.1, 0.4],
      stepLabels: ["−0.4", "−0.1", "+0.1", "+0.4"], resetLabel: "初期化",
      hint: "※ 次フレームから即時反映",
      get: () => scrollSpeed,
      apply: (v) => { scrollSpeed = clampRound(v, SCROLL_MIN, SCROLL_MAX, 0.1); setScrollRadPerSec(scrollSpeed); },
      resetValue: () => SCROLL_DEFAULT,
    },
    {
      key: "distfull", icon: "🧍", label: "原寸大全身の距離", unit: "m",
      min: DIST_MIN, max: DIST_MAX, decimals: 2, round: 0.01,
      steps: [0.1, 0.5],
      stepLabels: ["−0.5", "−0.1", "+0.1", "+0.5"], resetLabel: "初期化",
      hint: "※ 次に写真を開いたときから反映",
      get: () => distLifeFullM,
      apply: (v) => { distLifeFullM = clampRound(v, DIST_MIN, DIST_MAX, 0.01); setDistLifeFullM(distLifeFullM); },
      resetValue: () => DIST_LIFE_FULL_DEFAULT,
    },
    {
      key: "disthalf", icon: "◐", label: "原寸大半身の距離", unit: "m",
      min: DIST_MIN, max: DIST_MAX, decimals: 2, round: 0.01,
      steps: [0.1, 0.5],
      stepLabels: ["−0.5", "−0.1", "+0.1", "+0.5"], resetLabel: "初期化",
      hint: "※ 次に写真を開いたときから反映",
      get: () => distLifeHalfM,
      apply: (v) => { distLifeHalfM = clampRound(v, DIST_MIN, DIST_MAX, 0.01); setDistLifeHalfM(distLifeHalfM); },
      resetValue: () => DIST_LIFE_HALF_DEFAULT,
    },
    {
      key: "distfit", icon: "🖼", label: "フィット表示の距離", unit: "m",
      min: DIST_MIN, max: DIST_MAX, decimals: 2, round: 0.01,
      steps: [0.1, 0.5],
      stepLabels: ["−0.5", "−0.1", "+0.1", "+0.5"], resetLabel: "初期化",
      hint: "※ 次に写真を開いたときから反映",
      get: () => distFitM,
      apply: (v) => { distFitM = clampRound(v, DIST_MIN, DIST_MAX, 0.01); setDistFitM(distFitM); },
      resetValue: () => DIST_FIT_DEFAULT,
    },
  ];

  const drawSettingsBody = (sp: SettingsPanel) => {
    const c = sp.bodyCanvas;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = pal.infoBarBg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.textBaseline = "top";
    if (sp.mode === "list") {
      // 画面1: 一覧。行の背景帯（hover でアクセント色）は 3D 側、テキストのみ描画。
      // 1行=86px・上端118px（当たり面 mesh の y 対応: 1px = bodyH/canvas.height m）
      ctx.fillStyle = pal.heading;
      ctx.font = "44px system-ui, sans-serif";
      ctx.fillText("設定", 24, 14);
      ctx.fillStyle = pal.aux;
      ctx.font = "26px system-ui, sans-serif";
      ctx.fillText("行にトリガー=編集 / 他をトリガー=閉じる", 24, 72);
      settingDefs.forEach((d, i) => {
        const y = 118 + i * 86;
        // 行の背景帯（hover でアクセント色）。Canvas 側に描画するので本文テキストを隠さない（2026-10-30 不具合修正）
        ctx.fillStyle = sp.hoverKey === `open_${d.key}` ? pal.hover : withAlpha(pal.frame, 0.55);
        ctx.fillRect(26, y, c.width - 52, 78);
        ctx.fillStyle = pal.hi;
        ctx.font = "38px system-ui, sans-serif";
        ctx.fillText(`${d.icon} ${d.label}`, 40, y + 22);
        ctx.textAlign = "right";
        ctx.fillStyle = "#ffffff";
        ctx.font = "44px system-ui, sans-serif";
        ctx.fillText(`${d.get().toFixed(d.decimals)} ${d.unit}`, c.width - 40, y + 18);
        ctx.textAlign = "left";
      });
      // 最終行: テーマ選択（🎨）。値は現在適用中のテーマ名。
      {
        const y = 118 + settingDefs.length * 86;
        ctx.fillStyle = sp.hoverKey === "open_theme" ? pal.hover : withAlpha(pal.frame, 0.55);
        ctx.fillRect(26, y, c.width - 52, 78);
        ctx.fillStyle = pal.hi;
        ctx.font = "38px system-ui, sans-serif";
        ctx.fillText("🎨 テーマ", 40, y + 22);
        ctx.textAlign = "right";
        ctx.fillStyle = "#ffffff";
        ctx.font = "44px system-ui, sans-serif";
        ctx.fillText(themeDisplayName(getThemeName()), c.width - 40, y + 18);
        ctx.textAlign = "left";
      }
    } else if (sp.mode === "theme") {
      // テーマ選択画面。左上150px幅は「戻る」ボタンの空き（3D ボタンを重畳）。
      ctx.fillStyle = pal.heading;
      ctx.font = "44px system-ui, sans-serif";
      ctx.fillText("テーマ", 24, 14);
      ctx.fillStyle = pal.aux;
      ctx.font = "26px system-ui, sans-serif";
      ctx.fillText("行にトリガー=そのテーマへ切替", 24, 72);
      const cur = getThemeName();
      themeOptions().forEach((t, i) => {
        const y = 118 + i * 86;
        ctx.fillStyle = sp.hoverKey === `theme_${t.id}` ? pal.hover : withAlpha(pal.frame, 0.55);
        ctx.fillRect(26, y, c.width - 52, 78);
        // スウォッチ（base色）
        ctx.fillStyle = t.base;
        ctx.fillRect(44, y + 19, 40, 40);
        ctx.strokeStyle = pal.hi;
        ctx.lineWidth = 2;
        ctx.strokeRect(44, y + 19, 40, 40);
        ctx.fillStyle = pal.hi;
        ctx.font = "38px system-ui, sans-serif";
        ctx.fillText(t.name, 104, y + 22);
        if (t.id === cur) {
          ctx.textAlign = "right";
          ctx.fillStyle = pal.heading;
          ctx.font = "40px system-ui, sans-serif";
          ctx.fillText("✔ 適用中", c.width - 40, y + 20);
          ctx.textAlign = "left";
        }
      });
    } else {
      // 画面2: 個別編集。左上150px幅は「戻る」ボタンの空き（3D ボタンを重畳）
      const d = settingDefs.find((x) => x.key === sp.detailKey)!;
      ctx.fillStyle = pal.heading;
      ctx.font = "40px system-ui, sans-serif";
      ctx.fillText(`${d.icon} ${d.label}`, 170, 26);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffffff";
      ctx.font = "110px system-ui, sans-serif";
      ctx.fillText(`${d.get().toFixed(d.decimals)} ${d.unit}`, c.width / 2, 95);
      // 範囲バー: 塗り=下限からの目盛り。上下限到達時は赤（範囲テキストの代替）
      const v = d.get();
      const bx = 120;
      const bw = c.width - 240;
      const by = 250;
      const bh = 26;
      const t = (v - d.min) / (d.max - d.min);
      ctx.fillStyle = pal.frame;
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = v <= d.min || v >= d.max ? "#d64545" : pal.hover;
      ctx.fillRect(bx, by, Math.max(6, bw * t), bh);
      ctx.fillStyle = pal.heading;
      ctx.fillRect(bx + bw * t - 3, by - 8, 6, bh + 16);
      ctx.font = "24px system-ui, sans-serif";
      ctx.fillStyle = pal.aux;
      ctx.textAlign = "left";
      ctx.fillText(d.min.toFixed(d.decimals), bx, by + 42);
      ctx.textAlign = "right";
      ctx.fillText(d.max.toFixed(d.decimals), bx + bw, by + 42);
      ctx.textAlign = "center";
      ctx.fillStyle = pal.aux;
      ctx.font = "26px system-ui, sans-serif";
      ctx.fillText(d.hint, c.width / 2, c.height - 46);
      ctx.textAlign = "left";
    }
    sp.bodyTex.needsUpdate = true;
  };

  const closeSettings = () => {
    if (!settings) return;
    scene.remove(settings.root);
    disposeSubtree(settings.root);
    settings = null;
  };

  // mode=list: 一覧（行=当たり面+背景帯、トリガーで編集へ） / mode=detail: 個別編集（戻る+±ボタン5個）
  const openSettings = (mode: "list" | "detail" | "theme", detailKey?: string) => {
    closeSettings();
    const root = new THREE.Group();

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    // 一覧=7行（設定6 + テーマ1）で720px、テーマ画面=テーマ数に応じて動的、編集=512px。
    canvas.height = mode === "list" ? 720 : mode === "theme" ? 118 + themeOptions().length * 86 + 78 + 10 : 512;
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
    body.renderOrder = 1; // 2026-10-30 不具合修正: 設定パネルは常に最前面。本文を必ず先に描画させる
    root.add(body);
    const px = bodyH / canvas.height; // 1px のワールドサイズ (m)
    const top = 0.1 + bodyH / 2; // 本文Canvas上端（root ローカル y）

    const buttons: SettingsButton[] = [];
    const addButton = (text: string, action: string, x: number, y: number, w = 0.2, h = 0.11) => {
      const g = new THREE.Group();
      g.position.set(x, y, 0.01); // 本文Canvasの手前に重ねる
      const frameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.frame) });
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.03, h + 0.03), frameMat);
      frame.position.z = -0.006;
      frame.renderOrder = 2; // 本文(renderOrder=1)より確実に前面。不透明面は深度だけ書き、本文の描画を消さない
      g.add(frame);
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.detailFace) }),
      );
      face.userData.action = action;
      face.renderOrder = 2;
      g.add(face);
      const lab = makeLabel(text, w - 0.08, pal);
      lab.position.z = 0.004;
      lab.renderOrder = 3; // ボタン面より確実に前面
      g.add(lab);
      root.add(g);
      buttons.push({ group: g, mesh: face, frameMat, action });
    };

    if (mode === "list") {
      // 画面1: 行の当たり面のみ（透明 face）。背景帯は drawSettingsBody が Canvas 側に描画し、
      // hover 変化を render ループが hoverKey として検知して再描画する（2026-10-30 不具合修正: 3D帯が前面で文字を隠していた）
      const addRow = (action: string, i: number) => {
        const cy = top - (118 + i * 86 + 43) * px; // 行中心
        const rowW = bodyW - 0.06;
        const rowH = 86 * px - 0.008;
        const g = new THREE.Group();
        g.position.set(0, cy, 0.005);
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(rowW, rowH),
          // 2026-10-30 不具合修正: 当たり面のみの透明 mesh。depthWrite:false で本文（renderOrder=1）の
          // 深度を絶対に潰さない（潰すと本文の深度テストが落ち、その行だけ透けて写真が見える症状が出ていた）。
          // renderOrder:2 で本文より確実に後着順。raycast は material 設定に依存しないので当たり判定は不変。
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        );
        face.userData.action = action;
        face.renderOrder = 2;
        g.add(face);
        root.add(g);
        buttons.push({ group: g, mesh: face, action });
      };
      settingDefs.forEach((d, i) => addRow(`open_${d.key}`, i));
      addRow("open_theme", settingDefs.length); // 最終行: テーマ選択へ
    } else if (mode === "theme") {
      // テーマ選択画面: 各テーマ行の当たり面（透明 face）+ 左上「戻る」ボタン。
      addButton("← 戻る", "back", -bodyW / 2 + 0.115, top - 56 * px, 0.16, 0.1);
      themeOptions().forEach((t, i) => {
        const cy = top - (118 + i * 86 + 43) * px;
        const rowW = bodyW - 0.06;
        const rowH = 86 * px - 0.008;
        const g = new THREE.Group();
        g.position.set(0, cy, 0.005);
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(rowW, rowH),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        );
        face.userData.action = `theme_${t.id}`;
        face.renderOrder = 2;
        g.add(face);
        root.add(g);
        buttons.push({ group: g, mesh: face, action: `theme_${t.id}` });
      });
    } else {
      // 画面2: 個別編集。左上「戻る」+ 下部に ±ボタン5個（Canvas 上端から px で対応）
      const d = settingDefs.find((x) => x.key === detailKey)!;
      addButton("← 戻る", "back", -bodyW / 2 + 0.115, top - 56 * px, 0.16, 0.1);
      const BW = 0.2;
      const BH = 0.11;
      const GAP = 0.035;
      const fifth = d.measure ? `${d.key}_measure` : `${d.key}_reset`;
      const defs: [string, string][] = [
        [d.stepLabels[0], `${d.key}_minusL`],
        [d.stepLabels[1], `${d.key}_minusS`],
        [d.stepLabels[2], `${d.key}_plusS`],
        [d.stepLabels[3], `${d.key}_plusL`],
        [d.resetLabel, fifth],
      ];
      const total = defs.length * BW + (defs.length - 1) * GAP;
      const rowY = top - 380 * px; // 範囲バー（y250〜316）と注記（y466）の間
      defs.forEach(([text, action], i) => {
        addButton(text, action, -total / 2 + BW / 2 + i * (BW + GAP), rowY, BW, BH);
      });
    }

    const sp: SettingsPanel = { root, bodyCanvas: canvas, bodyTex: tex, buttons, mode, detailKey: mode === "detail" ? detailKey ?? null : null, hoverKey: null };
    drawSettingsBody(sp);

    // 頭の正面にアンカー（詳細と同じ向き。床基準でなく目の高さに浮かせる）
    const head = new THREE.Vector3();
    camera.getWorldPosition(head);
    const yaw = player.rotation.y;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    root.position.copy(head).addScaledVector(fwd, SETTINGS_DIST);
    root.position.y = 1.35; // 2026-10-30 2画面化: 一覧 bodyH=0.75 で上端≈1.73/下端≈0.98、編集 bodyH=0.6 で上端≈1.65/下端≈1.05
    root.rotation.y = yaw;
    scene.add(root);
    settings = sp;
  };

  // テーマ切替（THEME_DESIGN.md §5）。サーバ配信テーマ一覧は起動時に取得済みなので同期処理で足りる。
  // pal を再代入 → 部屋/グリッド/チップをその場で再構築（ページリロードなし）。
  const switchTheme = (id: string) => {
    setThemeName(id);
    const spec = id === "plain" ? null : themes.find((t) => t.id === id);
    pal = spec ? buildPalette(spec) : PLAIN_PALETTE;
    scene.remove(roomGroup);
    const roomTex = roomGroup.userData.roomTextures as THREE.Texture[] | undefined;
    if (roomTex) for (const t of roomTex) t.dispose();
    disposeSubtree(roomGroup);
    roomGroup = buildRoom(scene, pal);
    rebuildGrid();
    rebuildChips();
    openSettings("theme"); // 選択中マーカー更新のためテーマ画面を開き直す
  };

  const applySettingsAction = (action: string) => {
    if (action === "back") {
      openSettings("list");
      return;
    }
    if (action === "open_theme") {
      openSettings("theme");
      return;
    }
    if (action.startsWith("theme_")) {
      switchTheme(action.slice(6));
      return;
    }
    if (action.startsWith("open_")) {
      openSettings("detail", action.slice(5));
      return;
    }
    const us = action.indexOf("_");
    const d = us > 0 ? settingDefs.find((x) => x.key === action.slice(0, us)) : undefined;
    if (!d) return;
    const op = action.slice(us + 1);
    if (op === "reset") {
      d.apply(d.resetValue());
    } else if (op === "measure") {
      // 2026-10-26 要望: 「実測」= HMDの床からの高さ（local-floor基準のカメラy）を自動入力
      const v = d.measure?.();
      if (v != null) d.apply(v);
    } else {
      const delta =
        op === "minusL" ? -d.steps[1] :
        op === "minusS" ? -d.steps[0] :
        op === "plusS" ? d.steps[0] :
        op === "plusL" ? d.steps[1] : 0;
      d.apply(d.get() + delta);
    }
    if (settings) drawSettingsBody(settings);
  };

  for (const c of rig.controllers) {
    onControllerEvent(c, "selectstart", () => {
      // 2026-10-26: 設定パネル表示中は ボタン=調整 / 他=閉じる で終了（グリッド選択は通さない）
      if (settings) {
        const btnHit = raycastPanel(raycaster, c, settings.buttons.map((b) => b.mesh));
        if (btnHit) applySettingsAction((btnHit.object as THREE.Mesh).userData.action as string);
        else if (settings.mode === "detail") openSettings("list"); // 2026-10-30: 編集画面の行外トリガー=一覧へ戻る（一覧の行外=閉じるは従来どおり）
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
          openSettings("list");
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
      p.frameMat.color.set(on ? pal.hover : pal.frame);
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
      ch.frameMat.color.set(on || sel ? pal.chipHover : pal.chipFrame); // 非ホバー・非選択は枠をチップ面色（面・ラベル背景と同色）に
      ch.group.scale.setScalar(on ? 1.06 : 1);
    }
    // 2026-10-28: ⚙設定ボタン（ファイル名ラベル下・固定）のホバー枠
    settingsChipFrameMat.color.set(hovered.has(settingsChipMesh) ? pal.settingsChipHover : pal.settingsChipFrame);
    settingsChipGroup.scale.setScalar(hovered.has(settingsChipMesh) ? 1.06 : 1);
    exitChipFrameMat.color.set(hovered.has(exitChipMesh) ? pal.exitChipHover : pal.exitChipFrame);
    exitChipGroup.scale.setScalar(hovered.has(exitChipMesh) ? 1.06 : 1);
    for (const b of settings?.buttons ?? []) {
      if (b.frameMat) b.frameMat.color.set(hovered.has(b.mesh) ? pal.hover : pal.frame);
    }
    // 2026-10-30 一覧行の hover 帯: Canvas 側描画なので、当たった行が変わったフレームだけ再描画
    if (settings && (settings.mode === "list" || settings.mode === "theme")) {
      let hk: string | null = null;
      for (const b of settings.buttons) {
        if (hovered.has(b.mesh)) {
          hk = b.action;
          break;
        }
      }
      if (hk !== settings.hoverKey) {
        settings.hoverKey = hk;
        drawSettingsBody(settings);
      }
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

function buildRoom(scene: THREE.Scene, pal: Palette): THREE.Group {
  // 空間デザイン 2026-10-30: シーンフォグ＋床径向グラデ＋壁垂直グラデ（無限グリッド感の解消）
  // 2026-10-30 テーマ: 全色を pal から導出。背景・フォグもここで設定（テーマ切替で roomGroup を再構築）
  scene.background = new THREE.Color(pal.bg);
  scene.fog = new THREE.FogExp2(new THREE.Color(pal.fog).getHex(), pal.fogDensity);

  const roomGroup = new THREE.Group();
  roomGroup.name = "room";

  // 床: 径向グラデーション（中心=明るい → 外周=背景色）で「無限」感を解消
  const floorCanvas = document.createElement("canvas");
  floorCanvas.width = 512;
  floorCanvas.height = 512;
  const fctx = floorCanvas.getContext("2d")!;
  const fgrad = fctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  fgrad.addColorStop(0, pal.floorCenter);
  fgrad.addColorStop(0.35, pal.floorMid1);
  fgrad.addColorStop(0.7, pal.floorMid2);
  fgrad.addColorStop(1, pal.floorEdge);
  fctx.fillStyle = fgrad;
  fctx.fillRect(0, 0, 512, 512);
  const floorTex = new THREE.CanvasTexture(floorCanvas);
  floorTex.colorSpace = THREE.SRGBColorSpace;

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(R + 3.5, 48),
    new THREE.MeshBasicMaterial({ map: floorTex }),
  );
  floor.rotation.x = -Math.PI / 2;
  roomGroup.add(floor);

  // グリッド: 残すがフォグで距離減衰。線色を明るくして近距離での参照点として機能させる
  const grid = new THREE.GridHelper((R + 3.5) * 2, 28, new THREE.Color(pal.gridMajor).getHex(), new THREE.Color(pal.gridMinor).getHex());
  // 2026-10-28 実機指摘: 床折り曲げストリップ（y=0.002）と同一高さでZ-fightingし、
  // グリッド線が写真ストリップの上に見えた。グリッドを1mm下げてストリップを確実に上に（深度精度はµm規模で1mm差は十分）
  grid.position.y = 0.001;
  roomGroup.add(grid);

  // 壁: 垂直グラデーション（下部=明るい → 上部=背景色）で空間の輪郭を自然に示す
  const wallCanvas = document.createElement("canvas");
  wallCanvas.width = 4;
  wallCanvas.height = 256;
  const wctx = wallCanvas.getContext("2d")!;
  const wgrad = wctx.createLinearGradient(0, 0, 0, 256);
  wgrad.addColorStop(0, pal.wallTop);      // 上部（天井側）→ 背景色に溶ける
  wgrad.addColorStop(0.5, pal.wallMid);
  wgrad.addColorStop(1, pal.wallBottom);   // 下部（床側）→ 壁色（明確に明るい）
  wctx.fillStyle = wgrad;
  wctx.fillRect(0, 0, 4, 256);
  const wallTex = new THREE.CanvasTexture(wallCanvas);
  wallTex.colorSpace = THREE.SRGBColorSpace;

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 3.5, R + 3.5, 4, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide }),
  );
  wall.position.y = 2;
  roomGroup.add(wall);

  // 部屋固有の手続き的テクスチャ（勾配Canvas）。テーマ切替で roomGroup を破棄する際、
  // disposeSubtree は material.map を共有キャッシュと混同して消さないため、ここで保持して switchTheme 側で明示的に dispose する。
  roomGroup.userData.roomTextures = [floorTex, wallTex];

  scene.add(roomGroup);
  return roomGroup;
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

// "#rrggbb" → "rgba(r,g,b,a)"。設定パネルの半透明な行帯など、パレット色にアルファを付ける用途。
function withAlpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// キャンバス→CanvasTexture でテキストパネル（フォント読み込み不要）
// fontWorldH 指定時は Canvas を文字数分の幅に保ったまま、ワールド上のフォント高さだけ固定にする（チップラベル用）
function makeLabel(lines: string[] | string, worldW: number, pal: Palette, fontWorldH?: number): THREE.Mesh {
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
  ctx.fillStyle = pal.labelBg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < arr.length; i++) {
    ctx.fillStyle = i === 0 ? pal.labelText : pal.aux;
    ctx.fillText(arr[i], pad, pad + i * lineH);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const meshW = fontWorldH ? (fontWorldH * canvas.width) / fontPx : worldW;
  const worldH = fontWorldH ? (fontWorldH * canvas.height) / fontPx : (worldW * canvas.height) / canvas.width;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(meshW, worldH),
    // depthWrite:false: テキスト平面が深度を書いて他の透明面（設定本文など）を消す事故を防ぐ（2026-10-30）
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
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
