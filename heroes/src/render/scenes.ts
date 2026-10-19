// Cảnh 3D của hub (tiểu cảnh đảo nổi) và khung xem chi tiết tướng (xoay được).
import * as THREE from 'three';
import type { Rarity } from '@shared/heroes/types';
import { createHeroModel, type HeroAnim, type HeroModel } from './hero-model';
import { brightLights, makeBlob, type LiveScene } from './live';
import { currentPreset } from './quality';
import { RARITY_GLOW } from './portraits';

const lambert = (c: number | string) => new THREE.MeshLambertMaterial({ color: c });

/* ------------------------------ HUB ------------------------------ */
export interface HubScene extends LiveScene {
  /** -1..1 theo con trỏ để camera lắc nhẹ */
  look(nx: number, ny: number): void;
}

export function createHubScene(squadIds: string[]): HubScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  brightLights(scene);
  const owned: { dispose(): void }[] = [];
  const mat = (c: number | string) => {
    const m = lambert(c);
    owned.push(m);
    return m;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T) => {
    owned.push(g);
    return g;
  };

  const island = new THREE.Group();
  scene.add(island);
  // mặt cỏ + thân đất
  const top = new THREE.Mesh(geo(new THREE.CylinderGeometry(3.4, 3.2, 0.5, 28)), mat(0x7fd45a));
  top.position.y = -0.25;
  island.add(top);
  const dirt = new THREE.Mesh(geo(new THREE.CylinderGeometry(3.2, 0.5, 2.6, 20)), mat(0xa9743f));
  dirt.position.y = -1.8;
  island.add(dirt);
  const path = new THREE.Mesh(geo(new THREE.CircleGeometry(1.7, 24).rotateX(-Math.PI / 2)), mat(0xe6cf8a));
  path.position.y = 0.012;
  island.add(path);
  // cây
  const tree = (x: number, z: number, s: number) => {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.1, 0.14, 0.5, 8)), mat(0x8a5a2b));
    trunk.position.y = 0.25;
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(geo(new THREE.ConeGeometry(0.55 - i * 0.12, 0.6, 9)), mat(i % 2 ? 0x3fae4a : 0x4fc257));
      c.position.y = 0.7 + i * 0.4;
      g.add(c);
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    island.add(g);
  };
  tree(-2.6, -0.8, 1.1);
  tree(2.5, -1.2, 1.3);
  tree(-2.0, -2.0, 0.9);
  tree(2.2, 0.9, 0.8);
  // lều nhỏ
  const hut = new THREE.Group();
  const walls = new THREE.Mesh(geo(new THREE.BoxGeometry(0.9, 0.6, 0.8)), mat(0xf4e3b8));
  walls.position.y = 0.3;
  const roof = new THREE.Mesh(geo(new THREE.ConeGeometry(0.75, 0.55, 4)), mat(0xe2583e));
  roof.position.y = 0.88;
  roof.rotation.y = Math.PI / 4;
  hut.add(walls, roof);
  hut.position.set(-1.0, 0, -2.4);
  island.add(hut);
  // cờ
  const pole = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6)), mat(0x6b4a2a));
  pole.position.set(1.4, 0.7, -2.2);
  const flag = new THREE.Mesh(geo(new THREE.BoxGeometry(0.5, 0.3, 0.02)), mat(0xffb020));
  flag.position.set(1.65, 1.2, -2.2);
  island.add(pole, flag);

  // mây trôi
  const clouds: THREE.Group[] = [];
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  owned.push(cloudMat);
  const cloudGeo = geo(new THREE.SphereGeometry(1, 10, 8));
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const m = new THREE.Mesh(cloudGeo, cloudMat);
      m.position.set(j * 0.7 - 1, Math.sin(j * 1.7) * 0.18, 0);
      m.scale.set(0.6 + (j % 2) * 0.25, 0.38, 0.4);
      g.add(m);
    }
    g.position.set(-9 + i * 3.6, -1.2 + (i % 3) * 1.6, -5 - (i % 2) * 3);
    g.userData.v = 0.15 + (i % 3) * 0.08;
    scene.add(g);
    clouds.push(g);
  }

  // tướng đứng đón (thủ lĩnh = tướng đầu tiên của đội)
  const models: { m: HeroModel; timer: number }[] = [];
  const spots: [number, number, number, number][] = [
    [0, 0.5, 1.35, 0],
    [-1.8, -0.1, 1, 0.25],
    [1.8, -0.1, 1, -0.25],
    [-0.95, -1.2, 0.95, 0.12],
    [0.95, -1.2, 0.95, -0.12],
  ];
  // vị trí x gốc của từng tướng: màn dọc ép hẹp lại để cụm tướng to hơn mà không bị cắt hai bên
  const spread: { o: THREE.Object3D; b: THREE.Object3D; x: number }[] = [];
  const ids = squadIds.length ? squadIds : [];
  ids.slice(0, spots.length).forEach((id, i) => {
    const m = createHeroModel(id, { outlines: currentPreset().outlines });
    const [x, z, s, ry] = spots[i];
    m.object3d.position.set(x, 0, z);
    m.object3d.scale.multiplyScalar(s);
    m.object3d.rotation.y = ry;
    island.add(m.object3d);
    const b = makeBlob(1.5 * s);
    b.position.set(x, 0.03, z);
    island.add(b);
    models.push({ m, timer: 2 + i * 1.3 + Math.random() * 3 });
    spread.push({ o: m.object3d, b, x });
  });

  let lx = 0, ly = 0, cx = 0, cy = 0;
  let baseZ = 7.4, baseY = 3.1, aimY = 0.7;
  const hs: HubScene = {
    scene, camera,
    look(nx, ny) {
      lx = nx;
      ly = ny;
    },
    resize(w, h) {
      // khung hình theo tỉ lệ: dọc (điện thoại) = cụm tướng to, thấp, ép hẹp; ngang/PC = rộng hơn, co theo chiều CAO màn hình
      const a = w / Math.max(1, h);
      const t = Math.min(1, Math.max(0, (a - 0.5) / 0.5)); // 0 = dọc hẹp, 1 = vuông trở lên
      const k = 0.72 + 0.28 * t;
      for (const e of spread) {
        e.o.position.x = e.x * k;
        e.b.position.x = e.x * k;
      }
      const halfW = 2.25 + 0.9 * t; // nửa bề ngang cần thấy ở trục tướng
      baseZ = Math.max(7.4, halfW / (a * Math.tan((34 / 2) * (Math.PI / 180))));
      baseY = 3.1 + (1 - t) * 2.0; // dọc: nhìn từ cao hơn để thấy đảo
      aimY = 0.7 + (1 - t) * 1.1; // dọc: ngắm cao hơn một chút => cụm tướng hơi thấp, vẫn nằm trên thẻ CHIẾN
    },
    update(dt, t) {
      island.position.y = Math.sin(t * 0.9) * 0.12;
      island.rotation.y = Math.sin(t * 0.25) * 0.06;
      island.rotation.z = Math.sin(t * 0.7) * 0.012;
      for (const c of clouds) {
        c.position.x += (c.userData.v as number) * dt;
        if (c.position.x > 11) c.position.x = -11;
      }
      for (const e of models) {
        e.m.update(dt);
        e.timer -= dt;
        if (e.timer <= 0) {
          const kinds: HeroAnim[] = ['attack', 'cast'];
          e.m.play(kinds[Math.floor(Math.random() * kinds.length)]);
          e.timer = 4 + Math.random() * 5;
        }
      }
      cx += (lx - cx) * Math.min(1, dt * 3);
      cy += (ly - cy) * Math.min(1, dt * 3);
      camera.position.set(cx * 1.2, baseY - cy * 0.5, baseZ);
      camera.lookAt(0, aimY, 0);
      flag.rotation.y = Math.sin(t * 3) * 0.2;
    },
    dispose() {
      for (const e of models) e.m.dispose();
      for (const o of owned) o.dispose();
    },
  };
  return hs;
}

