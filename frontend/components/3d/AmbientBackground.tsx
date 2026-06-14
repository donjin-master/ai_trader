"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function ParticleField() {
  const meshRef = useRef<THREE.Points>(null);
  const count = 800; // performance cap

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 20;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 20;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    return pos;
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y = state.clock.elapsedTime * 0.02;
    meshRef.current.rotation.x = state.clock.elapsedTime * 0.01;
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.015} color="#3B82F6" transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}

function AmbientOrbs() {
  const orb1 = useRef<THREE.Mesh>(null);
  const orb2 = useRef<THREE.Mesh>(null);
  const orb3 = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (orb1.current) {
      orb1.current.position.x = Math.sin(t * 0.3) * 3;
      orb1.current.position.y = Math.cos(t * 0.2) * 2;
    }
    if (orb2.current) {
      orb2.current.position.x = Math.cos(t * 0.25) * 4;
      orb2.current.position.y = Math.sin(t * 0.35) * 3;
    }
    if (orb3.current) {
      orb3.current.position.x = Math.sin(t * 0.4) * 2;
      orb3.current.position.y = Math.cos(t * 0.15) * 4;
    }
  });

  return (
    <>
      <mesh ref={orb1} position={[-3, 2, -5]}>
        <sphereGeometry args={[1.5, 8, 8]} />
        <meshBasicMaterial color="#7C3AED" transparent opacity={0.06} />
      </mesh>
      <mesh ref={orb2} position={[4, -1, -6]}>
        <sphereGeometry args={[2, 8, 8]} />
        <meshBasicMaterial color="#2563EB" transparent opacity={0.05} />
      </mesh>
      <mesh ref={orb3} position={[0, 3, -4]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color="#0D9488" transparent opacity={0.07} />
      </mesh>
    </>
  );
}

export default function AmbientBackground() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // Disable on mobile (battery/perf) and when reduced motion is requested
    const mobile = window.innerWidth < 768;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEnabled(!mobile && !reduced);
  }, []);

  if (!enabled) return null;

  return (
    <div className="fixed inset-0 -z-10">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 60 }}
        gl={{ powerPreference: "low-power", antialias: false, alpha: true }}
        dpr={[1, 1.5]}
        frameloop="always"
      >
        <ParticleField />
        <AmbientOrbs />
      </Canvas>
    </div>
  );
}
