// A seated view through a 110-degree photographic panorama. The photo anchors
// keep the cup, horizon, sun and distant Sky Wheel together as the camera turns.
import { createRealisticSunMaterial } from './realistic-sun.js?v=4';
import { createTerracePlants } from './terrace-plants.js?v=4';
import { MORNING_LIGHTING_GLSL } from './morning-lighting.js?v=1';

const MORNING = {
  radius: 20,
  span: 110 * Math.PI / 180,
  sunriseSeconds: 24,
  sun: { u: 0.55, startV: 0.535, endV: 0.31 },
  wheel: { u: 0.812, v: 0.31 },
  cup: { u: 0.374, v: 0.839 },
};

const stage = document.querySelector('#morning-stage');
const canvas = document.querySelector('#morning-canvas');
const fallback = stage?.querySelector('img.morning-fallback, .morning-fallback img');
const viewButtons = [...document.querySelectorAll('[data-morning-view]')];
const replayButton = document.querySelector('#morning-replay');
const motionButton = document.querySelector('#morning-motion');
const caption = document.querySelector('#morning-caption');
const direction = document.querySelector('#morning-direction');
const preference = matchMedia('(prefers-reduced-motion: reduce)');
const deg = value => value * Math.PI / 180;

if (stage && canvas && fallback) {
  for (const button of [...viewButtons, replayButton, motionButton]) if (button) button.disabled = true;
  createMorning().catch(() => {
    stage.dataset.ready = 'false';
    stage.dataset.interactive = 'false';
    for (const button of [...viewButtons, replayButton, motionButton]) {
      if (button) { button.hidden = true; button.style.display = 'none'; }
    }
    if (direction) direction.textContent = 'A morning on your terrace';
    const help = document.querySelector('#morning-help');
    if (help) help.textContent = 'A quiet moment on the terrace.';
  });
}

