import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { CoconutGameState } from '../games/coconut/useCoconutGame';

export interface CoconutSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => CoconutGameState;
  labels: Map<string, HTMLElement | null>;
}

const TRUNK_H = 6.4;
const CLIMB_BASE = 0.35;
const CLIMB_TOP = TRUNK_H - 0.5;
const PILE_MAX = 14;
const PITCH = (7 * Math.PI) / 180;

interface Falling {
  mesh: Mesh;
  vy: number;
  x: number;
}

export function createCoconutScene(o: CoconutSceneOptions) {
  // ban ngày ở xứ dừa: trời xanh, sương mù cùng màu trời
  return runScene(o.host, o.hooks, { background: '#8fd3ff', fog: [30, 90], sun: [-6, 18, 12], shadowBox: 18 }, (k) => {
    const { scene } = k.engine;
    const n = Math.max(1, o.players.length);
    const spacing = Math.min(3, Math.max(1.7, 26 / n));
    const halfW = ((n - 1) * spacing) / 2 + 2.2;
    const treeX = (i: number) => (i - (n - 1) / 2) * spacing;

    /* ---------------- đất cỏ + dòng sông phía sau ---------------- */
    const grassTex = k.texture(256, 256, (g, w, h) => {
      g.fillStyle = '#4caf50';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) {
        g.fillStyle = `rgba(${30 + Math.random() * 40},${120 + Math.random() * 70},${40 + Math.random() * 30},0.5)`;
        g.fillRect(Math.random() * w, Math.random() * h, 3, 6);
      }
    });
    grassTex.wrapS = grassTex.wrapT = RepeatWrapping;
    grassTex.repeat.set(10, 4);
    const grass = new Mesh(new PlaneGeometry(halfW * 2 + 40, 16), k.lit({ map: grassTex }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, 0, 2);
    grass.receiveShadow = true;
    scene.add(grass);

    const riverMat = new MeshBasicMaterial({ color: '#3fa7d6' });
    const river = new Mesh(new PlaneGeometry(halfW * 2 + 80, 14), riverMat);
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, -0.04, -12);
    scene.add(river);
    const bank = new Mesh(new PlaneGeometry(halfW * 2 + 80, 4), k.lit({ color: '#8b6b3e' }));
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(0, -0.02, -5.2);
    scene.add(bank);

    // dãy dừa xa làm nền cho có không khí xứ dừa
    const farTrunk = new CylinderGeometry(0.16, 0.26, 5.5, 6);
    const farLeaf = new ConeGeometry(0.28, 2.4, 5);
    const trunkMat = k.lit({ color: '#9a6b3c' });
    const leafMat = k.lit({ color: '#2f9a45', flatShading: true });
    const far = new InstancedMesh(farTrunk, trunkMat, 18);
    const farTops = new InstancedMesh(farLeaf, leafMat, 18 * 4);
    const mm = new Matrix4();
    for (let i = 0; i < 18; i++) {
      const x = -halfW - 14 + (i / 17) * (halfW * 2 + 28);
      const z = -8 - (i % 3) * 2.5;
      mm.makeTranslation(x, 2.75, z);
      far.setMatrixAt(i, mm);
      for (let j = 0; j < 4; j++) {
        const a = (j / 4) * Math.PI * 2;
        const t = new Matrix4().makeRotationZ(Math.cos(a) * 1.15).multiply(new Matrix4().makeRotationX(Math.sin(a) * 1.15));
        t.setPosition(x + Math.cos(a) * 1.0, 5.5, z + Math.sin(a) * 1.0);
        farTops.setMatrixAt(i * 4 + j, t);
      }
    }
    scene.add(far, farTops);

    /* ---------------- mỗi người một cây dừa ---------------- */
    const trunkGeo = new CylinderGeometry(0.3, 0.46, TRUNK_H, 12);
    const ringTex = k.texture(64, 256, (g, w, h) => {
      g.fillStyle = '#a8763f';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(70,40,15,0.45)';
      for (let y = 0; y < h; y += 22) g.fillRect(0, y, w, 6);
    });
    const treeTrunkMat = k.lit({ map: ringTex });
    const bladeGeo = new BoxGeometry(0.34, 0.05, 2.5);
    const nutGeo = new SphereGeometry(0.26, 12, 10);
    const nutMat = k.lit({ color: '#6b8e23' });
    const dryNutMat = k.lit({ color: '#7a4a1e' });
    const flagGeo = new BoxGeometry(0.7, 0.3, 0.05);

    interface Tree {
      group: Group;
      crown: Group;
      char: Character3D;
      id: string;
      x: number;
      shownH: number;
      lastHarvest: number;
      lastSlip: number;
      pile: InstancedMesh;
      pileShown: number;
      bunch: Mesh[];
    }
    const trees: Tree[] = [];
    const falling: Falling[] = [];

    o.players.forEach((p, i) => {
      const group = new Group();
      group.position.set(treeX(i), 0, 0);

      const trunk = new Mesh(trunkGeo, treeTrunkMat);
      trunk.position.y = TRUNK_H / 2;
      trunk.castShadow = !k.low;
      group.add(trunk);

      const crown = new Group();
      crown.position.y = TRUNK_H;
      for (let j = 0; j < 7; j++) {
        const a = (j / 7) * Math.PI * 2;
        const pivot = new Group();
        pivot.rotation.y = a;
        const blade = new Mesh(bladeGeo, leafMat);
        blade.position.z = 1.2;
        blade.rotation.x = 0.5; // lá rủ xuống
        blade.castShadow = !k.low;
        pivot.add(blade);
        crown.add(pivot);
      }
      // chùm dừa xanh dưới tán
      const bunch: Mesh[] = [];
      for (let j = 0; j < 3; j++) {
        const nut = new Mesh(nutGeo, nutMat);
        nut.position.set(Math.cos(j * 2.1) * 0.32, -0.28, Math.sin(j * 2.1) * 0.32);
        crown.add(nut);
        bunch.push(nut);
      }
      group.add(crown);

      // cờ màu người chơi cắm dưới gốc cho dễ nhận ra cây của mình
      const flag = new Mesh(flagGeo, new MeshBasicMaterial({ color: p.color }));
      flag.position.set(-0.75, 1.1, 0);
      const pole = new Mesh(new CylinderGeometry(0.03, 0.03, 1.6, 6), trunkMat);
      pole.position.set(-1.1, 0.8, 0);
      group.add(flag, pole);

      const char = k.kit.create(p.color, p.id === o.meId);
      char.setShadows(!k.low);
      char.setYaw(-Math.PI / 2); // quay mặt vào thân cây (nhìn nghiêng từ phía camera)
      char.root.scale.setScalar(0.95);
      group.add(char.root);

      // đống dừa đã hái ở gốc cây
      const pile = new InstancedMesh(nutGeo, dryNutMat, PILE_MAX);
      pile.count = 0;
      group.add(pile);

      scene.add(group);
      trees.push({
        group,
        crown,
        char,
        id: p.id,
        x: treeX(i),
        shownH: 0,
        lastHarvest: 0,
        lastSlip: 0,
        pile,
        pileShown: 0,
        bunch,
      });
    });
    k.onTier((tier) => {
      for (const t of trees) t.char.setShadows(tier !== 'low');
    });

    const target = new Vector3(0, 3.1, 0);
    const camPos = new Vector3();
    const setPile = (t: Tree, count: number) => {
      const c = Math.min(PILE_MAX, count);
      for (let j = 0; j < c; j++) {
        // xếp thành hai hàng nhỏ ở bên phải gốc cây
        mm.makeTranslation(0.95 + (j % 5) * 0.26, 0.2 + Math.floor(j / 5) * 0.3, 0.2 + (j % 2) * 0.12);
        t.pile.setMatrixAt(j, mm);
      }
      t.pile.count = c;
      t.pile.instanceMatrix.needsUpdate = true;
      t.pileShown = count;
    };

    return {
      frame(dt, time) {
        const f = o.read();
        const nowMs = Date.now(); // chỉ dùng cho hiệu ứng, không ảnh hưởng luật
        const wind = f.wind;
        const windy = wind === 'active';
        const sway = windy ? Math.sin(time * 17) * 0.13 : wind === 'warn' ? Math.sin(time * 9) * 0.035 : Math.sin(time * 1.1) * 0.012;

        for (const t of trees) {
          const snap = f.snapRef.current[t.id];
          const mine = t.id === o.meId;
          // người khác: nội suy theo snapshot; mình: dùng độ cao dự đoán cho mượt
          const targetH = mine ? f.pred.current : (snap?.h ?? 0);
          const wrapped = targetH < t.shownH - f.cfg.climbTo / 2; // vừa hái xong, về gốc
          t.shownH = wrapped ? targetH : t.shownH + (targetH - t.shownH) * (1 - Math.exp(-dt * (mine ? 22 : 10)));
          const y = CLIMB_BASE + (t.shownH / f.cfg.climbTo) * (CLIMB_TOP - CLIMB_BASE);

          t.group.rotation.z = sway;
          t.crown.rotation.y += dt * (windy ? 2.2 : 0.15);
          t.char.root.position.set(0.5, y, 0.12);

          const stunned = snap?.s ?? false;
          const sinceClimb = nowMs - (f.climbAt.current[t.id] ?? 0);
          const cheering = nowMs - (f.harvestAt.current[t.id] ?? 0) < 700;
          const climbing = mine ? sinceClimb < 220 : Math.abs(targetH - t.shownH) > 0.15;
          t.char.update(dt, {
            speed: climbing && !stunned ? 0.9 : 0,
            dead: false,
            time,
            pose: stunned || nowMs - (f.slipAt.current[t.id] ?? 0) < 600 ? 'hit' : cheering ? 'cheer' : 'run',
          });

          // hái được dừa: một quả rơi xuống, đống dừa ở gốc cao thêm
          const harvest = f.harvestAt.current[t.id] ?? 0;
          if (harvest > t.lastHarvest) {
            t.lastHarvest = harvest;
            const nut = new Mesh(nutGeo, nutMat);
            nut.position.set(t.x + 0.2, TRUNK_H - 0.4, 0.3);
            scene.add(nut);
            falling.push({ mesh: nut, vy: 0, x: t.x });
            k.effects.burst(t.x, TRUNK_H - 0.2, 0.3, {
              count: k.count(26),
              palette: ['#7bd36b', '#ffd166', '#ffffff'],
              speed: 4,
              life: 0.7,
              size: 0.15,
              additive: true,
            });
            if (mine) k.shake(0.12);
          }
          // đống dừa ở gốc chỉ tăng khi quả dừa vừa hái đã rơi chạm đất
          const dropping = falling.filter((q) => q.x === t.x).length;
          const want = Math.max(0, (snap?.c ?? 0) - dropping);
          if (want !== t.pileShown) setPile(t, want);

          // gió quật người leo xuống: bụi lá bay
          const slip = f.slipAt.current[t.id] ?? 0;
          if (slip > t.lastSlip) {
            t.lastSlip = slip;
            k.effects.burst(t.x + 0.5, y + 0.8, 0.2, {
              count: k.count(18),
              palette: ['#2f9a45', '#7bd36b', '#ffffff'],
              speed: 3.5,
              life: 0.6,
              size: 0.16,
            });
            if (mine) k.shake(0.3);
          }

          k.label(o.labels.get(t.id), t.x, 0.1, 1.3);
        }

        // quả dừa rơi xuống
        for (let q = falling.length - 1; q >= 0; q--) {
          const fl = falling[q];
          fl.vy -= 16 * dt;
          fl.mesh.position.y += fl.vy * dt;
          fl.mesh.rotation.x += dt * 6;
          if (fl.mesh.position.y <= 0.26) {
            scene.remove(fl.mesh);
            falling.splice(q, 1);
          }
        }

        // nhìn thẳng vào hàng cây, hơi ngước lên
        const vertical = (TRUNK_H / 2 + 2.2) / Math.tan((38 / 2) * (Math.PI / 180));
        const dist = Math.max(k.fit(halfW, 0, PITCH), vertical, 11);
        camPos.set(0, target.y + Math.sin(PITCH) * dist, Math.cos(PITCH) * dist);
        k.look(camPos, target);
      },

      dispose() {
        trunkGeo.dispose();
        bladeGeo.dispose();
        nutGeo.dispose();
        flagGeo.dispose();
        farTrunk.dispose();
        farLeaf.dispose();
        for (const fl of falling) scene.remove(fl.mesh);
      },
    };
  });
}
