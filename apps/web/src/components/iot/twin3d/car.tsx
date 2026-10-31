import type { ChipState } from "@solvex-dergana/shared";
import { RoundedBox } from "@react-three/drei";
import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  MathUtils,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Shape,
  type BufferAttribute,
  type Group,
  type Mesh,
  type SpotLight,
} from "three";

import type { TwinPose } from "../twin-driver";
import type { ScenePalette } from "./palette";
import { plateTexture } from "./textures";

export const WHEEL_RADIUS_M = 0.34;
/** Height of the roll axis: the car turns over about its middle, then rests on its lowest point. */
const ROLL_AXIS_Y = 0.75;
/** Sideways travel per radian of roll as the car tumbles over its edges. */
const TUMBLE_M_PER_RAD = 0.85;
/** Cross-section corners (z, y) used to keep the lowest point of the car on the road at any roll. */
const SECTION: [number, number][] = [
  [0.92, 0],
  [-0.92, 0],
  [0.9, 0.95],
  [-0.9, 0.95],
  [0.76, 1.47],
  [-0.76, 1.47],
];

const WHEELS = [
  { x: 1.35, side: 1 as const },
  { x: 1.35, side: -1 as const },
  { x: -1.35, side: 1 as const },
  { x: -1.35, side: -1 as const },
];

export type CarFrame = {
  pose: TwinPose;
  timeS: number;
  chipState: ChipState;
  reducedMotion: boolean;
};

export type CarHandle = {
  update(frame: CarFrame): void;
  /** Where flames and smoke come from (the engine bay), where radio waves leave (the roof antenna). */
  engine: Object3D;
  antenna: Object3D;
  roof: Object3D;
  body: Object3D;
};

function bodyGeometry() {
  const s = new Shape();
  s.moveTo(-2.16, 0.3);
  s.lineTo(-1.8, 0.3);
  s.absarc(-1.35, 0.3, 0.45, Math.PI, 0, true);
  s.lineTo(0.9, 0.3);
  s.absarc(1.35, 0.3, 0.45, Math.PI, 0, true);
  s.lineTo(2.1, 0.3);
  s.quadraticCurveTo(2.22, 0.32, 2.23, 0.5);
  s.lineTo(2.2, 0.68);
  s.quadraticCurveTo(2.16, 0.84, 1.96, 0.87);
  s.lineTo(1.22, 0.99);
  s.lineTo(-1.48, 1.0);
  s.lineTo(-1.95, 0.98);
  s.quadraticCurveTo(-2.17, 0.96, -2.19, 0.8);
  s.lineTo(-2.21, 0.5);
  s.quadraticCurveTo(-2.21, 0.32, -2.16, 0.3);
  const geometry = new ExtrudeGeometry(s, {
    depth: 1.66,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.05,
    bevelSegments: 4,
    curveSegments: 18,
  });
  geometry.translate(0, 0, -0.83);
  geometry.computeVertexNormals();
  return geometry;
}

function cabinGeometry() {
  const s = new Shape();
  s.moveTo(-1.46, 0.97);
  s.lineTo(-0.98, 1.39);
  s.lineTo(0.4, 1.41);
  s.lineTo(1.2, 0.97);
  s.lineTo(-1.46, 0.97);
  const geometry = new ExtrudeGeometry(s, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  geometry.translate(0, 0, -0.75);
  return geometry;
}

function finGeometry() {
  const s = new Shape();
  s.moveTo(-0.12, 0);
  s.lineTo(0.14, 0);
  s.quadraticCurveTo(0.02, 0.05, -0.08, 0.11);
  s.lineTo(-0.12, 0);
  const geometry = new ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 });
  geometry.translate(0, 0, -0.025);
  return geometry;
}

/** A thin bar between two points of the side profile: the window pillars. */
function Pillar({ from, to, z, material }: { from: [number, number]; to: [number, number]; z: number; material: MeshPhysicalMaterial }) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return (
    <mesh
      position={[(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, z]}
      rotation={[0, 0, Math.atan2(dy, dx)]}
      material={material}
      castShadow
    >
      <boxGeometry args={[Math.hypot(dx, dy) + 0.04, 0.075, 0.06]} />
    </mesh>
  );
}

