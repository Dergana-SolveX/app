import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
  type Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { ScenePalette } from "./palette";
import { asphaltTexture, dashTexture, facadeTexture, grassTexture, softDiscTexture } from "./textures";

/** Road layout across z: our lane is centred on 0, the hard shoulder on +z (towards the camera). */
export const LANE_EDGE_Z = 1.75;
const ROAD_FAR_Z = -5.25;
const SHOULDER_OUT_Z = 4.2;
const ROAD_LENGTH = 420;
/** Towers stand between the street lamps and the skyline, close enough apart that one is always in view ahead. */
const TOWER_SPACING = 150;
const TOWER_Z = -19;
const TOWER_HEIGHT = 18;
/** The tower the car talks to: the one nearest this distance ahead. */
const TOWER_PREFERRED_X = 70;

export type WorldHandle = {
  update(odometerM: number, timeS: number): void;
  /** The top of the cell tower the car talks to (the nearest one, ahead if possible). */
  towerTop(odometerM: number, out: Vector3): Vector3;
};

/** Seeded jitter, so the scenery is the same on every visit. */
function jitter(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Repeated scenery: `count` items every `spacing` metres, wrapped around the car as it drives. */
type Row = {
  meshes: (InstancedMesh | null)[];
  count: number;
  spacing: number;
  phase: number;
  /** Per-item placement, fixed at creation. */
  items: { z: number; scale: [number, number, number]; rotY: number }[];
  y?: number;
};

const wrapX = (i: number, row: Row, odometerM: number) => {
  const span = row.count * row.spacing;
  const raw = i * row.spacing + row.phase - odometerM;
  return (((raw % span) + span) % span) - span * 0.3;
};

function SkyDome({ palette }: { palette: ScenePalette }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: { top: { value: new Color(palette.skyTop) }, horizon: { value: new Color(palette.skyHorizon) } },
        vertexShader: `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
          void main() { float h = clamp(normalize(vPos).y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
      }),
    [palette.skyTop, palette.skyHorizon],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} renderOrder={-1}>
      <sphereGeometry args={[480, 32, 16]} />
    </mesh>
  );
}

export function World({ palette, ref }: { palette: ScenePalette; ref?: Ref<WorldHandle> }) {
  const dummy = useMemo(() => new Object3D(), []);
  const towers = useRef<(Object3D | null)[]>([]);
  const beacons = useRef<MeshStandardMaterial[]>([]);

  const textures = useMemo(() => {
    const road = asphaltTexture(palette.asphalt);
    road.repeat.set(ROAD_LENGTH / 8, (LANE_EDGE_Z - ROAD_FAR_Z) / 8);
    const shoulder = asphaltTexture(palette.shoulder);
    shoulder.repeat.set(ROAD_LENGTH / 8, (SHOULDER_OUT_Z - LANE_EDGE_Z) / 8);
    const grass = grassTexture(palette.grass);
    grass.repeat.set(ROAD_LENGTH / 6, 320 / 6);
    const dash = dashTexture();
    dash.repeat.set(ROAD_LENGTH / 12, 1);
    return { road, shoulder, grass, dash, facade: facadeTexture(palette.building, false), lit: facadeTexture(palette.building, true), disc: softDiscTexture() };
  }, [palette.asphalt, palette.shoulder, palette.grass, palette.building]);

  const materials = useMemo(() => {
    const night = palette.dark;
    return {
      road: new MeshStandardMaterial({ map: textures.road, roughness: 0.92 }),
      shoulder: new MeshStandardMaterial({ map: textures.shoulder, roughness: 0.95 }),
      grass: new MeshStandardMaterial({ map: textures.grass, roughness: 1 }),
      line: new MeshStandardMaterial({ color: palette.lane, roughness: 0.6, emissive: new Color(palette.lane), emissiveIntensity: night ? 0.08 : 0 }),
      dash: new MeshStandardMaterial({ color: palette.lane, map: textures.dash, alphaMap: textures.dash, transparent: true, roughness: 0.6, emissive: new Color(palette.lane), emissiveIntensity: night ? 0.08 : 0 }),
      curb: new MeshStandardMaterial({ color: palette.curb, roughness: 0.85 }),
      metal: new MeshStandardMaterial({ color: night ? "#5b636b" : "#aeb6bd", metalness: 0.8, roughness: 0.35 }),
      pole: new MeshStandardMaterial({ color: night ? "#2b3036" : "#7f878e", metalness: 0.5, roughness: 0.5 }),
      lamp: new MeshStandardMaterial({ color: "#2a2a2a", emissive: new Color("#ffd9a0"), emissiveIntensity: night ? 7 : 0.15 }),
      pool: new MeshBasicMaterial({ map: textures.disc, color: "#ffcf8a", transparent: true, opacity: night ? 0.42 : 0, blending: AdditiveBlending, depthWrite: false }),
      trunk: new MeshStandardMaterial({ color: palette.trunk, roughness: 0.9 }),
      foliage: new MeshStandardMaterial({ color: palette.foliage, roughness: 0.85, flatShading: true }),
      building: new MeshStandardMaterial({
        map: textures.facade,
        roughness: 0.8,
        emissiveMap: textures.lit,
        emissive: new Color("#ffffff"),
        emissiveIntensity: night ? 1.5 : 0,
        color: night ? "#3a4048" : "#ffffff",
      }),
      postWhite: new MeshStandardMaterial({ color: "#f2f2f0", roughness: 0.6 }),
      postRed: new MeshStandardMaterial({ color: palette.danger, roughness: 0.5 }),
      hills: new MeshStandardMaterial({ color: palette.hills, roughness: 1, flatShading: true }),
      mast: new MeshStandardMaterial({ color: night ? "#3b4249" : "#9aa3aa", metalness: 0.6, roughness: 0.4 }),
    };
  }, [palette, textures]);
  useEffect(() => () => Object.values(materials).forEach((m: Material) => m.dispose()), [materials]);

  const geometries = useMemo(() => {
    const pole = new CylinderGeometry(0.08, 0.12, 7.6, 10).translate(0, 3.8, 0);
    const arm = new BoxGeometry(0.08, 0.08, 1.9).translate(0, 7.45, 0.9);
    return {
      post: new BoxGeometry(0.1, 0.72, 0.1).translate(0, 0.36, 0),
      lampPole: mergeGeometries([pole, arm]) as BufferGeometry,
      lampHead: new BoxGeometry(0.62, 0.14, 0.34).translate(0, 7.36, 1.8),
      pool: new PlaneGeometry(7, 7).rotateX(-Math.PI / 2).translate(0, 0.02, 1.8),
      trunk: new CylinderGeometry(0.12, 0.18, 1.7, 7).translate(0, 0.85, 0),
      foliage: new IcosahedronGeometry(1.5, 0).translate(0, 2.7, 0),
      building: new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      pk: new BoxGeometry(0.14, 0.9, 0.14).translate(0, 0.45, 0),
      pkCap: new BoxGeometry(0.15, 0.18, 0.15).translate(0, 0.98, 0),
    };
  }, []);

  const rows = useMemo(() => {
    const r = jitter(42);
    const make = (count: number, spacing: number, phase: number, z: (k: number) => number, scale: () => [number, number, number] = () => [1, 1, 1]): Row => ({
      meshes: [],
      count,
      spacing,
      phase,
      items: Array.from({ length: count }, (_, k) => ({ z: z(k), scale: scale(), rotY: r() * Math.PI * 2 })),
    });
    return {
      posts: make(64, 4, 0, () => 4.62),
      lamps: make(10, 32, 6, () => -6.4),
      // Beyond the default camera (z ≈ 7): they frame the view when someone orbits around the car.
      treesNear: make(26, 9.5, 3, () => 10 + r() * 14, () => {
        const s = 0.75 + r() * 0.7;
        return [s, s * (0.9 + r() * 0.4), s];
      }),
      treesFar: make(22, 12, 8, () => -9.2 - r() * 4, () => {
        const s = 0.7 + r() * 0.6;
        return [s, s, s];
      }),
      buildings: make(16, 22, 0, () => -36 - r() * 12, () => [10 + r() * 6, 6 + r() * 15, 8 + r() * 5]),
      pk: make(3, 100, 40, () => 3.95),
    };
  }, []);

  const hills = useMemo(() => {
    const r = jitter(7);
    return Array.from({ length: 9 }, (_, k) => ({ x: -260 + k * 65 + r() * 30, z: -190 - r() * 40, radius: 34 + r() * 40, height: 16 + r() * 26 }));
  }, []);

  const place = (row: Row, odometerM: number, offsetY = 0) => {
    for (let i = 0; i < row.count; i++) {
      const item = row.items[i]!;
      dummy.position.set(wrapX(i, row, odometerM), offsetY, item.z);
      dummy.rotation.set(0, row === rows.buildings || row === rows.posts || row === rows.lamps || row === rows.pk ? 0 : item.rotY, 0);
      dummy.scale.set(...item.scale);
      dummy.updateMatrix();
      for (const mesh of row.meshes) mesh?.setMatrixAt(i, dummy.matrix);
    }
    for (const mesh of row.meshes) if (mesh) mesh.instanceMatrix.needsUpdate = true;
  };

  useImperativeHandle(
    ref,
    () => ({
      update(odometerM, timeS) {
        textures.road.offset.x = odometerM / 8;
        textures.shoulder.offset.x = odometerM / 8;
        textures.grass.offset.x = odometerM / 6;
        textures.dash.offset.x = odometerM / 12;
        for (const row of Object.values(rows)) place(row, odometerM);
        towers.current.forEach((tower, k) => {
          if (!tower) return;
          const span = 2 * TOWER_SPACING;
          const raw = k * TOWER_SPACING + 60 - odometerM;
          tower.position.x = (((raw % span) + span) % span) - span * 0.25;
        });
        const blink = palette.dark ? (Math.floor(timeS * 1.2) % 2 === 0 ? 3.5 : 0.4) : 0.8;
        for (const beacon of beacons.current) beacon.emissiveIntensity = blink;
      },
      towerTop(odometerM, out) {
        let best: Object3D | null = null;
        let bestScore = Infinity;
        for (const tower of towers.current) {
          if (!tower) continue;
          const score = tower.position.x < -15 ? 1000 + Math.abs(tower.position.x) : Math.abs(tower.position.x - TOWER_PREFERRED_X);
          if (score < bestScore) {
            bestScore = score;
            best = tower;
          }
        }
        return best ? out.set(best.position.x, TOWER_HEIGHT + 1.2, TOWER_Z) : out.set(40, TOWER_HEIGHT, TOWER_Z);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [textures, rows, palette.dark],
  );

  const instanced = (row: Row, index: number) => (mesh: InstancedMesh | null) => {
    row.meshes[index] = mesh;
  };

  return (
    <group>
      <SkyDome palette={palette} />

      {/* Ground, road, shoulder, lines. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} material={materials.grass} receiveShadow>
        <planeGeometry args={[ROAD_LENGTH, 320]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, (LANE_EDGE_Z + ROAD_FAR_Z) / 2]} material={materials.road} receiveShadow>
        <planeGeometry args={[ROAD_LENGTH, LANE_EDGE_Z - ROAD_FAR_Z]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, (LANE_EDGE_Z + SHOULDER_OUT_Z) / 2]} material={materials.shoulder} receiveShadow>
        <planeGeometry args={[ROAD_LENGTH, SHOULDER_OUT_Z - LANE_EDGE_Z]} />
      </mesh>
      {[LANE_EDGE_Z, ROAD_FAR_Z + 0.12, SHOULDER_OUT_Z - 0.1].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, z]} material={materials.line} receiveShadow>
          <planeGeometry args={[ROAD_LENGTH, 0.15]} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, (LANE_EDGE_Z + ROAD_FAR_Z) / 2]} material={materials.dash} receiveShadow>
        <planeGeometry args={[ROAD_LENGTH, 0.14]} />
      </mesh>
      <mesh position={[0, 0.08, ROAD_FAR_Z - 1.1]} material={materials.curb} receiveShadow castShadow>
        <boxGeometry args={[ROAD_LENGTH, 0.16, 2.2]} />
      </mesh>

      {/* Guardrail along the shoulder: the rail stays, the posts scroll. */}
      <mesh position={[0, 0.62, 4.55]} material={materials.metal} castShadow receiveShadow>
        <boxGeometry args={[ROAD_LENGTH, 0.3, 0.05]} />
      </mesh>
      <instancedMesh ref={instanced(rows.posts, 0)} args={[geometries.post, materials.metal, rows.posts.count]} castShadow frustumCulled={false} />

      {/* Street lamps on the far side, with their pool of light at night. */}
      <instancedMesh ref={instanced(rows.lamps, 0)} args={[geometries.lampPole, materials.pole, rows.lamps.count]} castShadow frustumCulled={false} />
      <instancedMesh ref={instanced(rows.lamps, 1)} args={[geometries.lampHead, materials.lamp, rows.lamps.count]} frustumCulled={false} />
      <instancedMesh ref={instanced(rows.lamps, 2)} args={[geometries.pool, materials.pool, rows.lamps.count]} frustumCulled={false} renderOrder={1} />

      <instancedMesh ref={instanced(rows.treesNear, 0)} args={[geometries.trunk, materials.trunk, rows.treesNear.count]} castShadow frustumCulled={false} />
      <instancedMesh ref={instanced(rows.treesNear, 1)} args={[geometries.foliage, materials.foliage, rows.treesNear.count]} castShadow frustumCulled={false} />
      <instancedMesh ref={instanced(rows.treesFar, 0)} args={[geometries.trunk, materials.trunk, rows.treesFar.count]} castShadow frustumCulled={false} />
      <instancedMesh ref={instanced(rows.treesFar, 1)} args={[geometries.foliage, materials.foliage, rows.treesFar.count]} castShadow frustumCulled={false} />
      <instancedMesh ref={instanced(rows.buildings, 0)} args={[geometries.building, materials.building, rows.buildings.count]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={instanced(rows.pk, 0)} args={[geometries.pk, materials.postWhite, rows.pk.count]} castShadow frustumCulled={false} />
      <instancedMesh ref={instanced(rows.pk, 1)} args={[geometries.pkCap, materials.postRed, rows.pk.count]} frustumCulled={false} />

      {/* Cell towers: the chip's alert goes to the nearest one. */}
      {[0, 1].map((k) => (
        <group
          key={k}
          ref={(group) => {
            towers.current[k] = group;
          }}
          position={[0, 0, TOWER_Z]}
        >
          <mesh position={[0, TOWER_HEIGHT / 2, 0]} material={materials.mast} castShadow>
            <cylinderGeometry args={[0.2, 0.55, TOWER_HEIGHT, 6]} />
          </mesh>
          {[0, 1, 2].map((p) => (
            <mesh
              key={p}
              position={[Math.cos((p * Math.PI * 2) / 3) * 0.55, TOWER_HEIGHT - 1.4, Math.sin((p * Math.PI * 2) / 3) * 0.55]}
              rotation={[0, -(p * Math.PI * 2) / 3, 0]}
              material={materials.postWhite}
              castShadow
            >
              <boxGeometry args={[0.12, 1.6, 0.4]} />
            </mesh>
          ))}
          <mesh position={[0, TOWER_HEIGHT + 0.4, 0]}>
            <sphereGeometry args={[0.22, 12, 12]} />
            <meshStandardMaterial
              ref={(m) => {
                if (m) beacons.current[k] = m;
              }}
              color="#330000"
              emissive={palette.danger}
              emissiveIntensity={1}
            />
          </mesh>
        </group>
      ))}

      {/* Distant hills: far enough not to move. */}
      {hills.map((h, k) => (
        <mesh key={k} position={[h.x, h.height / 2 - 1, h.z]} material={materials.hills}>
          <coneGeometry args={[h.radius, h.height, 6]} />
        </mesh>
      ))}
    </group>
  );
}
