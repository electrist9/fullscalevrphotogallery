// WebXR 入力: コントローラ（選択レイ・グリップ）と移動（左スティック=スムース移動、右スティック=スナップターン）
// PLAN §6 の xr-input 相当。M1: 歩き回り + レイ選択。
import * as THREE from "three";

export interface ControllerRig {
  controllers: THREE.Group[];
  inputSourceOf(c: THREE.Group): XRInputSource | undefined;
  dispose(): void;
}

export function createControllerRig(renderer: THREE.WebGLRenderer, player: THREE.Group): ControllerRig {
  const controllers: THREE.Group[] = [];
  const grips: THREE.Group[] = [];
  const sources = new Map<THREE.Group, XRInputSource>();
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];

  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const rayMat = new THREE.LineBasicMaterial({ color: 0x9db8ff, transparent: true, opacity: 0.7 });
    owned.push(rayGeo, rayMat);
    const ray = new THREE.Line(rayGeo, rayMat);
    ray.name = "ray";
    ray.scale.z = 5;
    c.add(ray);
    c.addEventListener("connected", (e: { data: XRInputSource }) => sources.set(c, e.data));
    c.addEventListener("disconnected", () => sources.delete(c));
    player.add(c);
    controllers.push(c);

    const grip = renderer.xr.getControllerGrip(i);
    const boxGeo = new THREE.BoxGeometry(0.035, 0.035, 0.11);
    const boxMat = new THREE.MeshBasicMaterial({ color: 0x39404c });
    owned.push(boxGeo, boxMat);
    grip.add(new THREE.Mesh(boxGeo, boxMat));
    player.add(grip);
    grips.push(grip);
  }

  return {
    controllers,
    inputSourceOf: (c) => sources.get(c),
    dispose() {
      for (const c of controllers) player.remove(c);
      for (const g of grips) player.remove(g);
      sources.clear();
      for (const o of owned) o.dispose();
    },
  };
}

const _origin = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _dir = new THREE.Vector3();

// XRコントローライベント（selectstart/squeezestart 等）は Object3DEventMap に含まれないため、
// 文字列キーで受け取る薄いラッパー経由で登録する。
export function onControllerEvent(c: THREE.Group, type: string, fn: (e: any) => void): void {
  (c as unknown as { addEventListener(t: string, l: (e: any) => void): void }).addEventListener(type, fn);
}

// コントローラのレイ（ワールド空間の原点・方向）。raycaster.set にそのまま使える。
export function controllerRay(c: THREE.Group): { origin: THREE.Vector3; dir: THREE.Vector3 } {
  c.getWorldPosition(_origin);
  c.getWorldQuaternion(_quat);
  _dir.set(0, 0, -1).applyQuaternion(_quat);
  return { origin: _origin, dir: _dir };
}

export function setRayLength(c: THREE.Group, len: number): void {
  const ray = c.getObjectByName("ray");
  if (ray) ray.scale.z = Math.max(0.05, len);
}

// 移動: 左スティック=前後左右（カメラの向き基準）、右スティック=45°スナップターン
export class Locomotion {
  snapEnabled = true; // M3: 詳細表示中はスナップターンを無効化（右スティックは画像切替に流用）
  private speed = 1.2;
  private deadzone = 0.18;
  private snapThreshold = 0.7;
  private snapCooldown = 0.45;
  private lastSnap = -1;

  update(dt: number, elapsed: number, camera: THREE.Camera, player: THREE.Group): void {
    // 回転は player グループごと（カメラ/コントローラが追従）
    const stick = this.readRightStick();
    if (this.snapEnabled && stick !== 0 && elapsed - this.lastSnap > this.snapCooldown) {
      player.rotation.y += stick * (Math.PI / 4);
      this.lastSnap = elapsed;
    }
    const mv = this.readLeftStick();
    if (mv.x === 0 && mv.y === 0) return;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) return;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    player.position.addScaledVector(fwd, -mv.y * this.speed * dt); // スティック上（-y）= 前進
    player.position.addScaledVector(right, mv.x * this.speed * dt);
  }

  private leftStick: { x: number; y: number } = { x: 0, y: 0 };
  private rightStickX = 0;
  private rightStickRawX = 0;

  // セッションの inputSources からスティック値を拾う（update の前に setGamepads で供給）
  setGamepads(sources: XRInputSource[] | XRInputSource[]): void {
    this.leftStick = { x: 0, y: 0 };
    this.rightStickX = 0;
    this.rightStickRawX = 0;
    for (const src of sources) {
      const gp = src.gamepad;
      if (!gp || gp.axes.length < 4) continue;
      const ax = gp.axes[2] ?? 0;
      const ay = gp.axes[3] ?? 0;
      if (src.handedness === "left") {
        if (Math.abs(ax) > this.deadzone) this.leftStick.x += ax;
        if (Math.abs(ay) > this.deadzone) this.leftStick.y += ay;
      } else if (src.handedness === "right") {
        if (Math.abs(ax) > this.deadzone) this.rightStickRawX = ax;
        if (Math.abs(ax) > this.snapThreshold) this.rightStickX = ax;
      }
    }
  }

  private readLeftStick() {
    return this.leftStick;
  }
  private readRightStick() {
    return this.rightStickX;
  }
  // 右スティックX（しきい値適用済み、0 or ±1寄り）。詳細表示中の画像切替（M3）用。
  rightStick(): number {
    return this.rightStickX;
  }
  // 右スティックX（デッドゾーンのみ適用、-1..1 の連続値）。ギャラリー1段の連続スクロール（2026-10-28）用。
  rightStickRaw(): number {
    return this.rightStickRawX;
  }
}