/* ------------------------------ CHI TIẾT TƯỚNG ------------------------------ */
export interface DetailScene extends LiveScene {
  setHero(id: string, rarity: Rarity): void;
  /** kéo để xoay */
  drag(dx: number): void;
  dragging(on: boolean): void;
  /** chạm: tướng diễn một chiêu */
  poke(): void;
}

export function createDetailScene(): DetailScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  brightLights(scene);
  const group = new THREE.Group();
  scene.add(group);
  const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const discGeo = new THREE.CylinderGeometry(0.95, 1.05, 0.12, 30);
  const ringGeo = new THREE.TorusGeometry(1.0, 0.04, 6, 36).rotateX(Math.PI / 2);
  const pedMat = lambert(0x6f7fa8);
  const ped = new THREE.Mesh(discGeo, pedMat);
  ped.position.y = -0.06;
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.01;
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 28).rotateX(-Math.PI / 2), discMat);
  glow.position.y = 0.02;
  group.add(ped, ring, glow);

  let model: HeroModel | null = null;
  // nhân vật đứng yên nhìn hơi nghiêng về camera; thay vì xoay thì liên tục diễn hoạt hình dùng kỹ năng
  const YAW = 0.35;
  const loop: HeroAnim[] = ['cast', 'attack', 'cast'];
  let step = 0;
  let timer = 2.4;
  let aspect = 1;
  const place = () => {
    // khung hẹp (dọc) thì lùi camera cho vừa cả người
    const fit = Math.max(1, 0.8 / Math.max(0.35, aspect));
    camera.position.set(0, 1.35, 5.4 * fit);
    camera.lookAt(0, 0.78, 0);
  };
  place();

  const ds: DetailScene = {
    scene, camera,
    setHero(id, rarity) {
      if (model) {
        group.remove(model.object3d);
        model.dispose();
      }
      model = createHeroModel(id, { outlines: currentPreset().outlines });
      group.add(model.object3d);
      const c = RARITY_GLOW[rarity];
      discMat.color.setHex(c);
      ringMat.color.setHex(c);
      model.play('cast');
    },
    drag() {
      /* không xoay nhân vật */
    },
    dragging() {},
    poke() {
      // chạm vào nhân vật: diễn kỹ năng ngay
      model?.play('cast');
      timer = 2.4;
    },
    resize(w, h) {
      aspect = w / h;
      place();
    },
    update(dt) {
      group.rotation.y = YAW;
      if (model) {
        model.update(dt);
        timer -= dt;
        if (timer <= 0) {
          timer = 2.4;
          step = (step + 1) % loop.length;
          model.play(loop[step]);
        }
      }
    },
    dispose() {
      model?.dispose();
      discMat.dispose();
      ringMat.dispose();
      discGeo.dispose();
      ringGeo.dispose();
      pedMat.dispose();
      glow.geometry.dispose();
    },
  };
  return ds;
}
