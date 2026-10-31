import type { ChipState } from "@solvex-dergana/shared";
import { QuadraticBezierLine } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useImperativeHandle, useMemo, useRef, type ComponentRef, type Ref } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  MathUtils,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  Points,
  ShaderMaterial,
  Shape,
  Vector3,
  type Blending,
  type Group,
  type InstancedMesh,
  type Mesh,
  type PerspectiveCamera,
  type PointLight,
} from "three";

import { BARRIER_HALF_DEPTH_M, type TwinPose } from "../twin-driver";
import type { CarHandle } from "./car";
import type { ScenePalette } from "./palette";
import { chevronTexture, potholeTexture, softDiscTexture } from "./textures";
import type { WorldHandle } from "./world";

export type EffectsFrame = {
  pose: TwinPose;
  timeS: number;
  dtS: number;
  chipState: ChipState;
  /** The latest send attempt, if any. */
  transmission: { channel: "http" | "sms"; status: "pending" | "ok" | "failed" } | null;
  reducedMotion: boolean;
  car: CarHandle;
  world: WorldHandle;
};

export type EffectsHandle = { update(frame: EffectsFrame): void };

/** Soft round particles (smoke, flames, sparks) in one draw call per kind. */
class ParticlePool {
  readonly points: Points;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly color: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly spec: Float32Array; // size0, size1, alpha0 per particle
  private readonly c0: Float32Array;
  private readonly c1: Float32Array;
  private cursor = 0;
  private readonly material: ShaderMaterial;