async function createMorning() {
  const THREE = await import('/vendor/three.module.js');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor('#dce7e9', 1);
  renderer.debug.onShaderError = () => { throw new Error('The terrace scene could not be rendered.'); };
  let photo, cleanPhoto;
  try {
    const loader = new THREE.TextureLoader();
    [photo, cleanPhoto] = await Promise.all([
      loader.loadAsync(fallback.currentSrc || fallback.src),
      loader.loadAsync('/assets/morning-terrace-v3-cleanplate.png'),
    ]);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  for (const texture of [photo, cleanPhoto]) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  }
  const ratio = photo.image.width / photo.image.height;
  const imageHeight = MORNING.radius * MORNING.span / ratio;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  camera.rotation.order = 'YXZ';
  let terracePlants;
  try {
    terracePlants = await createTerracePlants({
      THREE, originalTexture: photo, cleanTexture: cleanPhoto,
      radius: MORNING.radius, span: MORNING.span, imageHeight,
    });
  } catch (error) {
    renderer.dispose();
    photo.dispose();
    cleanPhoto.dispose();
    throw error;
  }
  scene.add(terracePlants.group);

  const photoUniforms = {
    uMap: { value: photo }, uTime: { value: 0 },
    uCleanMap: { value: cleanPhoto }, uRemovalMap: { value: terracePlants.removalTexture },
    uDaylight: { value: preference.matches ? 1 : 0 },
    uMotion: { value: preference.matches ? 0 : 1 },
  };
  const photoMaterial = new THREE.ShaderMaterial({
    uniforms: photoUniforms, side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform sampler2D uCleanMap;
      uniform sampler2D uRemovalMap;
      uniform float uTime;
      uniform float uDaylight;
      uniform float uMotion;
      varying vec2 vUv;
      ${MORNING_LIGHTING_GLSL}
      void main() {
        vec2 uv = vUv;
        // Only the sheer fabric moves, pinned at the ceiling and clear of the jamb.
        float fabric = (1.0 - smoothstep(0.052, 0.079, uv.x)) * smoothstep(0.0, 0.008, uv.x);
        uv.x += sin(uTime * 0.6 + uv.y * 6.0) * 0.0012 * fabric * pow(1.0 - uv.y, 1.6) * uMotion;
        float removal = texture2D(uRemovalMap, vUv).r;
        vec4 color = mix(texture2D(uMap, uv), texture2D(uCleanMap, uv), removal);
        color.rgb = applyMorningLight(color.rgb, vUv, uDaylight);
        gl_FragColor = color;
        #include <colorspace_fragment>
      }
    `,
  });
  const photoGeometry = new THREE.BufferGeometry();
  const positions = [], uvs = [], indices = [];
  const columns = 144, rows = 12;
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= columns; x++) {
      const u = x / columns, v = y / rows;
      const angle = (u - 0.5) * MORNING.span;
      positions.push(Math.sin(angle) * MORNING.radius, (v - 0.5) * imageHeight, -Math.cos(angle) * MORNING.radius);
      uvs.push(u, v);
      if (x < columns && y < rows) {
        const a = y * (columns + 1) + x, b = a + 1, c = a + columns + 2, d = a + columns + 1;
        indices.push(a, b, d, b, c, d);
      }
    }
  }
  photoGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  photoGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  photoGeometry.setIndex(indices);
  const photograph = new THREE.Mesh(photoGeometry, photoMaterial);
  photograph.renderOrder = 0;
  scene.add(photograph);

  function anchoredGroup(u, v, inset = 0.13) {
    const angle = (u - 0.5) * MORNING.span;
    const radius = MORNING.radius - inset;
    const group = new THREE.Group();
    group.position.set(Math.sin(angle) * radius, (0.5 - v) * imageHeight, -Math.cos(angle) * radius);
    group.rotation.y = -angle;
    scene.add(group);
    return group;
  }
  const flatVertex = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const sunGroup = anchoredGroup(MORNING.sun.u, MORNING.sun.startV, 0.11);
  const sunSpan = 0.41;
  const sunMaterial = createRealisticSunMaterial(THREE, {
    coreRadius: 0.12, horizonV: 0.514, spanV: sunSpan,
    centerV: MORNING.sun.startV, depthTest: false,
  });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(imageHeight * sunSpan, imageHeight * sunSpan), sunMaterial);
  sun.renderOrder = 1;
  sunGroup.add(sun);

  // The photographic landmark shares the landscape's light, haze and occlusion.
  // This invisible marker keeps the view controls and diagnostics photo-anchored.
  const wheelGroup = anchoredGroup(MORNING.wheel.u, MORNING.wheel.v, 0.16);

  const steamGroup = anchoredGroup(MORNING.cup.u, MORNING.cup.v, 0.21);
  const steamUniforms = { uTime: { value: 0 } };
  const steamMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: steamUniforms, vertexShader: flatVertex,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float y = vUv.y;
        float flow = uTime * 0.64;
        float center = 0.5 + sin(y * 8.0 - flow) * (0.025 + y * 0.12);
        float width = 0.025 + y * 0.095;
        float thread = exp(-pow((vUv.x - center) / width, 2.0));
        float second = exp(-pow((vUv.x - center - 0.13 * y) / (width * 0.7), 2.0));
        float wisps = 0.64 + 0.36 * sin(y * 13.0 - flow * 1.6);
        float fade = smoothstep(0.0, 0.1, y) * (1.0 - smoothstep(0.40, 1.0, y));
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.88), (thread + second * 0.38) * fade * wisps * 0.20);
        #include <colorspace_fragment>
      }
    `,
  });
  const steamHeight = imageHeight * 0.15;
  const steam = new THREE.Mesh(new THREE.PlaneGeometry(imageHeight * 0.073, steamHeight), steamMaterial);
  steam.position.y = steamHeight / 2;
  steam.renderOrder = 6;
  steamGroup.add(steam);

  let width = 1, height = 1;
  let yaw = deg(-5), targetYaw = yaw;
  let pitch = 0, targetPitch = 0;
  let maximumYaw = deg(23), minimumYaw = deg(-18), wheelYaw = deg(22);
  let wheelThreshold = deg(12);
  let time = 0;
  let sunrise = preference.matches ? MORNING.sunriseSeconds : 0;
  let paused = preference.matches;
  let visible = false;
  let contextLost = false;
  let frame = 0, previous = 0;
  let activeView = 'sunrise';
  let pointer = null;
  let manualUntil = 0;
  const initialCaption = caption?.innerHTML || 'Coffee. Quiet.<br>A new beginning.';
  const initialDirection = direction?.textContent || 'Facing the sunrise';

  function syncMotion() {
    stage.dataset.motion = paused ? 'paused' : 'playing';
    if (motionButton) {
      motionButton.setAttribute('aria-pressed', String(paused));
      motionButton.setAttribute('aria-label', paused ? 'Play terrace animation' : 'Pause terrace animation');
      const label = motionButton.querySelector('span');
      if (label) label.textContent = paused ? 'Play' : 'Pause';
      const path = motionButton.querySelector('path');
      if (path) path.setAttribute('d', paused ? 'm9 5 10 7-10 7Z' : 'M9 5v14M15 5v14');
    }
  }
  function describeView(view) {
    if (view === activeView && stage.dataset.view) return;
    activeView = view;
    stage.dataset.view = view;
    viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.morningView === view)));
    if (caption) caption.innerHTML = view === 'wonderla' ? 'A little wonder.<br>On the horizon.' : initialCaption;
    if (direction) direction.textContent = view === 'wonderla' ? 'Looking right · Wonderla Sky Wheel' : initialDirection;
  }
  function render() {
    if (contextLost) return;
    const progress = Math.min(sunrise / MORNING.sunriseSeconds, 1);
    const lifted = progress * progress * (3 - 2 * progress);
    const sunV = MORNING.sun.startV + (MORNING.sun.endV - MORNING.sun.startV) * lifted;
    sunGroup.position.y = (0.5 - sunV) * imageHeight;
    sunMaterial.uniforms.uCenterV.value = sunV;
    sunMaterial.uniforms.uDaylight.value = lifted;
    photoUniforms.uTime.value = time;
    photoUniforms.uDaylight.value = lifted;
    steamUniforms.uTime.value = time;
    terracePlants.update({ time, daylight: lifted, motion: photoUniforms.uMotion.value });
    camera.rotation.y = -yaw;
    camera.rotation.x = pitch;
    renderer.render(scene, camera);
  }
  function cameraMoving() { return Math.abs(yaw - targetYaw) + Math.abs(pitch - targetPitch) > 0.00008; }
  function tick(now) {
    frame = 0;
    if (!visible || document.hidden || contextLost) { previous = 0; return; }
    const delta = previous ? Math.min((now - previous) / 1000, 0.07) : 0;
    previous = now;
    if (!paused) { time += delta; sunrise = Math.min(MORNING.sunriseSeconds, sunrise + delta); }
    const ease = preference.matches ? 1 : 1 - Math.exp(-delta * 4.4);
    yaw += (targetYaw - yaw) * ease;
    pitch += (targetPitch - pitch) * ease;
    render();
    if (!paused || cameraMoving()) frame = requestAnimationFrame(tick);
    else previous = 0;
  }
  function schedule() {
    if (!frame && visible && !document.hidden && !contextLost && (!paused || cameraMoving())) frame = requestAnimationFrame(tick);
  }
  function suspend() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
  }
  function aim(nextYaw, nextPitch = 0, announce = true) {
    targetYaw = THREE.MathUtils.clamp(nextYaw, minimumYaw, maximumYaw);
    targetPitch = THREE.MathUtils.clamp(nextPitch, deg(-0.6), deg(0.6));
    if (preference.matches) { yaw = targetYaw; pitch = targetPitch; render(); }
    if (announce) describeView(targetYaw > wheelThreshold ? 'wonderla' : 'sunrise');
    schedule();
  }
  function selectView(view) {
    manualUntil = performance.now() + 1600;
    aim(view === 'wonderla' ? wheelYaw : deg(-5), 0, false);
    describeView(view);
  }
  function setPaused(value) {
    paused = Boolean(value);
    if (paused && !cameraMoving()) suspend();
    else schedule();
    syncMotion();
  }
  function replay() {
    sunrise = 0;
    photoUniforms.uMotion.value = 1;
    setPaused(false);
    selectView('sunrise');
    render();
  }
  function resize() {
    const bounds = stage.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const halfView = Math.atan(Math.tan(deg(camera.fov / 2)) * camera.aspect);
    const limit = Math.max(deg(6), MORNING.span / 2 - halfView - deg(1.8));
    maximumYaw = Math.min(deg(39), limit);
    minimumYaw = -Math.min(deg(18), limit);
    wheelYaw = Math.min(maximumYaw, width < 760 ? deg(35) : deg(22));
    const wheelBearing = (MORNING.wheel.u - 0.5) * MORNING.span;
    wheelThreshold = Math.min(wheelYaw * 0.9, Math.max(deg(12), wheelBearing - halfView + deg(1.5)));
    targetYaw = activeView === 'wonderla' ? wheelYaw : THREE.MathUtils.clamp(targetYaw, minimumYaw, maximumYaw);
    yaw = THREE.MathUtils.clamp(yaw, minimumYaw, maximumYaw);
    render();
    schedule();
  }

  // A failed first GPU frame must leave no active observers or animation loop.
  resize();

  viewButtons.forEach(button => button.addEventListener('click', () => selectView(button.dataset.morningView)));
  replayButton?.addEventListener('click', replay);
  motionButton?.addEventListener('click', () => {
    if (paused) photoUniforms.uMotion.value = 1;
    setPaused(!paused);
  });
  stage.addEventListener('keydown', event => {
    if (event.target !== stage) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    manualUntil = performance.now() + 1600;
    if (event.key === 'Home') selectView('sunrise');
    else if (event.key === 'End') selectView('wonderla');
    else aim(targetYaw + deg(event.key === 'ArrowRight' ? 6 : -6), 0);
  });
  stage.addEventListener('pointerdown', event => {
    if (event.target.closest('button, a, input, select')) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: targetYaw, dragging: false };
  });
  stage.addEventListener('pointermove', event => {
    if (pointer && event.pointerType === 'mouse' && event.buttons === 0) release(event);
    if (event.target.closest('button, a, input, select') && !pointer?.dragging) return;
    const bounds = stage.getBoundingClientRect();
    if (pointer && pointer.id === event.pointerId) {
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (!pointer.dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        pointer.dragging = true;
        stage.setPointerCapture(event.pointerId);
        stage.dataset.dragging = 'true';
      }
      if (pointer.dragging) {
        manualUntil = performance.now() + 1000;
        aim(pointer.yaw - dx / width * deg(58), 0);
      }
      return;
    }
    if (event.pointerType !== 'mouse' || preference.matches || performance.now() < manualUntil) return;
    const x = THREE.MathUtils.clamp((event.clientX - bounds.left) / width * 2 - 1, -1, 1);
    const y = THREE.MathUtils.clamp((event.clientY - bounds.top) / height * 2 - 1, -1, 1);
    const next = deg(-5) + (x < 0 ? x * deg(10) : x * (wheelYaw + deg(5)));
    aim(next, -y * deg(0.6));
  }, { passive: true });
  function release(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    pointer = null;
    stage.dataset.dragging = 'false';
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('lostpointercapture', () => { pointer = null; stage.dataset.dragging = 'false'; });
  stage.addEventListener('pointerleave', () => {
    if (pointer && !pointer.dragging) pointer = null;
    if (!pointer) { targetPitch = 0; schedule(); }
  });
  preference.addEventListener('change', () => {
    if (preference.matches) {
      sunrise = MORNING.sunriseSeconds;
      photoUniforms.uMotion.value = 0;
      yaw = targetYaw;
      pitch = targetPitch = 0;
      setPaused(true);
      render();
    } else { photoUniforms.uMotion.value = 1; setPaused(false); }
  });
  document.addEventListener('visibilitychange', () => document.hidden ? suspend() : schedule());
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) schedule();
    else suspend();
  }, { threshold: 0.01 });
  observer.observe(stage);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    suspend();
    stage.dataset.ready = 'false';
    for (const button of [...viewButtons, replayButton, motionButton]) if (button) button.disabled = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    resize();
    stage.dataset.ready = 'true';
    for (const button of [...viewButtons, replayButton, motionButton]) if (button) button.disabled = false;
    schedule();
  });

  syncMotion();
  describeView('sunrise');
  stage.dataset.ready = 'true';
  stage.dataset.interactive = 'true';
  for (const button of [...viewButtons, replayButton, motionButton]) if (button) button.disabled = false;
  window.__elaraMorning = {
    selectView, replay, setPaused,
    getState: () => {
      const project = object => {
        const point = object.getWorldPosition(new THREE.Vector3()).project(camera);
        return { x: (point.x + 1) / 2, y: (1 - point.y) / 2, visible: Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && point.z < 1 };
      };
      return { paused, visible, running: Boolean(frame), contextLost, reducedMotion: preference.matches,
        time, sunrise, yaw: yaw / deg(1), targetYaw: targetYaw / deg(1), pitch: pitch / deg(1),
        view: activeView, width, height, plants: terracePlants.getState?.(),
        cup: project(steamGroup), wheel: project(wheelGroup), sun: project(sunGroup) };
    },
  };
}