function Wheel({ x, side, spinRef, materials }: {
  x: number;
  side: 1 | -1;
  spinRef: (group: Group | null) => void;
  materials: { tire: MeshStandardMaterial; rim: MeshStandardMaterial; trim: MeshStandardMaterial };
}) {
  const geometries = useMemo(
    () => ({
      tire: new CylinderGeometry(WHEEL_RADIUS_M, WHEEL_RADIUS_M, 0.25, 32).rotateX(Math.PI / 2),
      rim: new CylinderGeometry(0.235, 0.235, 0.256, 24).rotateX(Math.PI / 2),
      hub: new CylinderGeometry(0.06, 0.06, 0.27, 12).rotateX(Math.PI / 2),
      spoke: new BoxGeometry(0.44, 0.055, 0.02),
    }),
    [],
  );
  return (
    <group position={[x, WHEEL_RADIUS_M, side * 0.79]}>
      <group ref={spinRef}>
        <mesh geometry={geometries.tire} material={materials.tire} castShadow />
        <mesh geometry={geometries.rim} material={materials.rim} />
        <mesh geometry={geometries.hub} material={materials.trim} />
        {[0, 1, 2, 3, 4].map((k) => (
          <mesh
            key={k}
            geometry={geometries.spoke}
            material={materials.rim}
            position={[0, 0, side * 0.13]}
            rotation={[0, 0, (k * Math.PI * 2) / 5]}
          />
        ))}
      </group>
    </group>
  );
}

/** The chip's LED: one colour per state, blinking while it counts down or boots. */
function ledColor(state: ChipState, t: number, palette: ScenePalette, reducedMotion: boolean): [string, number] {
  const blink = (hz: number) => (reducedMotion ? 1 : Math.floor(t * hz * 2) % 2 === 0 ? 1 : 0.15);
  const breathe = reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(t * 2.4);
  switch (state) {
    case "BOOT":
      return [palette.info, 3 * blink(2)];
    case "IDLE":
      return ["#9aa3ab", 0.6];
    case "ARMED":
      return [palette.brand, 3.2 * breathe];
    case "IMPACT":
      return [palette.danger, 5];
    case "CONFIRM":
      return [palette.warning, 4.5 * blink(2)];
    case "SEND":
    case "AWAIT_ACK":
      return [palette.warning, 3.5 * breathe];
    case "DONE":
      return [palette.success, 4];
  }
}