  constructor(readonly count: number, blending: Blending, readonly gravity: number, readonly drag: number) {
    this.position = new Float32Array(count * 3);
    this.velocity = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.color = new Float32Array(count * 3);
    this.age = new Float32Array(count).fill(1);
    this.life = new Float32Array(count).fill(1);
    this.spec = new Float32Array(count * 3);
    this.c0 = new Float32Array(count * 3);
    this.c1 = new Float32Array(count * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.position, 3));
    geometry.setAttribute("aSize", new BufferAttribute(this.size, 1));
    geometry.setAttribute("aAlpha", new BufferAttribute(this.alpha, 1));
    geometry.setAttribute("aColor", new BufferAttribute(this.color, 3));
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: { uScale: { value: 800 }, uMap: { value: softDiscTexture() } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale;
        varying float vAlpha; varying vec3 vColor;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv; vAlpha = aAlpha; vColor = aColor; }`,
      fragmentShader: `uniform sampler2D uMap; varying float vAlpha; varying vec3 vColor;
        void main() { float a = texture2D(uMap, gl_PointCoord).a * vAlpha; if (a < 0.004) discard; gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  spawn(p: Vector3, v: Vector3, life: number, size0: number, size1: number, alpha0: number, color0: Color, color1: Color) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.position.set([p.x, p.y, p.z], i * 3);
    this.velocity.set([v.x, v.y, v.z], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.spec.set([size0, size1, alpha0], i * 3);
    this.c0.set([color0.r, color0.g, color0.b], i * 3);
    this.c1.set([color1.r, color1.g, color1.b], i * 3);
  }

  clear() {
    this.age.fill(1);
    this.life.fill(1);
    this.alpha.fill(0);
  }

  update(dt: number, scrollDx: number, pixelScale: number) {
    this.material.uniforms.uScale!.value = pixelScale;
    for (let i = 0; i < this.count; i++) {
      if (this.age[i]! >= this.life[i]!) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i]! += dt;
      const t = Math.min(1, this.age[i]! / this.life[i]!);
      const k = i * 3;
      const damp = Math.exp(-this.drag * dt);
      this.velocity[k]! *= damp;
      this.velocity[k + 2]! *= damp;
      this.velocity[k + 1] = this.velocity[k + 1]! * damp + this.gravity * dt;
      this.position[k]! += this.velocity[k]! * dt - scrollDx;
      this.position[k + 1]! += this.velocity[k + 1]! * dt;
      this.position[k + 2]! += this.velocity[k + 2]! * dt;
      if (this.position[k + 1]! < 0.02 && this.gravity < 0) {
        this.position[k + 1] = 0.02;
        this.velocity[k + 1] = Math.abs(this.velocity[k + 1]!) * 0.25;
      }
      this.size[i] = MathUtils.lerp(this.spec[k]!, this.spec[k + 1]!, t);
      this.alpha[i] = this.spec[k + 2]! * (t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88);
      for (let c = 0; c < 3; c++) this.color[k + c] = MathUtils.lerp(this.c0[k + c]!, this.c1[k + c]!, t);
    }
    const g = this.points.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.aSize!.needsUpdate = true;
    g.attributes.aAlpha!.needsUpdate = true;
    g.attributes.aColor!.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

const DEBRIS = 44;

function barrierGeometry() {
  const s = new Shape();
  s.moveTo(-0.3, 0);
  s.lineTo(0.3, 0);
  s.lineTo(0.22, 0.08);
  s.lineTo(0.1, 0.3);
  s.lineTo(0.075, 0.82);
  s.lineTo(-0.075, 0.82);
  s.lineTo(-0.1, 0.3);
  s.lineTo(-0.22, 0.08);
  s.lineTo(-0.3, 0);
  const geometry = new ExtrudeGeometry(s, { depth: 3.8, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 });
  geometry.translate(0, 0, -1.9);
  return geometry;
}

export function Effects({ palette, ref }: { palette: ScenePalette; ref?: Ref<EffectsHandle> }) {
  const group = useRef<Group>(null);
  const barrier = useRef<Group>(null);
  const potholes = useRef<(Mesh | null)[]>([]);
  const debris = useRef<InstancedMesh>(null);
  const flash = useRef<PointLight>(null);
  const fireLight = useRef<PointLight>(null);
  const dust = useRef<Mesh>(null);
  const rings = useRef<(Mesh | null)[]>([]);
  const link = useRef<ComponentRef<typeof QuadraticBezierLine>>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const pools = useMemo(
    () => ({
      smoke: new ParticlePool(260, NormalBlending, 0.12, 0.35),
      fire: new ParticlePool(220, AdditiveBlending, 1.2, 1.6),
      sparks: new ParticlePool(160, AdditiveBlending, -9.8, 0.6),
    }),
    [],
  );
  useEffect(() => () => Object.values(pools).forEach((p) => p.dispose()), [pools]);

  const materials = useMemo(
    () => ({
      concrete: new MeshStandardMaterial({ color: palette.dark ? "#6c7176" : "#c9cdd0", roughness: 0.9 }),
      chevron: new MeshStandardMaterial({ map: chevronTexture(palette.danger), roughness: 0.4, emissive: new Color("#ffffff"), emissiveMap: chevronTexture(palette.danger), emissiveIntensity: palette.dark ? 0.35 : 0, side: DoubleSide }),
      post: new MeshStandardMaterial({ color: "#3a3f44", metalness: 0.6, roughness: 0.4 }),
      pothole: new MeshBasicMaterial({ map: potholeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      debris: new MeshStandardMaterial({ color: "#6d757c", metalness: 0.5, roughness: 0.45 }),
      dust: new MeshBasicMaterial({ color: palette.dark ? "#8a8f94" : "#b9b4aa", transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }),
    }),
    [palette.dark, palette.danger],
  );
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);
  const ringMaterials = useMemo(
    () => [0, 1, 2].map(() => new MeshBasicMaterial({ color: palette.brand, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide })),
    [palette.brand],
  );
  useEffect(() => () => ringMaterials.forEach((m) => m.dispose()), [ringMaterials]);
  const geometries = useMemo(() => ({ barrier: barrierGeometry(), debris: new BoxGeometry(1, 1, 1) }), []);

  const sim = useMemo(
    () => ({
      p: new Float32Array(DEBRIS * 3),
      v: new Float32Array(DEBRIS * 3),
      r: new Float32Array(DEBRIS * 3),
      w: new Float32Array(DEBRIS * 3),
      s: new Float32Array(DEBRIS),
      live: false,
      doneAtS: null as number | null,
      lastState: null as ChipState | null,
    }),
    [],
  );
  const scratch = useMemo(
    () => ({ a: new Vector3(), b: new Vector3(), mid: new Vector3(), v: new Vector3(), dummy: new Object3D(), c0: new Color(), c1: new Color() }),
    [],
  );

  const spawnDebris = (severity: number, barrierX: number) => {
    let seed = 1;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < DEBRIS; i++) {
      const k = i * 3;
      sim.p.set([barrierX - BARRIER_HALF_DEPTH_M - 0.05, 0.35 + rand() * 0.5, (rand() - 0.5) * 1.6], k);
      sim.v.set([-(0.5 + rand() * 2.5), (1.5 + rand() * 3.5) * (0.5 + severity), (rand() - 0.5) * 5 * (0.5 + severity)], k);
      sim.r.set([rand() * 6, rand() * 6, rand() * 6], k);
      sim.w.set([(rand() - 0.5) * 18, (rand() - 0.5) * 18, (rand() - 0.5) * 18], k);
      sim.s[i] = 0.04 + rand() * 0.12;
    }
    sim.live = true;
  };

  useImperativeHandle(
    ref,
    () => ({
      update({ pose, timeS, dtS, chipState, transmission, reducedMotion, car, world }) {
        const root = group.current;
        if (!root) return;
        const scrollDx = pose.speedMs * dtS;
        const pixelScale = (size.height * dpr) / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2));
        const toLocal = (anchor: Object3D, out: Vector3) => root.worldToLocal(anchor.getWorldPosition(out));

        // Obstacles, where the driver placed them along the road.
        const barrierObstacle = pose.obstacles.find((o) => o.kind === "barrier");
        if (barrier.current) {
          barrier.current.visible = Boolean(barrierObstacle);
          if (barrierObstacle) {
            const age = pose.impactAgeMs ?? -1;
            const shove = age >= 0 ? 0.22 * pose.crashSeverity * (1 - Math.pow(1 - Math.min(1, age / 260), 3)) : 0;
            barrier.current.position.set(barrierObstacle.worldX - pose.odometerM + shove, 0, 0);
            barrier.current.rotation.y = shove * 0.25;
          }
        }
        const holes = pose.obstacles.filter((o) => o.kind === "pothole");
        potholes.current.forEach((mesh, i) => {
          if (!mesh) return;
          const hole = holes[i];
          mesh.visible = Boolean(hole);
          if (hole) mesh.position.x = hole.worldX - pose.odometerM;
        });

        // Crash: debris, a flash, a ring of dust; none of it on a fresh car.
        if (!pose.crashed && sim.live) {
          sim.live = false;
          if (debris.current) debris.current.visible = false;
        }
        if (pose.crashed && !sim.live && barrierObstacle) {
          spawnDebris(pose.crashSeverity, barrierObstacle.worldX - pose.odometerM);
          if (debris.current) debris.current.visible = true;
        }
        if (sim.live && debris.current) {
          for (let i = 0; i < DEBRIS; i++) {
            const k = i * 3;
            const half = sim.s[i]! / 2;
            sim.v[k + 1]! -= 9.8 * dtS;
            for (let c = 0; c < 3; c++) {
              sim.p[k + c]! += sim.v[k + c]! * dtS;
              sim.r[k + c]! += sim.w[k + c]! * dtS;
            }
            sim.p[k]! -= scrollDx;
            if (sim.p[k + 1]! < half) {
              sim.p[k + 1] = half;
              sim.v[k + 1] = -sim.v[k + 1]! * 0.28;
              sim.v[k]! *= 0.6;
              sim.v[k + 2]! *= 0.6;
              for (let c = 0; c < 3; c++) sim.w[k + c]! *= 0.5;
            }
            scratch.dummy.position.set(sim.p[k]!, sim.p[k + 1]!, sim.p[k + 2]!);
            scratch.dummy.rotation.set(sim.r[k]!, sim.r[k + 1]!, sim.r[k + 2]!);
            scratch.dummy.scale.set(sim.s[i]!, sim.s[i]! * 0.5, sim.s[i]! * 0.8);
            scratch.dummy.updateMatrix();
            debris.current.setMatrixAt(i, scratch.dummy.matrix);
          }
          debris.current.instanceMatrix.needsUpdate = true;
        }
        const impactS = pose.impactAgeMs === null ? Infinity : pose.impactAgeMs / 1000;
        if (flash.current) {
          flash.current.intensity = impactS < 0.6 ? (reducedMotion ? 15 : 90) * pose.crashSeverity * Math.exp(-impactS / 0.09) : 0;
          if (barrierObstacle) flash.current.position.set(barrierObstacle.worldX - pose.odometerM - 0.4, 0.8, 0);
        }
        if (dust.current) {
          const visible = impactS < 0.9 && barrierObstacle;
          dust.current.visible = Boolean(visible);
          if (visible) {
            const s = 0.4 + (impactS / 0.9) * 3.4;
            dust.current.scale.set(s, s, s);
            dust.current.position.set(barrierObstacle.worldX - pose.odometerM - 0.5, 0.03, 0);
            materials.dust.opacity = 0.35 * (1 - impactS / 0.9);
          }
        }

        // Fire and smoke, at the rate the chip's sensors report them.
        const engine = toLocal(car.engine, scratch.a);
        const quiet = reducedMotion ? 0.5 : 1;
        if (pose.smoke > 0.02) {
          const rate = pose.smoke * 95 * quiet;
          const n = Math.floor(rate * dtS + Math.random());
          scratch.c0.set(palette.dark ? "#8b9096" : "#4a4d51");
          scratch.c1.set(palette.dark ? "#3a3d41" : "#9a9ea2");
          for (let i = 0; i < n; i++) {
            scratch.v.set(-0.25 + (Math.random() - 0.5) * 0.3, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3);
            scratch.b.set(engine.x + (Math.random() - 0.5) * 0.5, engine.y + 0.1, engine.z + (Math.random() - 0.5) * 0.6);
            pools.smoke.spawn(scratch.b, scratch.v, 3.4 + Math.random() * 2, 0.5, 4.6, 0.55 * Math.min(1, pose.smoke + 0.2), scratch.c0, scratch.c1);
          }
        }
        if (pose.flame) {
          const n = Math.floor(110 * quiet * dtS + Math.random());
          scratch.c0.set("#ffd36b");
          scratch.c1.set("#c2280f");
          for (let i = 0; i < n; i++) {
            scratch.v.set((Math.random() - 0.5) * 0.4, 1.4 + Math.random() * 1.4, (Math.random() - 0.5) * 0.4);
            scratch.b.set(engine.x + (Math.random() - 0.5) * 0.7, engine.y + Math.random() * 0.1, engine.z + (Math.random() - 0.5) * 0.9);
            pools.fire.spawn(scratch.b, scratch.v, 0.35 + Math.random() * 0.4, 0.55 + Math.random() * 0.3, 0.08, 0.9, scratch.c0, scratch.c1);
          }
        }
        if (fireLight.current) {
          fireLight.current.intensity = pose.flame ? 9 + Math.sin(timeS * 23) * 2.5 + Math.sin(timeS * 37) * 1.5 : 0;
          fireLight.current.position.set(engine.x, engine.y + 0.6, engine.z);
        }

        // A car sliding on its roof throws sparks.
        if (Math.abs(pose.rollDeg) > 95 && pose.speedMs > 1.2) {
          const roof = toLocal(car.roof, scratch.b);
          const n = Math.floor(140 * quiet * dtS + Math.random());
          scratch.c0.set("#fff2b0");
          scratch.c1.set("#ff7a1a");
          for (let i = 0; i < n; i++) {
            scratch.v.set(-pose.speedMs * (0.3 + Math.random() * 0.5), 0.8 + Math.random() * 2.2, (Math.random() - 0.5) * 3);
            scratch.mid.set(roof.x + (Math.random() - 0.5) * 1.2, 0.05, roof.z + (Math.random() - 0.5) * 0.8);
            pools.sparks.spawn(scratch.mid, scratch.v, 0.25 + Math.random() * 0.3, 0.14, 0.03, 1, scratch.c0, scratch.c1);
          }
        }
        // A reboot gives a fresh car: no smoke or flames left over.
        if (chipState === "BOOT" && sim.lastState !== "BOOT") Object.values(pools).forEach((pool) => pool.clear());
        for (const pool of Object.values(pools)) pool.update(dtS, scrollDx, pixelScale);

        // The alert going out: rings from the roof antenna and a link to the nearest cell tower.
        if (chipState === "DONE" && sim.lastState !== "DONE") sim.doneAtS = timeS;
        if (chipState === "BOOT") sim.doneAtS = null;
        sim.lastState = chipState;
        const sending = chipState === "SEND" || chipState === "AWAIT_ACK";
        const doneFor = sim.doneAtS === null ? Infinity : timeS - sim.doneAtS;
        const showLink = sending || doneFor < 3;
        const linkColor =
          doneFor < 3 ? palette.success : transmission?.status === "failed" ? palette.danger : transmission?.channel === "sms" ? palette.warning : palette.brand;
        const antenna = toLocal(car.antenna, scratch.a);
        rings.current.forEach((ring, k) => {
          if (!ring) return;
          ring.visible = showLink;
          if (!showLink) return;
          const phase = (timeS * (reducedMotion ? 0.35 : 0.8) + k / 3) % 1;
          const s = 0.15 + phase * 2.4;
          ring.position.copy(antenna);
          ring.scale.set(s, s, s);
          ringMaterials[k]!.color.set(linkColor);
          ringMaterials[k]!.opacity = (1 - phase) * 0.7 * (doneFor < 3 ? 1 - doneFor / 3 : 1);
        });
        const line = link.current;
        if (line) {
          line.visible = showLink;
          if (showLink) {
            // The towers and these effects share the same parent space: no conversion needed.
            const tower = world.towerTop(pose.odometerM, scratch.b);
            scratch.mid.copy(antenna).lerp(tower, 0.5);
            scratch.mid.y += 6;
            line.setPoints(antenna, tower, scratch.mid);
            // Dashes are laid out along the line's length: it changes whenever the points do.
            line.computeLineDistances();
            const material = line.material as unknown as { color: Color; opacity: number; dashOffset: number };
            material.color.set(linkColor);
            material.opacity = doneFor < 3 ? 1 - doneFor / 3 : 0.95;
            material.dashOffset -= dtS * (transmission?.channel === "sms" ? 1.2 : 3);
          }
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [palette, materials, ringMaterials, pools, size.height, dpr, camera],
  );

  return (
    <group ref={group}>
      <group ref={barrier} visible={false}>
        <mesh geometry={geometries.barrier} material={materials.concrete} castShadow receiveShadow />
        <mesh position={[-0.16, 1.2, 0]} rotation={[0, -Math.PI / 2, 0]} material={materials.chevron} castShadow>
          <planeGeometry args={[3.2, 0.5]} />
        </mesh>
        {[1.3, -1.3].map((z) => (
          <mesh key={z} position={[-0.12, 1.0, z]} material={materials.post}>
            <boxGeometry args={[0.06, 0.4, 0.06]} />
          </mesh>
        ))}
      </group>
      {[0, 1].map((i) => (
        <mesh
          key={i}
          ref={(mesh) => {
            potholes.current[i] = mesh;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.007, 0]}
          material={materials.pothole}
          visible={false}
          renderOrder={2}
        >
          <planeGeometry args={[1.5, 2.6]} />
        </mesh>
      ))}
      <instancedMesh ref={debris} args={[geometries.debris, materials.debris, DEBRIS]} castShadow visible={false} frustumCulled={false} />
      <mesh ref={dust} rotation={[-Math.PI / 2, 0, 0]} material={materials.dust} visible={false}>
        <ringGeometry args={[0.6, 1, 48]} />
      </mesh>
      <pointLight ref={flash} color="#fff1d6" intensity={0} distance={14} decay={1.6} />
      <pointLight ref={fireLight} color="#ff8a2a" intensity={0} distance={12} decay={1.5} />
      {[0, 1, 2].map((k) => (
        <mesh
          key={k}
          ref={(mesh) => {
            rings.current[k] = mesh;
          }}
          rotation={[Math.PI / 2, 0, 0]}
          material={ringMaterials[k]}
          visible={false}
        >
          <torusGeometry args={[1, 0.025, 8, 64]} />
        </mesh>
      ))}
      <QuadraticBezierLine ref={link} start={[0, 2, 0]} end={[40, 26, -30]} dashed dashSize={0.8} gapSize={0.5} lineWidth={2.2} transparent visible={false} />
      <primitive object={pools.smoke.points} />
      <primitive object={pools.fire.points} />
      <primitive object={pools.sparks.points} />
    </group>
  );
}
