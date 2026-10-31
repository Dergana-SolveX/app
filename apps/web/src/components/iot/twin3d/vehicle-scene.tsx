import { Environment, Lightformer, OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useImperativeHandle, useMemo, useRef, type ComponentRef, type Ref, type RefObject } from "react";
import { Vector3, type Group } from "three";

import { createTwinDriver } from "../twin-driver";
import type { Snapshot } from "../use-chip-simulator";
import { Car, type CarHandle } from "./car";
import { Effects, type EffectsHandle } from "./effects";
import type { ScenePalette } from "./palette";
import { World, type WorldHandle } from "./world";

/** Low rear three-quarter view: the car drives to the right, the road runs to the horizon ahead. */
const CAMERA_HOME = new Vector3(-6.9, 2.35, 7.3);
const TARGET_HOME = new Vector3(2.9, 1.0, -0.7);

export type Telemetry = { speedKmh: number; crashed: boolean; flame: boolean; parked: boolean };
export type SceneHandle = { recenter(): void };

type Props = {
  snapshotRef: RefObject<Snapshot>;
  palette: ScenePalette;
  reducedMotion: boolean;
  /** Off-screen or hidden tab: no frames are rendered. */
  active: boolean;
  onTelemetry: (telemetry: Telemetry) => void;
  ref?: Ref<SceneHandle>;
};

function SceneContent({ snapshotRef, palette, reducedMotion, onTelemetry, ref }: Omit<Props, "active">) {
  const driver = useMemo(() => createTwinDriver(), []);
  const car = useRef<CarHandle>(null);
  const world = useRef<WorldHandle>(null);
  const effects = useRef<EffectsHandle>(null);
  const shake = useRef<Group>(null);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const follow = useMemo(() => ({ z: 0, lastTelemetryS: -1, body: new Vector3() }), []);

  useImperativeHandle(
    ref,
    () => ({
      recenter() {
        camera.position.copy(CAMERA_HOME).setZ(CAMERA_HOME.z + follow.z);
        controls.current?.target.copy(TARGET_HOME).setZ(TARGET_HOME.z + follow.z);
        controls.current?.update();
      },
    }),
    [camera, follow],
  );

  // One loop drives everything, in order: the pose first, then world, car and effects read it.
  useFrame((state, delta) => {
    const snap = snapshotRef.current;
    if (!snap || !car.current || !world.current || !effects.current) return;
    const dtS = Math.min(delta, 0.05);
    const timeS = state.clock.elapsedTime;
    const pose = driver.update(
      { chipState: snap.state, trace: snap.playing?.trace ?? null, traceStartedAtMs: snap.playing?.startedAtMs ?? null },
      performance.now() - snap.clockOriginMs,
      dtS * 1000,
    );
    world.current.update(pose.odometerM, timeS);
    car.current.update({ pose, timeS, chipState: snap.state, reducedMotion });
    const latest = snap.transmissions.at(-1);
    effects.current.update({
      pose,
      timeS,
      dtS,
      chipState: snap.state,
      transmission: latest ? { channel: latest.channel, status: latest.status } : null,
      reducedMotion,
      car: car.current,
      world: world.current,
    });

    // The impact shakes the world, not the camera: the orbit controls alone own the camera.
    if (shake.current) {
      const age = pose.impactAgeMs ?? Infinity;
      const amp = !reducedMotion && age < 700 ? 0.14 * pose.crashSeverity * Math.exp(-age / 170) : 0;
      shake.current.position.set(Math.sin(timeS * 91) * amp, Math.sin(timeS * 77 + 1) * amp * 0.6, Math.sin(timeS * 83 + 2) * amp * 0.5);
    }

    // Follow the car sideways (pulling over, tumbling): camera and target pan together.
    if (controls.current) {
      const bodyZ = car.current.body.getWorldPosition(follow.body).z;
      const dz = (bodyZ * 0.75 - follow.z) * Math.min(1, dtS * 2.2);
      follow.z += dz;
      controls.current.target.z += dz;
      camera.position.z += dz;
    }

    if (timeS - follow.lastTelemetryS > 0.12) {
      follow.lastTelemetryS = timeS;
      onTelemetry({ speedKmh: Math.max(0, Math.round(pose.speedMs * 3.6)), crashed: pose.crashed, flame: pose.flame, parked: pose.parked });
    }
  });

  return (
    <>
      <color attach="background" args={[palette.skyHorizon]} />
      <fog attach="fog" args={[palette.skyHorizon, 45, 240]} />
      <hemisphereLight args={[palette.hemiSky, palette.hemiGround, palette.hemiIntensity]} />
      <directionalLight
        castShadow
        position={[9, 16, 7]}
        intensity={palette.sunIntensity}
        color={palette.sun}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={70}
      />
      {/* A studio-like environment made of light panels, for the paint and glass reflections. Nothing to download. */}
      <Environment key={palette.dark ? "night" : "day"} resolution={256} frames={1} environmentIntensity={palette.dark ? 0.38 : 0.85}>
        <Lightformer form="rect" intensity={2.2} position={[0, 9, 0]} rotation-x={Math.PI / 2} scale={[22, 9, 1]} />
        <Lightformer form="rect" intensity={1.3} position={[-11, 3, -6]} rotation-y={Math.PI / 2} scale={[16, 3, 1]} />
        <Lightformer form="rect" intensity={1.3} position={[11, 3, 6]} rotation-y={-Math.PI / 2} scale={[16, 3, 1]} />
        <Lightformer form="ring" color={palette.brand} intensity={0.8} position={[0, 4, -12]} scale={5} />
      </Environment>
      {palette.dark && <Stars radius={300} depth={80} count={2200} factor={5} saturation={0} fade speed={0} />}
      <group ref={shake}>
        <World ref={world} palette={palette} />
        <Car ref={car} palette={palette} />
        <Effects ref={effects} palette={palette} />
      </group>
      <OrbitControls
        ref={controls}
        makeDefault
        target={TARGET_HOME.toArray()}
        enablePan={false}
        minDistance={6}
        maxDistance={24}
        minPolarAngle={0.16 * Math.PI}
        maxPolarAngle={0.47 * Math.PI}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
}

/** The WebGL twin. Loaded on demand, so three.js only ships with the IoT page. */
function VehicleScene({ active, ...props }: Props) {
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 1.75]}
      frameloop={active ? "always" : "never"}
      camera={{ position: CAMERA_HOME.toArray(), fov: 36, near: 0.1, far: 1200 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      aria-hidden="true"
    >
      <SceneContent {...props} />
    </Canvas>
  );
}

export default memo(VehicleScene);
