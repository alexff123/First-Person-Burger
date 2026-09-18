import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { ObjectPool } from './ObjectPool';
import { ParticleSystem } from './ParticleSystem';

/** 一个土豆（完整或碎块）：可视化网格 + 物理刚体，二选一地出现在场中。 */
interface Potato {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  active: boolean;
  dieAt: number; // >0 表示碎块回收时间戳（秒）；0 表示常驻完整土豆
}

export interface PhysicsSceneOptions {
  /** 切土豆回调（未来接分数 / 事件总线），不强制。 */
  onCut?: (chunks: number) => void;
}

/**
 * 物理场景（切土豆 Demo）
 * Three.js 渲染 + cannon-es 物理，射线点击切土豆：碎块飞溅（物理碰撞）+ 果汁粒子（Juice）。
 * 对象池预创建土豆与碎块；渲染循环用 rAF + 固定步长物理，符合性能红线。
 */
export class PhysicsScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly world: CANNON.World;
  readonly particles: ParticleSystem;

  private readonly wholePool: ObjectPool<Potato>;
  private readonly chunkPool: ObjectPool<Potato>;
  private readonly active: Potato[] = []; // 当前在场（完整 + 碎块）
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly fixedDt = 1 / 60;
  private acc = 0;
  private last = 0;
  private running = false;
  private readonly onCut?: (chunks: number) => void;

  constructor(canvas: HTMLCanvasElement, opts: PhysicsSceneOptions = {}) {
    this.onCut = opts.onCut;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.shadowMap.enabled = true;

    this.scene.background = new THREE.Color(0xfff6e5);
    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100);
    this.camera.position.set(0, 7, 11);
    this.camera.lookAt(0, 1, 0);

    // 灯光
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 7);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    this.scene.add(dir);

    // 物理世界
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    (this.world.solver as CANNON.GSSolver).iterations = 10;

    // 地面：可视平面 + 静态物理体
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

    // 果汁粒子系统
    this.particles = new ParticleSystem(300, 0x9bd64a);
    this.scene.add(this.particles.mesh);

    // 对象池：预先创建，避免运行时分配
    this.wholePool = new ObjectPool<Potato>(() => this.makePotato(0.8), (p) => this.resetPotato(p), 8);
    this.chunkPool = new ObjectPool<Potato>(() => this.makePotato(0.28), (p) => this.resetPotato(p), 48);

    canvas.addEventListener('pointerdown', this.onPointerDown);
  }

  /** 创建土豆（mesh + body），初始不在场景/世界中。 */
  private makePotato(radius: number): Potato {
    const geo = new THREE.SphereGeometry(radius, 16, 12);
    geo.scale(1.2, 0.85, 1); // 压扁成土豆形
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8a165, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
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

  /** 切土豆：移除完整土豆，爆出碎块 + 果汁粒子。 */
  private cut(p: Potato, now: number): void {
    const origin = p.mesh.position.clone();
    this.removeFromActive(p);
    this.scene.remove(p.mesh);
    this.world.removeBody(p.body);
    this.wholePool.release(p);

    const chunks = 6;
    for (let i = 0; i < chunks; i++) {
      const c = this.chunkPool.acquire();
      c.active = true;
      c.dieAt = now + 4; // 4 秒后回收
      c.body.position.set(origin.x, origin.y, origin.z);
      c.mesh.position.copy(origin);
      c.body.velocity.set((Math.random() - 0.5) * 6, 4 + Math.random() * 3, (Math.random() - 0.5) * 6);
      c.body.angularVelocity.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      this.scene.add(c.mesh);
      this.world.addBody(c.body);
      this.active.push(c);
    }
    this.particles.burst(origin, 40);
    this.onCut?.(chunks);
  }

  private removeFromActive(p: Potato): void {
    const idx = this.active.indexOf(p);
    if (idx >= 0) this.active.splice(idx, 1);
  }

  private onPointerDown = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const now = performance.now() / 1000;

    // 先判土豆：命中完整土豆则切
    const wholeMeshes = this.active.filter((a) => a.dieAt === 0).map((a) => a.mesh);
    const hit = this.raycaster.intersectObjects(wholeMeshes, false)[0];
    if (hit) {
      const target = this.active.find((a) => a.mesh === hit.object && a.dieAt === 0);
      if (target) {
        this.cut(target, now);
        return;
      }
    }
    // 没点到土豆：往地面（或前方）摆一个新土豆，演示对象池复用
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

  /** 启动渲染/物理循环（rAF + 固定步长，符合性能红线）。 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  }

  private tick = (time: number): void => {
    if (!this.running) return;
    const dt = Math.min((time - this.last) / 1000, 0.1);
    this.last = time;

    // 固定步长物理（螺旋死亡保护：acc 已 clamp）
    this.acc += dt;
    while (this.acc >= this.fixedDt) {
      this.world.step(this.fixedDt);
      this.acc -= this.fixedDt;
    }

    const now = time / 1000;
    // 同步网格到刚体；回收过期碎块
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
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.tick);
  };

  /** 窗口尺寸变化。 */
  resize(): void {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /** 释放（teardown）：移除监听、释放 GL 资源，避免泄漏。 */
  dispose(): void {
    this.running = false;
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.dispose();
  }
}
