import * as THREE from 'three';

/**
 * 果汁粒子系统（Juice FX）
 * 用单个 InstancedMesh 渲染所有粒子，满足性能红线「粒子用 InstancedMesh / GPU 粒子」要求。
 * 固定容量 + 循环复用，无运行时分配。
 */
export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly max: number;
  private readonly pos: THREE.Vector3[];
  private readonly vel: THREE.Vector3[];
  private readonly life: Float32Array;
  private readonly dummy = new THREE.Object3D();
  private cursor = 0;

  constructor(max = 300, color = 0x9bd64a) {
    this.max = max;
    this.pos = new Array(max);
    this.vel = new Array(max);
    this.life = new Float32Array(max);

    const geo = new THREE.SphereGeometry(0.08, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = max;

    for (let i = 0; i < max; i++) {
      this.pos[i] = new THREE.Vector3(0, -999, 0);
      this.vel[i] = new THREE.Vector3();
      this.dummy.position.copy(this.pos[i]);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 在 origin 处爆发 count 个粒子。 */
  burst(origin: THREE.Vector3, count: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.life[i] = 0.6 + Math.random() * 0.4; // 生命周期（秒）
      this.pos[i].copy(origin);
      this.vel[i].set((Math.random() - 0.5) * 4, Math.random() * 5 + 1, (Math.random() - 0.5) * 4);
      this.dummy.position.copy(origin);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 推进粒子（重力 + 寿命衰减），dt 为秒。 */
  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      dirty = true;
      this.life[i] -= dt;
      this.vel[i].y -= 9.82 * dt;
      this.pos[i].addScaledVector(this.vel[i], dt);
      const s = Math.max(0, this.life[i]); // 随寿命缩小
      this.dummy.position.copy(this.pos[i]);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
