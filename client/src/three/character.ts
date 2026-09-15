import {
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import type { PlayerLook } from '@shared/protocol';
import { getState } from '../state/store';
import { appearanceFor, hairColor, shoeColor, skinColor } from '../utils/appearance';

export type Shading = 'lambert' | 'standard';

/**
 * Tư thế của nhân vật. `run` tự chuyển giữa đứng thở và chạy theo `speed`;
 * các tư thế còn lại do từng minigame chọn (đấm nút, kéo co, ăn mừng…).
 */
export type Pose = 'run' | 'idle' | 'jump' | 'punch' | 'cheer' | 'sad' | 'pull' | 'dance' | 'hit' | 'lock';

export interface CharacterUpdate {
  /** 0 = đứng yên, 1 = chạy hết tốc */
  speed: number;
  dead: boolean;
  time: number;
  pose?: Pose;
  /** đang miễn nhiễm → nhấp nháy */
  safe?: boolean;
  /** đang ôm bom → giơ hai tay lên đầu */
  holder?: boolean;
}

export interface Character3D {
  root: Group;
  update(dt: number, s: CharacterUpdate): void;
  /** quay mặt theo hướng di chuyển (mượt) */
  face(vx: number, vz: number, dt: number): void;
  /** quay mặt ngay về một hướng cố định */
  setYaw(yaw: number): void;
  setShadows(on: boolean): void;
}

export interface CharacterExtra {
  look?: PlayerLook;
  /** đang xếp bét → băng bó + run rẩy */
  hurt?: boolean;
}

export interface CharacterKit {
  /** không truyền `extra` thì ngoại hình + trạng thái hạng bét tự tra theo màu áo trong phòng */
  create(color: string, isMe: boolean, extra?: CharacterExtra): Character3D;
  dispose(): void;
}

const GRAY = new Color('#5d6275');

/**
 * Nhân vật chibi dựng hoàn toàn bằng hình khối bo tròn — 0 byte model tải về.
 * Hình khối dùng chung cho mọi nhân vật; mỗi người chỉ có vật liệu màu riêng.
 */
export function createCharacterKit(shading: Shading): CharacterKit {
  const geos = {
    torso: new CapsuleGeometry(0.27, 0.34, 6, 16),
    head: new SphereGeometry(0.33, 28, 20),
    hairCap: new SphereGeometry(0.35, 26, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
    ear: new SphereGeometry(0.065, 10, 8),
    eye: new SphereGeometry(0.058, 12, 10),
    shine: new SphereGeometry(0.02, 6, 5),
    arc: new TorusGeometry(0.055, 0.013, 6, 14, Math.PI),
    smallArc: new TorusGeometry(0.028, 0.01, 6, 10, Math.PI),
    mouthOpen: new SphereGeometry(0.045, 10, 8),
    pout: new TorusGeometry(0.03, 0.012, 6, 12),
    blush: new SphereGeometry(0.05, 10, 6),
    brow: new BoxGeometry(0.12, 0.025, 0.02),
    dot: new SphereGeometry(0.012, 5, 4),
    mustache: new CapsuleGeometry(0.02, 0.08, 3, 6),
    arm: new CapsuleGeometry(0.07, 0.24, 4, 10),
    hand: new SphereGeometry(0.075, 12, 10),
    leg: new CapsuleGeometry(0.09, 0.2, 4, 10),
    shoe: new SphereGeometry(0.11, 14, 10),
    blob: new CircleGeometry(0.42, 18),
    marker: new ConeGeometry(0.13, 0.26, 8),
    // tóc
    spike: new ConeGeometry(0.1, 0.28, 8),
    fringe: new BoxGeometry(0.34, 0.1, 0.12),
    curl: new SphereGeometry(0.11, 12, 10),
    lock: new CapsuleGeometry(0.085, 0.38, 4, 10),
    backLong: new BoxGeometry(0.62, 0.62, 0.2),
    bun: new SphereGeometry(0.15, 14, 12),
    braid: new SphereGeometry(0.08, 10, 8),
    // trang phục
    skirt: new CylinderGeometry(0.22, 0.44, 0.36, 22, 1, true),
    hood: new TorusGeometry(0.2, 0.07, 10, 20),
    pocket: new BoxGeometry(0.26, 0.12, 0.05),
    inner: new BoxGeometry(0.14, 0.4, 0.05),
    tie: new BoxGeometry(0.06, 0.26, 0.04),
    collar: new ConeGeometry(0.06, 0.1, 3),
    // kính
    lens: new TorusGeometry(0.085, 0.017, 6, 16),
    shade: new BoxGeometry(0.15, 0.08, 0.03),
    bridge: new BoxGeometry(0.06, 0.015, 0.015),
    // đội đầu
    brim: new BoxGeometry(0.38, 0.035, 0.28),
    band: new TorusGeometry(0.34, 0.05, 8, 26),
    pom: new SphereGeometry(0.085, 12, 10),
    crown: new CylinderGeometry(0.21, 0.24, 0.16, 8, 1, true),
    crownTip: new ConeGeometry(0.045, 0.1, 4),
    bow: new ConeGeometry(0.08, 0.16, 6),
    catEar: new ConeGeometry(0.1, 0.22, 4),
    catInner: new ConeGeometry(0.055, 0.14, 4),
    phoneBand: new TorusGeometry(0.37, 0.035, 6, 18, Math.PI),
    cup: new CylinderGeometry(0.1, 0.1, 0.08, 14),
    horn: new ConeGeometry(0.06, 0.24, 8),
    petal: new SphereGeometry(0.05, 8, 6),
    halo: new TorusGeometry(0.2, 0.025, 8, 32),
    // băng bó của người xếp bét
    bandage: new TorusGeometry(0.335, 0.05, 8, 24),
    wrap: new CylinderGeometry(0.09, 0.09, 0.09, 10),
  };

  const owned: Material[] = [];
  const textures: Texture[] = [];
  const lit = (color: Color | string, map?: Texture) => {
    const params = { color, map: map ?? null };
    const m = shading === 'lambert' ? new MeshLambertMaterial(params) : new MeshStandardMaterial({ ...params, roughness: 0.7, metalness: 0.02 });
    owned.push(m);
    return m;
  };
  const basic = (params: ConstructorParameters<typeof MeshBasicMaterial>[0]) => {
    const m = new MeshBasicMaterial(params);
    owned.push(m);
    return m;
  };
  const cached = new Map<string, Material>();
  const litCached = (hex: string) => {
    let m = cached.get(hex);
    if (!m) {
      m = lit(hex);
      cached.set(hex, m);
    }
    return m;
  };
  /** áo sọc: texture vẽ bằng canvas theo màu áo */
  const stripeTexture = (hex: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 64;
    const g = canvas.getContext('2d')!;
    g.fillStyle = hex;
    g.fillRect(0, 0, 16, 64);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (let y = 4; y < 64; y += 16) g.fillRect(0, y, 16, 6);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    textures.push(tex);
    return tex;
  };

  const eyeMat = basic({ color: '#1d1728' });
  const shineMat = basic({ color: '#ffffff' });
  const blushMat = basic({ color: '#ff8fa3', transparent: true, opacity: 0.5, depthWrite: false });
  const lipMat = basic({ color: '#b8435a' });
  const tongueMat = litCached('#ff7b95');
  const freckleMat = basic({ color: '#b0724a' });
  const blobMat = basic({ color: '#000000', transparent: true, opacity: 0.32, depthWrite: false });
  const markerMat = basic({ color: '#ffd166' });
  const pantsMat = litCached('#2e3352');
  const whiteMat = litCached('#f4f4f8');
  const navyMat = litCached('#2b2f55');
  const gold = lit('#ffd166');
  gold.side = DoubleSide;
  const haloMat = basic({ color: '#ffe08a' });
  const pink = litCached('#ff6bd6');
  const petalMat = litCached('#ff8fc7');
  const innerEar = litCached('#ffb3c7');
  const red = litCached('#ff4d4d');
  const cupMat = litCached('#ff5c7a');
  const bandageMat = litCached('#f6f1e4');
  const pomMat = litCached('#f7f5f0');

  return {
    create(color, isMe, extra) {
      const found = appearanceFor(getState().room, color);
      const look = extra?.look ?? found.look;
      const hurt = extra?.hurt ?? found.hurt;
      const female = look.gender === 1;
      const dress = look.outfit === 5;

      const base = new Color(color);
      const bodyMat = look.outfit === 1 ? lit('#ffffff', stripeTexture(color)) : lit(base.clone());
      if (dress) bodyMat.side = DoubleSide;
      const darkMat = lit(base.clone().multiplyScalar(0.6));
      const sleeveMat = lit(base.clone().multiplyScalar(0.88));
      const hc = hairColor(look);
      const hairMat = hc ? litCached(hc) : lit(base.clone().multiplyScalar(0.52));
      const skinMat = litCached(skinColor(look));
      const legMat = dress ? skinMat : pantsMat;
      const shoeMat = litCached(shoeColor(look));

      const root = new Group();
      const blob = new Mesh(geos.blob, blobMat);
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.012;
      root.add(blob);

      const rig = new Group();
      root.add(rig);

      const casters: Mesh[] = [];
      const add = (parent: Object3D, geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0, cast = true) => {
        const m = new Mesh(geo, mat);
        m.position.set(x, y, z);
        parent.add(m);
        if (cast) casters.push(m);
        return m;
      };
      // chi tiết nhỏ trên mặt không cần đổ bóng
      const deco = (parent: Object3D, geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0) => add(parent, geo, mat, x, y, z, false);

      const torso = add(rig, geos.torso, bodyMat, 0, 0.86, 0);
      if (female) torso.scale.set(0.94, 1, 0.92);
      const head = add(rig, geos.head, skinMat, 0, 1.4, 0);

      /* ---------------- khuôn mặt ---------------- */
      const Z = 0.3;
      const longHair = female && (look.hair === 0 || look.hair === 4);
      if (!longHair) for (const side of [-1, 1]) add(head, geos.ear, skinMat, side * 0.325, -0.02, 0);

      for (const side of [-1, 1]) {
        const eye = deco(head, geos.eye, eyeMat, 0.115 * side, 0.02, Z);
        eye.scale.set(1, 1.25, 0.6);
        const shine = deco(eye, geos.shine, shineMat, 0.022, 0.03, 0.05);
        switch (look.eyes) {
          case 1:
            eye.scale.set(1.35, 1.6, 0.6);
            break;
          case 2: {
            eye.visible = false;
            deco(head, geos.arc, eyeMat, 0.115 * side, 0.0, Z + 0.01);
            break;
          }
          case 3:
            eye.scale.set(1.2, 0.45, 0.6);
            shine.visible = false;
            break;
          case 4:
            eye.scale.set(1.35, 0.95, 0.6);
            eye.rotation.z = -side * 0.35;
            break;
          case 5: {
            eye.scale.set(0.8, 0.85, 0.6);
            const brow = deco(head, geos.brow, eyeMat, 0.11 * side, 0.13, Z - 0.005);
            brow.rotation.z = side * 0.45;
            break;
          }
        }
      }
      if (female || look.face === 1) {
        for (const side of [-1, 1]) deco(head, geos.blush, blushMat, 0.19 * side, -0.08, 0.255).scale.set(1.3, 0.7, 0.4);
      }

      const mouthY = -0.12;
      const mouthZ = 0.305;
      switch (look.mouth) {
        case 1:
          deco(head, geos.mouthOpen, eyeMat, 0, mouthY, mouthZ).scale.set(1.3, 0.9, 0.5);
          deco(head, geos.blush, tongueMat, 0, mouthY - 0.02, mouthZ + 0.015).scale.set(0.7, 0.5, 0.4);
          break;
        case 2:
          for (const s of [-1, 1]) deco(head, geos.smallArc, eyeMat, 0.027 * s, mouthY, mouthZ).rotation.z = Math.PI;
          break;
        case 3:
          deco(head, geos.arc, female ? lipMat : eyeMat, 0, mouthY + 0.02, mouthZ).rotation.z = Math.PI;
          deco(head, geos.blush, tongueMat, 0.02, mouthY - 0.04, mouthZ).scale.set(0.6, 0.8, 0.4);
          break;
        case 4:
          deco(head, geos.pout, lipMat, 0, mouthY, mouthZ);
          break;
        default:
          deco(head, geos.arc, female ? lipMat : eyeMat, 0, mouthY + 0.02, mouthZ).rotation.z = Math.PI;
      }

      switch (look.face) {
        case 2:
          for (const side of [-1, 1]) {
            for (const [dx, dy] of [
              [0, 0],
              [0.035, -0.02],
              [-0.03, -0.03],
            ]) {
              deco(head, geos.dot, freckleMat, side * (0.19 + dx), -0.04 + dy, 0.26);
            }
          }
          break;
        case 3:
          deco(head, geos.dot, eyeMat, 0.14, -0.16, 0.28).scale.setScalar(1.4);
          break;
        case 4:
          for (const s of [-1, 1]) deco(head, geos.mustache, hairMat, 0.05 * s, -0.085, 0.312).rotation.z = s * 1.2;
          break;
        case 5:
          deco(head, geos.blush, gold, 0.2, -0.09, 0.26).scale.set(0.7, 0.7, 0.3);
          break;
      }

      /* ---------------- tóc ---------------- */
      const cap = () => {
        const h = add(head, geos.hairCap, hairMat, 0, 0.035, -0.03);
        h.rotation.x = -0.35;
        return h;
      };
      if (female) {
        cap();
        switch (look.hair) {
          case 1:
            add(head, geos.bun, hairMat, 0, 0.12, -0.33).scale.setScalar(0.8);
            add(head, geos.lock, hairMat, 0, -0.14, -0.42).rotation.x = 0.5;
            break;
          case 2:
            for (const side of [-1, 1]) {
              [-0.1, -0.24, -0.37].forEach((y, i) => {
                add(head, geos.braid, hairMat, 0.32 * side, y, 0.02).scale.setScalar(1 - i * 0.12);
              });
            }
            break;
          case 3:
            add(head, geos.bun, hairMat, 0, 0.37, -0.05);
            break;
          case 4: {
            cap().scale.setScalar(1.07);
            add(head, geos.backLong, hairMat, 0, -0.07, -0.17).scale.set(1, 0.55, 1);
            break;
          }
          case 5:
            for (const side of [-1, 1]) add(head, geos.bun, hairMat, 0.22 * side, 0.3, -0.04).scale.setScalar(0.8);
            break;
          default:
            add(head, geos.backLong, hairMat, 0, -0.24, -0.18);
            for (const side of [-1, 1]) add(head, geos.lock, hairMat, 0.29 * side, -0.2, 0.06);
        }
      } else {
        switch (look.hair) {
          case 1:
            cap();
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              const spike = add(head, geos.spike, hairMat, Math.cos(a) * 0.19, 0.3, Math.sin(a) * 0.19 - 0.04);
              spike.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
            }
            break;
          case 2: {
            cap();
            const f = add(head, geos.fringe, hairMat, -0.07, 0.2, 0.25);
            f.rotation.set(-0.5, 0, 0.45);
            break;
          }
          case 3:
            cap();
            for (let i = 0; i < 9; i++) {
              const a = (i / 9) * Math.PI * 2;
              add(head, geos.curl, hairMat, Math.cos(a) * 0.22, 0.24, Math.sin(a) * 0.22 - 0.04);
            }
            add(head, geos.curl, hairMat, 0, 0.36, -0.02);
            break;
          case 4:
            cap().scale.set(0.88, 1.14, 0.95);
            break;
          case 5:
            break;
          default:
            cap();
        }
      }

      /* ---------------- trang phục ---------------- */
      switch (look.outfit) {
        case 2: {
          add(rig, geos.hood, darkMat, 0, 1.17, -0.05).rotation.x = Math.PI / 2;
          add(rig, geos.pocket, darkMat, 0, 0.72, 0.265);
          break;
        }
        case 3:
          add(rig, geos.inner, whiteMat, 0, 0.9, 0.262);
          break;
        case 4:
          add(rig, geos.tie, navyMat, 0, 0.9, 0.275);
          for (const s of [-1, 1]) add(rig, geos.collar, whiteMat, 0.06 * s, 1.1, 0.23).rotation.set(Math.PI / 2, 0, s * 0.6);
          break;
        case 5:
          add(rig, geos.skirt, bodyMat, 0, 0.6, 0);
          break;
      }

      /* ---------------- kính ---------------- */
      for (const side of [-1, 1]) {
        if (look.glasses === 1) deco(head, geos.lens, eyeMat, 0.115 * side, 0.02, Z + 0.02);
        if (look.glasses === 2) deco(head, geos.shade, eyeMat, 0.115 * side, 0.02, Z + 0.03);
        if (look.glasses === 3) deco(head, geos.blush, cupMat, 0.115 * side, 0.02, Z + 0.03).scale.set(1.5, 1.3, 0.4);
      }
      if (look.glasses === 2) deco(head, geos.bridge, eyeMat, 0, 0.04, Z + 0.035);

      /* ---------------- đội đầu ---------------- */
      let halo: Mesh | null = null;
      switch (look.hat) {
        case 1:
          add(head, geos.hairCap, darkMat, 0, 0.05, 0).scale.setScalar(1.08);
          add(head, geos.brim, darkMat, 0, 0.12, 0.28);
          break;
        case 2:
          add(head, geos.hairCap, darkMat, 0, 0.06, 0).scale.set(1.1, 1.08, 1.1);
          add(head, geos.band, sleeveMat, 0, 0.12, 0).rotation.x = Math.PI / 2;
          add(head, geos.pom, pomMat, 0, 0.47, 0);
          break;
        case 3:
          add(head, geos.crown, gold, 0, 0.36, 0);
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            add(head, geos.crownTip, gold, Math.cos(a) * 0.225, 0.47, Math.sin(a) * 0.225);
          }
          break;
        case 4:
          add(head, geos.bow, pink, 0.13, 0.32, 0.06).rotation.z = -Math.PI / 2;
          add(head, geos.bow, pink, 0.29, 0.32, 0.06).rotation.z = Math.PI / 2;
          break;
        case 5:
          for (const side of [-1, 1]) {
            add(head, geos.catEar, hairMat, 0.2 * side, 0.34, 0).rotation.z = -side * 0.35;
            deco(head, geos.catInner, innerEar, 0.2 * side, 0.33, 0.04).rotation.z = -side * 0.35;
          }
          break;
        case 6:
          add(head, geos.phoneBand, navyMat, 0, 0.02, 0);
          for (const side of [-1, 1]) add(head, geos.cup, cupMat, side * 0.36, 0, 0).rotation.z = Math.PI / 2;
          break;
        case 7:
          for (const side of [-1, 1]) add(head, geos.horn, red, side * 0.16, 0.33, 0.05).rotation.z = -side * 0.45;
          break;
        case 8:
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            deco(head, geos.petal, petalMat, 0.23 + Math.cos(a) * 0.05, 0.22 + Math.sin(a) * 0.05, 0.18);
          }
          deco(head, geos.dot, gold, 0.23, 0.22, 0.21).scale.setScalar(3);
          break;
        case 9:
          halo = deco(head, geos.halo, haloMat, 0, 0.62, 0);
          halo.rotation.x = Math.PI / 2;
          break;
      }

      /* ---------------- tay chân (xoay quanh khớp vai/hông) ---------------- */
      const limb = (geo: BufferGeometry, mat: Material, x: number, y: number, offset: number) => {
        const pivot = new Group();
        pivot.position.set(x, y, 0);
        rig.add(pivot);
        return { pivot, mesh: add(pivot, geo, mat, 0, offset, 0) };
      };
      const armL = limb(geos.arm, sleeveMat, 0.34, 1.07, -0.16);
      const armR = limb(geos.arm, sleeveMat, -0.34, 1.07, -0.16);
      for (const a of [armL, armR]) add(a.pivot, geos.hand, skinMat, 0, -0.35, 0);
      const legL = limb(geos.leg, legMat, 0.13, 0.43, -0.17);
      const legR = limb(geos.leg, legMat, -0.13, 0.43, -0.17);
      for (const l of [legL, legR]) add(l.pivot, geos.shoe, shoeMat, 0, -0.38, 0.04).scale.set(0.95, 0.55, 1.35);

      /* ---------------- xếp bét: băng bó ---------------- */
      if (hurt) {
        add(head, geos.bandage, bandageMat, 0, 0.1, 0).rotation.x = Math.PI / 2 - 0.25;
        add(armL.mesh, geos.wrap, bandageMat, 0, 0.02, 0);
        add(legR.mesh, geos.wrap, bandageMat, 0, -0.04, 0).scale.set(1.2, 1, 1.2);
      }

      let marker: Mesh | null = null;
      if (isMe) {
        marker = new Mesh(geos.marker, markerMat);
        marker.rotation.x = Math.PI; // mũi nhọn chỉ xuống đầu mình
        marker.position.y = 2.5;
        root.add(marker);
      }

      let phase = Math.random() * 6;
      let yaw = 0;
      let fall = 0;

      const approach = (current: number, target: number, k: number) => current + (target - current) * k;

      return {
        root,

        face(vx, vz, dt) {
          if (Math.hypot(vx, vz) < 0.2) return;
          const target = Math.atan2(vx, vz);
          const diff = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw)); // quay đường ngắn nhất
          yaw += diff * (1 - Math.exp(-dt * 14));
          root.rotation.y = yaw;
        },

        setYaw(angle) {
          yaw = angle;
          root.rotation.y = angle;
        },

        update(dt, s) {
          const t = s.time;
          const k = 1 - Math.exp(-dt * 10);
          const smooth = 1 - Math.exp(-dt * 20);
          fall += ((s.dead ? 1 : 0) - fall) * k;
          if (s.dead) bodyMat.color.lerp(GRAY, k * 0.5);

          const speed = s.speed;
          phase += dt * (5 + 9 * speed);
          const pose: Pose = s.dead ? 'idle' : (s.pose ?? 'run');

          // mặc định là chạy (hoặc đứng thở khi speed = 0)
          const swing = Math.sin(phase) * 0.9 * speed;
          let aL = -swing * 0.85;
          let aR = swing * 0.85;
          let lL = swing;
          let lR = -swing;
          let lift = Math.abs(Math.sin(phase)) * 0.07 * speed + (1 - speed) * Math.sin(t * 2.2) * 0.012;
          let lean = speed * 0.16;
          let sway = 0;
          let headX = 0;

          switch (pose) {
            case 'idle':
              aL = aR = lL = lR = 0;
              lift = Math.sin(t * 2.2) * 0.012;
              lean = 0;
              break;
            case 'jump':
              lL = -1.05;
              lR = 0.55;
              aL = aR = -2.5;
              lean = -0.08;
              lift = 0;
              break;
            case 'punch': {
              const p = Math.sin(t * 26);
              aR = p > 0 ? -1.6 : -0.25;
              aL = p > 0 ? -0.25 : -1.6;
              lL = 0.25;
              lR = -0.25;
              lean = 0.14;
              lift = Math.abs(p) * 0.03;
              break;
            }
            case 'cheer':
              aL = -2.75 + Math.sin(t * 10) * 0.25;
              aR = -2.75 - Math.sin(t * 10) * 0.25;
              lL = lR = 0;
              lift = Math.abs(Math.sin(t * 7)) * 0.3;
              lean = 0;
              break;
            case 'sad':
              aL = aR = 0.12;
              lL = lR = 0;
              headX = 0.5;
              lean = 0.25;
              lift = 0;
              break;
            case 'pull':
              // ngả người ra sau, hai tay nắm dây phía trước, chân trụ
              aL = aR = -1.35;
              lL = -0.6;
              lR = 0.4;
              lean = -0.5 + Math.sin(t * 16) * 0.05 * speed;
              lift = 0;
              break;
            case 'dance': {
              const d = Math.sin(t * 6);
              aL = -1.6 + d * 1.1;
              aR = -1.6 - d * 1.1;
              lL = d * 0.35;
              lR = -d * 0.35;
              sway = d * 0.18;
              lift = Math.abs(d) * 0.12;
              lean = 0;
              break;
            }
            case 'hit':
              aL = aR = -0.9;
              lL = lR = 0;
              sway = Math.sin(t * 22) * 0.28;
              headX = -0.25;
              lean = -0.1;
              lift = 0;
              break;
            case 'lock':
              // giơ một tay lên "chốt"
              aL = -2.9;
              aR = -0.15;
              lL = lR = 0;
              lift = Math.abs(Math.sin(t * 9)) * 0.07;
              lean = 0;
              break;
          }

          if (s.holder && !s.dead) {
            aL = -2.55 + Math.sin(t * 9) * 0.12;
            aR = -2.55 - Math.sin(t * 9) * 0.12;
          }

          const alive = 1 - fall;
          // chạy phải bám đúng nhịp bước; các tư thế khác thì chuyển mượt
          const ease = pose === 'run' ? 1 : smooth;
          armL.pivot.rotation.x = approach(armL.pivot.rotation.x, aL * alive, ease);
          armR.pivot.rotation.x = approach(armR.pivot.rotation.x, aR * alive, ease);
          legL.pivot.rotation.x = approach(legL.pivot.rotation.x, lL * alive, ease);
          legR.pivot.rotation.x = approach(legR.pivot.rotation.x, lR * alive, ease);
          head.rotation.x = approach(head.rotation.x, headX * alive, smooth);

          // xếp bét: tay chân run bần bật (xoay chính khúc tay/chân nên không lẫn vào tư thế)
          if (hurt && !s.dead) {
            armL.mesh.rotation.z = Math.sin(t * 47) * 0.22;
            armR.mesh.rotation.z = Math.sin(t * 53 + 1.3) * 0.22;
            legL.mesh.rotation.z = Math.sin(t * 43 + 0.7) * 0.12;
            legR.mesh.rotation.z = Math.sin(t * 57 + 2.1) * 0.12;
            head.rotation.z = Math.sin(t * 31) * 0.06;
          }
          if (halo) halo.position.y = 0.62 + Math.sin(t * 3) * 0.03;

          rig.position.y = lift * alive + fall * 0.28;
          rig.rotation.x = approach(rig.rotation.x, lean * alive, ease);
          // chết thì ngã SANG NGANG: camera nhìn chéo từ phía trước, ngã ngửa sẽ bị dẹt hình trông như vẫn đứng
          rig.rotation.z = fall * 1.45 + sway * alive;

          root.visible = s.safe ? Math.floor(t * 14) % 2 === 0 : true;
          if (marker) {
            marker.position.y = 2.5 + Math.sin(t * 4) * 0.07;
            marker.visible = !s.dead;
          }
        },

        setShadows(on) {
          for (const m of casters) m.castShadow = on;
          blob.visible = !on;
        },
      };
    },

    dispose() {
      for (const g of Object.values(geos)) g.dispose();
      for (const m of owned) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