export function Car({ palette, ref }: { palette: ScenePalette; ref?: Ref<CarHandle> }) {
  const root = useRef<Group>(null);
  const roll = useRef<Group>(null);
  const pitch = useRef<Group>(null);
  const front = useRef<Group>(null);
  const bodyMesh = useRef<Mesh>(null);
  const spins = useRef<(Group | null)[]>([]);
  const headSpots = useRef<(SpotLight | null)[]>([]);
  const anchors = useMemo(
    () => ({ engine: new Object3D(), antenna: new Object3D(), roof: new Object3D(), body: new Object3D() }),
    [],
  );
  const deformed = useRef(0);

  const geometries = useMemo(() => ({ body: bodyGeometry(), cabin: cabinGeometry(), fin: finGeometry() }), []);
  const original = useMemo(() => (geometries.body.attributes.position as BufferAttribute).array.slice(), [geometries]);

  const materials = useMemo(() => {
    const paint = new MeshPhysicalMaterial({ color: palette.carPaint, metalness: 0.72, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
    return {
      paint,
      glass: new MeshPhysicalMaterial({ color: "#0b1015", metalness: 0.25, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.6 }),
      trim: new MeshStandardMaterial({ color: "#121416", roughness: 0.55, metalness: 0.2 }),
      tire: new MeshStandardMaterial({ color: "#18191b", roughness: 0.92 }),
      rim: new MeshStandardMaterial({ color: "#c3c9ce", metalness: 1, roughness: 0.22 }),
      accent: new MeshStandardMaterial({ color: palette.brand, roughness: 0.35, metalness: 0.3, emissive: new Color(palette.brand), emissiveIntensity: 0.25 }),
      head: new MeshStandardMaterial({ color: "#f4f8ff", emissive: new Color("#eaf2ff"), emissiveIntensity: 1 }),
      tail: new MeshStandardMaterial({ color: "#5a0d0d", emissive: new Color("#ff2a1a"), emissiveIntensity: 0.8 }),
      indicator: new MeshStandardMaterial({ color: "#5a3a0a", emissive: new Color("#ffa51a"), emissiveIntensity: 0 }),
      led: new MeshStandardMaterial({ color: "#111111", emissive: new Color(palette.brand), emissiveIntensity: 2 }),
      plate: new MeshStandardMaterial({ map: plateTexture("SVX · 001"), roughness: 0.5 }),
    };
  }, [palette.carPaint, palette.brand]);
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  // Spot targets live in the car, so the beams follow it.
  const spotTargets = useMemo(() => [new Object3D(), new Object3D()], []);
  useEffect(() => {
    spotTargets[0]!.position.set(16, 0, 0.9);
    spotTargets[1]!.position.set(16, 0, -0.9);
    headSpots.current.forEach((spot, i) => {
      if (spot) spot.target = spotTargets[i]!;
    });
  }, [spotTargets]);

  /** The front crumples back in proportion to the crash: geometry pushed once, restored on a fresh car. */
  const crumple = (severity: number) => {
    const position = geometries.body.attributes.position as BufferAttribute;
    const array = position.array as Float32Array;
    for (let i = 0; i < array.length; i += 3) {
      const x = original[i]!;
      const y = original[i + 1]!;
      const k = x > 1.3 ? Math.pow((x - 1.3) / 0.95, 1.6) : 0;
      array[i] = x - severity * 0.42 * k;
      array[i + 1] = y - (y > 0.7 ? severity * 0.07 * k * (1 + Math.sin(i * 12.9898) * 0.5) : 0);
      array[i + 2] = original[i + 2]!;
    }
    position.needsUpdate = true;
    geometries.body.computeVertexNormals();
    if (front.current) front.current.position.x = -severity * 0.38;
    deformed.current = severity;
  };

  useImperativeHandle(
    ref,
    () => ({
      ...anchors,
      update({ pose, timeS, chipState, reducedMotion }) {
        const rollRad = -MathUtils.degToRad(pose.rollDeg);
        // Lowest point of the cross-section after the roll: that point rests on the road.
        let lowest = Infinity;
        for (const [z, y] of SECTION) {
          lowest = Math.min(lowest, ROLL_AXIS_Y + (y - ROLL_AXIS_Y) * Math.cos(rollRad) - z * Math.sin(rollRad));
        }
        const moving = Math.min(1, pose.speedMs / 8);
        const shiver = reducedMotion || pose.crashed ? 0 : 0.0035 * Math.sin(timeS * 41) * moving;
        if (root.current) {
          root.current.position.set(0, -lowest + pose.heaveM + shiver, pose.lateralM + TUMBLE_M_PER_RAD * rollRad);
        }
        if (roll.current) roll.current.rotation.x = rollRad;
        if (pitch.current) pitch.current.rotation.z = MathUtils.degToRad(pose.pitchDeg);
        for (const spin of spins.current) if (spin) spin.rotation.z = -pose.odometerM / WHEEL_RADIUS_M;

        if (pose.crashed && deformed.current === 0) crumple(pose.crashSeverity);
        if (!pose.crashed && deformed.current !== 0) crumple(0);

        const night = palette.dark;
        const broken = pose.crashed && pose.crashSeverity > 0.6;
        materials.head.emissiveIntensity = (night ? 3.2 : 0.9) * (broken ? 0.25 : 1);
        for (const spot of headSpots.current) if (spot) spot.intensity = night && !broken ? 70 : 0;
        materials.tail.emissiveIntensity = pose.braking ? 4 : night ? 1.4 : 0.6;
        const blinkOn = pose.hazards && (reducedMotion || Math.floor(timeS * 3.2) % 2 === 0);
        materials.indicator.emissiveIntensity = blinkOn ? 4 : 0;
        const [led, intensity] = ledColor(chipState, timeS, palette, reducedMotion);
        materials.led.emissive.set(led);
        materials.led.emissiveIntensity = intensity;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [materials, palette, anchors],
  );

  return (
    <group ref={root}>
      <group ref={roll} position={[0, ROLL_AXIS_Y, 0]}>
        <group ref={pitch}>
          <group position={[0, -ROLL_AXIS_Y, 0]}>
            <primitive object={anchors.body} />
            <primitive object={anchors.engine} position={[1.55, 0.95, 0]} />
            <primitive object={anchors.antenna} position={[-0.86, 1.6, 0]} />
            <primitive object={anchors.roof} position={[-0.3, 1.47, 0]} />

            <mesh ref={bodyMesh} geometry={geometries.body} material={materials.paint} castShadow receiveShadow />
            <mesh geometry={geometries.cabin} material={materials.glass} castShadow />
            <RoundedBox args={[1.4, 0.07, 1.52]} radius={0.03} position={[-0.29, 1.425, 0]} material={materials.paint} castShadow />
            {([1, -1] as const).map((side) => (
              <group key={side}>
                <Pillar from={[1.2, 0.97]} to={[0.4, 1.41]} z={side * 0.765} material={materials.paint} />
                <Pillar from={[-0.27, 0.98]} to={[-0.27, 1.41]} z={side * 0.765} material={materials.paint} />
                <Pillar from={[-1.46, 0.97]} to={[-0.98, 1.39]} z={side * 0.765} material={materials.paint} />
                {/* Brand stripe along the side, door handles, mirror. */}
                <mesh position={[0.1, 0.62, side * 0.905]} material={materials.accent}>
                  <boxGeometry args={[3.5, 0.045, 0.012]} />
                </mesh>
                <mesh position={[0.32, 0.86, side * 0.905]} material={materials.trim}>
                  <boxGeometry args={[0.18, 0.035, 0.02]} />
                </mesh>
                <mesh position={[-0.72, 0.86, side * 0.905]} material={materials.trim}>
                  <boxGeometry args={[0.18, 0.035, 0.02]} />
                </mesh>
                <mesh position={[1.02, 1.03, side * 0.97]} material={materials.paint} castShadow>
                  <boxGeometry args={[0.16, 0.1, 0.14]} />
                </mesh>
                <mesh position={[-2.16, 0.81, side * 0.84]} material={materials.indicator}>
                  <boxGeometry args={[0.1, 0.07, 0.07]} />
                </mesh>
                <RoundedBox args={[0.06, 0.11, 0.42]} radius={0.02} position={[-2.195, 0.81, side * 0.57]} material={materials.tail} />
              </group>
            ))}

            {/* Front clip: moves back with the crumple. */}
            <group ref={front}>
              {([1, -1] as const).map((side, i) => (
                <group key={side}>
                  <RoundedBox args={[0.07, 0.13, 0.38]} radius={0.025} position={[2.18, 0.71, side * 0.58]} material={materials.head} />
                  <mesh position={[2.2, 0.615, side * 0.6]} material={materials.head}>
                    <boxGeometry args={[0.04, 0.022, 0.32]} />
                  </mesh>
                  <mesh position={[2.12, 0.71, side * 0.85]} material={materials.indicator}>
                    <boxGeometry args={[0.12, 0.06, 0.06]} />
                  </mesh>
                  <spotLight
                    ref={(spot) => {
                      headSpots.current[i] = spot;
                    }}
                    position={[2.3, 0.72, side * 0.58]}
                    angle={0.42}
                    penumbra={0.65}
                    distance={45}
                    decay={1.6}
                    intensity={0}
                    color="#eef4ff"
                  />
                </group>
              ))}
              <mesh position={[2.235, 0.5, 0]} material={materials.trim}>
                <boxGeometry args={[0.03, 0.16, 0.85]} />
              </mesh>
              <mesh position={[2.24, 0.36, 0]} material={materials.trim}>
                <boxGeometry args={[0.03, 0.08, 1.2]} />
              </mesh>
              <mesh position={[2.257, 0.43, 0]} rotation={[0, Math.PI / 2, 0]} material={materials.plate}>
                <planeGeometry args={[0.52, 0.115]} />
              </mesh>
            </group>
            <mesh position={[-2.237, 0.47, 0]} rotation={[0, -Math.PI / 2, 0]} material={materials.plate}>
              <planeGeometry args={[0.52, 0.115]} />
            </mesh>

            {/* The SVX chip: roof antenna fin with its status LED, and the module behind the windscreen. */}
            <mesh geometry={geometries.fin} position={[-0.9, 1.455, 0]} material={materials.trim} castShadow />
            <mesh position={[-0.86, 1.585, 0]} material={materials.led}>
              <sphereGeometry args={[0.032, 16, 16]} />
            </mesh>
            <mesh position={[0.98, 1.005, 0.28]} material={materials.led}>
              <boxGeometry args={[0.08, 0.025, 0.12]} />
            </mesh>

            {WHEELS.map(({ x, side }, i) => (
              <Wheel
                key={i}
                x={x}
                side={side}
                materials={materials}
                spinRef={(group) => {
                  spins.current[i] = group;
                }}
              />
            ))}
            {spotTargets.map((target, i) => (
              <primitive key={i} object={target} />
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}
