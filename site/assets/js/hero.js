// Home page hero: thousands of particles assemble into the SessionForge mark (four isolated window panes),
// break apart and come back. They drift away from the pointer, and the shape disperses as you scroll
// past the hero. three.js is self-hosted (assets/vendor/three/) and loaded only when the animation runs.
// Never starts with prefers-reduced-motion: reduce or without WebGL; the CSS still (.hero-still) stays then.

const hero = document.querySelector('[data-hero]')
const canvas = hero && hero.querySelector('.hero-canvas')
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch {
    return false
  }
}

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uMorph;
uniform float uSize;
uniform float uPixelRatio;
uniform vec3 uPointer;
uniform float uPointerStrength;
attribute vec3 aTarget;
attribute vec3 aScatter;
attribute float aSeed;
varying float vAlpha;
varying float vAccent;
void main() {
  // Staggered so the panes peel apart instead of popping
  float m = smoothstep(0.0, 1.0, clamp(uMorph * 1.3 - aSeed * 0.3, 0.0, 1.0));
  vec3 p = mix(aTarget, aScatter, m);
  float wob = 0.025 + m * 0.18;
  p += wob * vec3(sin(uTime * 1.3 + aSeed * 40.0), cos(uTime * 1.1 + aSeed * 31.0), sin(uTime * 0.9 + aSeed * 23.0));
  vec4 world = modelMatrix * vec4(p, 1.0);
  vec2 d = world.xy - uPointer.xy;
  float dist2 = dot(d, d);
  world.xy += normalize(d + vec2(1e-4)) * uPointerStrength * exp(-dist2 * 1.1) * 0.85;
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPixelRatio * (0.55 + fract(aSeed * 13.0) * 0.9) * (12.0 / -mv.z);
  vAlpha = mix(1.0, 0.5, m) * (0.5 + 0.5 * fract(aSeed * 7.0));
  vAccent = step(0.975, fract(aSeed * 91.0));
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uOpacity;
varying float vAlpha;
varying float vAccent;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.05, r);
  gl_FragColor = vec4(mix(uColor, uAccent, vAccent * 0.8), a * vAlpha * uOpacity);
}
`

/** Points along a rounded rectangle outline (centre cx, cy; half sizes hw, hh; corner radius r). */
function roundedRect(cx, cy, hw, hh, r, t) {
  const sx = 2 * (hw - r)
  const sy = 2 * (hh - r)
  const arc = (Math.PI / 2) * r
  const total = 2 * sx + 2 * sy + 4 * arc
  let d = t * total
  const seg = [
    [sx, (u) => [cx - hw + r + u * sx, cy + hh]],
    [arc, (u) => { const a = Math.PI / 2 - u * (Math.PI / 2); return [cx + hw - r + Math.cos(a) * r, cy + hh - r + Math.sin(a) * r] }],
    [sy, (u) => [cx + hw, cy + hh - r - u * sy]],
    [arc, (u) => { const a = -u * (Math.PI / 2); return [cx + hw - r + Math.cos(a) * r, cy - hh + r + Math.sin(a) * r] }],
    [sx, (u) => [cx + hw - r - u * sx, cy - hh]],
    [arc, (u) => { const a = -Math.PI / 2 - u * (Math.PI / 2); return [cx - hw + r + Math.cos(a) * r, cy - hh + r + Math.sin(a) * r] }],
    [sy, (u) => [cx - hw, cy - hh + r + u * sy]],
    [arc, (u) => { const a = Math.PI - u * (Math.PI / 2); return [cx - hw + r + Math.cos(a) * r, cy + hh - r + Math.sin(a) * r] }]
  ]
  for (const [len, fn] of seg) {
    if (d <= len) return fn(len ? d / len : 0)
    d -= len
  }
  return seg[0][1](0)
}

/** The mark: a 2x2 grid of panes, each with a title bar line and three dots, in a unit-ish square. */
function buildShape(count) {
  const target = new Float32Array(count * 3)
  const scatter = new Float32Array(count * 3)
  const seed = new Float32Array(count)
  const half = 0.86
  const gap = 0.22
  const centres = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([x, y]) => [x * (half + gap / 2), y * (half + gap / 2)])
  const lines = []
  for (let i = 0; i < count; i++) {
    const [cx, cy] = centres[i % 4]
    const k = Math.random()
    let x
    let y
    let z = (Math.random() - 0.5) * 0.08
    if (k < 0.62) {
      ;[x, y] = roundedRect(cx, cy, half, half, 0.26, Math.random())
      const j = (Math.random() - 0.5) * 0.035
      x += j
      y += j
    } else if (k < 0.74) {
      // Title bar separator
      x = cx - half + 0.08 + Math.random() * (2 * half - 0.16)
      y = cy + half - 0.42 + (Math.random() - 0.5) * 0.02
    } else if (k < 0.84) {
      // Three dots in the title bar
      const dot = Math.floor(Math.random() * 3)
      const a = Math.random() * Math.PI * 2
      const rr = Math.sqrt(Math.random()) * 0.06
      x = cx - half + 0.26 + dot * 0.2 + Math.cos(a) * rr
      y = cy + half - 0.22 + Math.sin(a) * rr
    } else {
      // Sparse page content: a few text lines
      const row = Math.floor(Math.random() * 4)
      const w = [1.0, 0.75, 0.9, 0.5][row]
      x = cx - half + 0.24 + Math.random() * (2 * half - 0.48) * w
      y = cy + half - 0.7 - row * 0.24
      z *= 0.5
    }
    target.set([x, y, z], i * 3)
    // Scatter: a wide shell, biased outwards from the pane it belongs to
    const u = Math.random() * 2 - 1
    const th = Math.random() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    const rad = 3.2 + Math.random() * 4.5
    scatter.set([cx * 1.2 + s * Math.cos(th) * rad, cy * 1.2 + u * rad * 0.8, s * Math.sin(th) * rad - 1.5], i * 3)
    seed[i] = Math.random()
  }
  // Outline wireframe for the lines layer
  for (const [cx, cy] of centres) {
    const steps = 64
    for (let s = 0; s < steps; s++) {
      const a = roundedRect(cx, cy, half, half, 0.26, s / steps)
      const b = roundedRect(cx, cy, half, half, 0.26, (s + 1) / steps)
      lines.push(a[0], a[1], 0, b[0], b[1], 0)
    }
    lines.push(cx - half, cy + half - 0.42, 0, cx + half, cy + half - 0.42, 0)
  }
  return { target, scatter, seed, lines: new Float32Array(lines) }
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
/** 0 = assembled, 1 = scattered, on an 11 s loop. */
function cycle(t) {
  const p = t % 11
  if (p < 4.5) return 0
  if (p < 6.7) return ease((p - 4.5) / 2.2)
  if (p < 8.3) return 1
  return 1 - ease((p - 8.3) / 2.7)
}

async function start() {
  const THREE = await import('../vendor/three/three.module.min.js')
  const mobile = window.matchMedia('(max-width: 767px)').matches
  const count = mobile ? 2600 : 7000

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'default' })
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
  camera.position.set(0, 0, 12)

  const shape = buildShape(count)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(shape.target, 3))
  geo.setAttribute('aTarget', new THREE.BufferAttribute(shape.target, 3))
  geo.setAttribute('aScatter', new THREE.BufferAttribute(shape.scatter, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(shape.seed, 1))
  const uniforms = {
    uTime: { value: 0 },
    uMorph: { value: 0 },
    uSize: { value: mobile ? 2.2 : 2.6 },
    uPixelRatio: { value: 1 },
    uPointer: { value: new THREE.Vector3(99, 99, 0) },
    uPointerStrength: { value: 0 },
    uColor: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uOpacity: { value: mobile ? 0.7 : 0.95 }
  }
  const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, transparent: true, depthWrite: false })
  const points = new THREE.Points(geo, material)
  points.frustumCulled = false
  const lineGeo = new THREE.BufferGeometry()
  lineGeo.setAttribute('position', new THREE.BufferAttribute(shape.lines, 3))
  const lineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false })
  const lines = new THREE.LineSegments(lineGeo, lineMat)
  const group = new THREE.Group()
  group.add(lines, points)
  scene.add(group)

  function applyTheme() {
    const light = document.documentElement.getAttribute('data-theme') === 'light'
    uniforms.uColor.value.set(light ? '#0a0a0a' : '#ededed')
    uniforms.uAccent.value.set(light ? '#0e7490' : '#57d8e2')
    lineMat.color.set(light ? '#0a0a0a' : '#ededed')
    material.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending
    material.needsUpdate = true
  }
  applyTheme()
  const themeObserver = new MutationObserver(applyTheme)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  let baseX = 0
  let baseScale = 1
  function resize() {
    const w = hero.clientWidth
    const h = hero.clientHeight
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    uniforms.uPixelRatio.value = renderer.getPixelRatio()
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    const visH = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z
    const visW = visH * camera.aspect
    if (w >= 1024) {
      // Beside the copy, in the right part of the hero
      // The mark spans about +-1.85 units before scaling: keep it inside the hero height and right of the copy
      baseScale = Math.min(visH * 0.2, visW * 0.11)
      baseX = Math.min(visW * 0.235, visW / 2 - baseScale * 2.2)
    } else {
      baseScale = Math.min(visH * 0.16, visW * 0.24)
      baseX = 0
    }
    group.scale.setScalar(baseScale)
  }
  resize()
  window.addEventListener('resize', resize)

  // Pointer, in hero-relative NDC, projected onto the z = 0 plane
  const ndc = new THREE.Vector2(0, 0)
  let pointerIn = false
  const ray = new THREE.Raycaster()
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  const hit = new THREE.Vector3()
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    pointerIn = true
  })
  hero.addEventListener('pointerleave', () => {
    pointerIn = false
  })

  let running = false
  let visible = true
  let raf = 0
  let last = performance.now()
  let t = 0
  let rotX = 0
  let rotY = 0
  window.__sfHeroFrames = 0
  function frame(now) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    t += dt
    const r = hero.getBoundingClientRect()
    const scroll = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height * 0.8)))
    uniforms.uTime.value = t
    uniforms.uMorph.value = Math.max(cycle(t), scroll)
    lineMat.opacity = 0.16 * (1 - uniforms.uMorph.value)
    rotY += ((pointerIn ? ndc.x * 0.35 : 0) + Math.sin(t * 0.25) * 0.18 - rotY) * 0.05
    rotX += ((pointerIn ? -ndc.y * 0.22 : 0) + scroll * 0.5 - rotX) * 0.05
    group.rotation.set(rotX, rotY, 0)
    group.position.set(baseX, scroll * 1.2, 0)
    if (pointerIn) {
      ray.setFromCamera(ndc, camera)
      if (ray.ray.intersectPlane(plane, hit)) uniforms.uPointer.value.copy(hit)
    }
    uniforms.uPointerStrength.value += ((pointerIn ? 1 : 0) - uniforms.uPointerStrength.value) * 0.06
    renderer.render(scene, camera)
    window.__sfHeroFrames++
    if (window.__sfHeroFrames === 2) document.documentElement.classList.add('hero-live')
  }
  function update() {
    const should = visible && !document.hidden && !reduceMotion.matches
    if (should && !running) {
      running = true
      last = performance.now()
      raf = requestAnimationFrame(frame)
    } else if (!should && running) {
      running = false
      cancelAnimationFrame(raf)
    }
  }
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting
    update()
  }).observe(hero)
  document.addEventListener('visibilitychange', update)
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) document.documentElement.classList.remove('hero-live')
    update()
  })
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    running = false
    cancelAnimationFrame(raf)
    document.documentElement.classList.remove('hero-live')
  })
  update()
}

if (hero && canvas && !reduceMotion.matches && webglAvailable()) {
  const go = () => start().catch(() => document.documentElement.classList.remove('hero-live'))
  // After first paint and the page's own work
  const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 1500 }) : setTimeout(go, 200))
  if (document.readyState === 'complete') idle()
  else window.addEventListener('load', idle, { once: true })
}
