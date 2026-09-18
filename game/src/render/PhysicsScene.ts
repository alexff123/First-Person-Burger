import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { ObjectPool } from '../core/ObjectPool';
import { ParticleSystem } from './ParticleSystem';
import type { Ticker } from '../core/Ticker';
import type { EventBus } from '../core/EventBus';
import { Events } from '../game/events';
import type { GameEvents } from '../game/events';
import type { Grade } from '../game/config';

/** 一个土豆（完整或碎块）：可视化网格 + 物理刚体。 */
interface Potato {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  active: boolean;
  dieAt: number; // >0 表示碎块回收时间戳（秒）；0 表示常驻完整土豆
}

/**
 * 物理场景（锅 + 土豆）
 * 只做两件事：① 把物理/渲染跑起来；② 发意图事件、订阅玩法事件改视觉。
 * 绝不判断游戏规则（火候、得分交给 CookingSystem），符合「状态机不碰 3D」的约束。
 */
export class PhysicsScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly world: CANNON.World;
  readonly particles: ParticleSystem; // 果汁（绿）

  private readonly goldFx: ParticleSystem; // 上菜金光
  private readonly smokeFx: ParticleSystem; // 焦糊黑烟
  private readonly pot = new THREE.Group();
  private readonly potMat = new THREE.MeshStandardMaterial({
    color: 0x555a66,
    metalness: 0.35,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
  private readonly contents: THREE.Mesh;
  private readonly basePotColor = new THREE.Color(0x555a66);
  private readonly baseFoodColor = new THREE.Color(0xc8a165);
  private readonly burntColor = new THREE.Color(0x2b1a10);
  private readonly hotColor = new THREE.Color(0xff5e2b);

  private readonly wholePool: ObjectPool<Potato>;
  private readonly chunkPool: ObjectPool<Potato>;
  private readonly active: Potato[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly fixedDt = 1 / 60;
  private acc = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly bus: EventBus<GameEvents>,
    ticker: Ticker,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.shadowMap.enabled = true;

    this.scene.background = new THREE.Color(0xfff6e5);
    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100);
    this.camera.position.set(0, 7, 11);
    this.camera.lookAt(0, 1.4, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 7);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    this.scene.add(dir);

    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    (this.world.solver as CANNON.GSSolver).iterations = 10;

    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: 0xcdeac0 }),
    );
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);
    const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(groundBody);

    // 锅：开口圆柱（侧壁）+ 底
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.3, 1.0, 24, 1, true), this.potMat);
    wall.castShadow = true;
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.12, 24), this.potMat);
    bottom.position.y = -0.55;
    bottom.receiveShadow = true;
    this.pot.add(wall, bottom);
    this.pot.position.set(0, 1.65, 0);
    this.scene.add(this.pot);

    // 锅内待煮的内容物（灰盒占位小球）
    this.contents = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xc8a165, roughness: 0.9 }),
    );
    this.contents.position.set(0, 1.7, 0);
    this.contents.visible = false;
    this.scene.add(this.contents);

    this.particles = new ParticleSystem(300, 0x9bd64a);
    this.goldFx = new ParticleSystem(200, 0xffd166);
    this.smokeFx = new ParticleSystem(200, 0x4a4a4a);
    this.scene.add(this.particles.mesh, this.goldFx.mesh, this.smokeFx.mesh);

    this.wholePool = new ObjectPool<Potato>(() => this.makePotato(0.8), (p) => this.resetPotato(p), 8);
    this.chunkPool = new ObjectPool<Potato>(() => this.makePotato(0.28), (p) => this.resetPotato(p), 48);

    // 订阅玩法事件，只改视觉（不碰规则）
    this.bus.on(Events.CookingStart, () => {
      this.contents.visible = true;
    });
    this.bus.on(Events.CookingProgress, ({ heat }) => this.applyHeat(heat));
    this.bus.on(Events.DishCooked, ({ grade }) => this.onCooked(grade));

    canvas.addEventListener('pointerdown', this.onPointerDown);
    ticker.add((dt) => this.update(dt));
  }

  private makePotato(radius: number): Potato {
    const geo = new THREE.SphereGeometry(radius, 16, 12);
    geo.scale(1.2, 0.85, 1);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc8a165, roughness: 0.9 }));
    mesh.castShadow = true;
    const body = new CANNON.Body({ mass: radius, shape: new CANNON.Sphere(radius) });
    return { mesh, body, active: false, dieAt: 0 };
  }

  private resetPotato(p: Potato): void {
    p.active = false;
    p.dieAt = 0;
    p.body.velocity.setZero();
    p.body.angularVelocity.setZero();
    p.body.position.setZero();
    p.body.quaternion.set(0, 0, 0, 1);
  }

  /** 在场中放置一个完整土豆。 */
  spawnWhole(x: number, y: number, z: number): void {
    const p = this.wholePool.acquire();
    p.active = true;
    p.dieAt = 0;
    p.body.position.set(x, y, z);
    p.mesh.position.set(x, y, z);
    this.scene.add(p.mesh);
    this.world.addBody(p.body);
    this.active.push(p);
  }

  /** 切土豆并入锅：碎块飞溅 + 果汁粒子，然后广播事件。 */
  private cutAndPot(p: Potato, now: number): void {
    const origin = p.mesh.position.clone();
    this.removeFromActive(p);
    this.scene.remove(p.mesh);
    this.world.removeBody(p.body);
    this.wholePool.release(p);

    const chunks = 6;
    for (let i = 0; i < chunks; i++) {
      const c = this.chunkPool.acquire();
      c.active = true;
      c.dieAt = now + 4;
      c.body.position.set(origin.x, origin.y, origin.z);
      c.mesh.position.copy(origin);
      c.body.velocity.set((Math.random() - 0.5) * 6, 4 + Math.random() * 3, (Math.random() - 0.5) * 6);
      c.body.angularVelocity.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      this.scene.add(c.mesh);
      this.world.addBody(c.body);
      this.active.push(c);
    }
    this.particles.burst(origin, 40);

    // 发意图事件：物理层只报告"发生了什么"，不决定后果
    this.bus.emit(Events.PotatoCut, { chunks });
    this.bus.emit(Events.DishPrepared, { slices: chunks }); // 切片成功
    this.bus.emit(Events.PotatoInPot, {}); // 放入锅中
  }

  private removeFromActive(p: Potato): void {
    const idx = this.active.indexOf(p);
    if (idx >= 0) this.active.splice(idx, 1);
  }

  private applyHeat(heat: number): void {
    const t = Math.min(1, heat / 100);
    this.potMat.color.copy(this.basePotColor).lerp(this.hotColor, t * 0.75);
    (this.contents.material as THREE.MeshStandardMaterial).color
      .copy(this.baseFoodColor)
      .lerp(this.burntColor, t);
  }

  /** 出餐表现：只为四个档位播放不同视觉，不参与任何判定（判定在 CookingSystem）。 */
  private onCooked(grade: Grade): void {
    const p = new THREE.Vector3(0, 2.2, 0);
    const foodMat = this.contents.material as THREE.MeshStandardMaterial;

    switch (grade) {
      case 'perfect': // 完美：金光大作
        this.goldFx.burst(p, 60);
        this.particles.burst(p, 20);
        break;
      case 'raw': // 生食：几乎没有光，冷冷清清
        this.goldFx.burst(p, 12);
        this.particles.burst(p, 20);
        break;
      case 'over': // 过火：冒点烟，颜色发暗
        this.smokeFx.burst(p, 30);
        this.particles.burst(p, 10);
        break;
      case 'burnt': // 焦糊：浓烟 + 锅底发黑
        this.smokeFx.burst(new THREE.Vector3(0, 2.4, 0), 60);
        this.potMat.color.copy(this.burntColor);
        break;
    }

    this.contents.visible = false;
    foodMat.color.copy(this.baseFoodColor);
    if (grade === 'perfect' || grade === 'raw') this.potMat.color.copy(this.basePotColor);
    this.refill(); // 补一个新土豆，保证循环不断
  }

  /** 在锅旁补一个新的完整土豆。 */
  private refill(): void {
    this.spawnWhole((Math.random() - 0.5) * 6, 2.5, 1 + Math.random() * 2);
  }

  private onPointerDown = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const now = performance.now() / 1000;

    // 先判锅：点锅 = 出锅意图
    if (this.raycaster.intersectObject(this.pot, true).length > 0) {
      this.bus.emit(Events.PotClicked, {});
      return;
    }
    // 再判完整土豆：点土豆 = 切 + 入锅
    const wholeMeshes = this.active.filter((a) => a.dieAt === 0).map((a) => a.mesh);
    const hit = this.raycaster.intersectObjects(wholeMeshes, false)[0];
    if (hit) {
      const target = this.active.find((a) => a.mesh === hit.object && a.dieAt === 0);
      if (target) {
        this.cutAndPot(target, now);
        return;
      }
    }
    // 点地面：摆一个新土豆
    const ground = this.raycaster.intersectObjects(
      this.scene.children.filter(
        (c) => c instanceof THREE.Mesh && (c as THREE.Mesh).geometry instanceof THREE.PlaneGeometry,
      ),
      false,
    )[0];
    const pos = ground
      ? ground.point.clone().setY(2)
      : new THREE.Vector3((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4);
    this.spawnWhole(pos.x, pos.y, pos.z);
  };

  /** 由 Ticker 每帧调用：固定步长物理 + 网格同步 + 粒子。 */
  private update(dt: number): void {
    this.acc += dt;
    while (this.acc >= this.fixedDt) {
      this.world.step(this.fixedDt);
      this.acc -= this.fixedDt;
    }
    const now = performance.now() / 1000;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.mesh.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
      p.mesh.quaternion.set(
        p.body.quaternion.x,
        p.body.quaternion.y,
        p.body.quaternion.z,
        p.body.quaternion.w,
      );
      if (p.dieAt !== 0 && now >= p.dieAt) {
        this.scene.remove(p.mesh);
        this.world.removeBody(p.body);
        this.chunkPool.release(p);
        this.active.splice(i, 1);
      }
    }
    this.particles.update(dt);
    this.goldFx.update(dt);
    this.smokeFx.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.dispose();
  }
}
