import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'

const DUST_COUNT = 70

function BackgroundDust() {
  const positions = useMemo(() => {
    const arr = new Float32Array(DUST_COUNT * 3)
    for (let i = 0; i < DUST_COUNT; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 9
      arr[i * 3 + 1] = (Math.random() - 0.5) * 6
      arr[i * 3 + 2] = (Math.random() - 0.5) * 6 - 2
    }
    return arr
  }, [])
  const points = useRef(null)

  useFrame((_, delta) => {
    if (points.current) points.current.rotation.y += delta * 0.02
  })

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.035} color="#9fd7ff" transparent opacity={0.45} sizeAttenuation />
    </points>
  )
}

// Her yörünge bir "adım"ı temsil eder: merkezdeki işin etrafında kendi
// hızında, kendi eğiminde dönen küçük bir düğüm.
const ORBITS = [
  { radius: 1.15, tilt: [0.35, 0.15, 0], speed: 0.5, phase: 0, size: 0.1 },
  { radius: 1.55, tilt: [-0.45, 0.5, 0.2], speed: -0.35, phase: 2.1, size: 0.09 },
  { radius: 0.9, tilt: [1.1, -0.25, 0.4], speed: 0.75, phase: 4.2, size: 0.08 },
  { radius: 1.85, tilt: [0.15, -0.6, -0.3], speed: -0.28, phase: 1.3, size: 0.11 },
]

function OrbitRing({ radius, tilt, speed, phase, size }) {
  const nodeRef = useRef(null)

  useFrame((state) => {
    if (!nodeRef.current) return
    const angle = phase + state.clock.elapsedTime * speed
    nodeRef.current.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
  })

  return (
    <group rotation={tilt}>
      <mesh>
        <torusGeometry args={[radius, 0.006, 8, 96]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.18} />
      </mesh>
      <mesh ref={nodeRef}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshPhysicalMaterial
          color="#bfe8ff"
          emissive="#3aa9e8"
          emissiveIntensity={0.7}
          roughness={0.25}
          metalness={0.2}
          clearcoat={0.6}
        />
      </mesh>
    </group>
  )
}

// Merkezdeki "iş" - etrafında adımlar dönerken kendi içinde yavaşça nabız gibi parlar.
function Core() {
  const core = useRef(null)
  const halo = useRef(null)

  useFrame((state) => {
    const pulse = 0.5 + Math.sin(state.clock.elapsedTime * 1.1) * 0.5
    if (core.current) core.current.material.emissiveIntensity = 0.8 + pulse * 0.6
    if (halo.current) {
      const s = 1 + pulse * 0.12
      halo.current.scale.set(s, s, s)
      halo.current.material.opacity = 0.12 + pulse * 0.08
    }
  })

  return (
    <>
      <mesh ref={halo}>
        <sphereGeometry args={[0.62, 24, 24]} />
        <meshBasicMaterial color="#7fd4ff" transparent opacity={0.15} />
      </mesh>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.42, 1]} />
        <meshPhysicalMaterial
          color="#ffffff"
          emissive="#4fb3ea"
          emissiveIntensity={0.9}
          roughness={0.2}
          metalness={0.2}
          clearcoat={0.7}
          clearcoatRoughness={0.25}
        />
      </mesh>
    </>
  )
}

function Scene({ pointer }) {
  const group = useRef(null)

  // Otomatik yavaş dönüş + fareye hafif tepki (parallax). Fare hiç hareket
  // etmese de (sunum sırasında dokunulmasa da) sahne kendi başına dönmeye devam eder.
  useFrame((state, delta) => {
    if (!group.current) return
    group.current.rotation.y += delta * 0.15
    const targetX = pointer.current.y * 0.2
    const targetZ = pointer.current.x * 0.12
    group.current.rotation.x += (targetX - group.current.rotation.x) * 0.04
    group.current.rotation.z += (targetZ - group.current.rotation.z) * 0.04
  })

  return (
    <group ref={group}>
      <BackgroundDust />
      <Core />
      {ORBITS.map((o, i) => (
        <OrbitRing key={i} {...o} />
      ))}
    </group>
  )
}

// Sol paneldeki dekoratif 3D sahne (WebGL). Saf görsel - hiçbir form state'ine
// dokunmaz. Hata durumunda (bkz. LoginPage.jsx'teki Scene3DBoundary) düz simgeye düşülür.
function Login3DScene() {
  const pointer = useRef({ x: 0, y: 0 })

  function handlePointerMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    pointer.current = {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: ((e.clientY - rect.top) / rect.height) * 2 - 1,
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }} onPointerMove={handlePointerMove}>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.3, 5.4], fov: 40 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.5} />
        <pointLight position={[3, 3, 4]} intensity={1.5} color="#ffffff" />
        <pointLight position={[-3, -1.5, -1]} intensity={0.8} color="#7fd4ff" />
        <pointLight position={[0, 0, 3]} intensity={0.5} color="#bfe8ff" />
        <Scene pointer={pointer} />
      </Canvas>
    </div>
  )
}

export default Login3DScene
