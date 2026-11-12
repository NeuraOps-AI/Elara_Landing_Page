// The architecture stays still; only the sun, planted greenery and
// falling leaves move. One clock keeps every effect in sync with
// pause, reduced motion and visibility. The DOM image is a static fallback.
import { SUNRISE_LIGHTING_GLSL } from './sunrise-lighting.js?v=4';
import { createRealisticSunMaterial } from './realistic-sun.js?v=4';

const hero = document.querySelector('.sunrise-hero');
const canvas = document.querySelector('#sunrise-canvas');
const image = document.querySelector('.sunrise-villas');
const replayButton = document.querySelector('#replay-sunrise');
const motionButton = document.querySelector('#toggle-motion');
const status = document.querySelector('#scene-status');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

if (hero && canvas && image) {
  startScene().catch(() => {
    hero.dataset.sceneReady = 'false';
    if (status) status.textContent = 'A quieter kind of morning';
    for (const button of [replayButton, motionButton]) {
      if (button) { button.hidden = true; button.style.display = 'none'; }
    }
  });
}

async function startScene() {
  const THREE = await import('/vendor/three.module.js');
  const renderer = new THREE.WebGLRenderer({
    canvas, alpha: true, antialias: true, powerPreference: 'low-power',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.debug.onShaderError = () => {
    throw new Error('The animated scene is unavailable on this graphics device.');
  };

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -100, 100);
  camera.position.z = 10;
  const loader = new THREE.TextureLoader();
  let villaTexture;
  let cleanTexture;
  let createPlantWind;
  try {
    const textures = await Promise.all([
      loader.loadAsync(image.currentSrc || image.src),
      loader.loadAsync('/assets/villa-sunrise-cleanplate.png'),
      import('/plant-wind.js?v=4'),
    ]);
    [villaTexture, cleanTexture] = textures;
    ({ createPlantWind } = textures[2]);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  for (const texture of [villaTexture, cleanTexture]) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
  }
  let plantWind;
  try {
    plantWind = await createPlantWind({ THREE, originalTexture: villaTexture, cleanTexture });
  } catch (error) {
    renderer.dispose();
    villaTexture.dispose();
    cleanTexture.dispose();
    throw error;
  }
  scene.add(plantWind.group);

  const sharedVertex = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const villaMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uMap: { value: villaTexture },
      uCleanMap: { value: cleanTexture },
      uRemovalMap: { value: plantWind.removalTexture },
      uDaylight: { value: reducedMotion.matches ? 1 : 0 },
      uWind: { value: reducedMotion.matches ? 0 : 1 },
    },
    vertexShader: sharedVertex,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform sampler2D uCleanMap;
      uniform sampler2D uRemovalMap;
      uniform float uDaylight;
      varying vec2 vUv;
      ${SUNRISE_LIGHTING_GLSL}
      void main() {
        // Replace only the extracted plants. Architecture and window reflections
        // always use the unchanged original photograph at unchanged UVs.
        float removal = texture2D(uRemovalMap, vUv).r;
        vec4 color = mix(texture2D(uMap, vUv), texture2D(uCleanMap, vUv), removal);
        color.rgb = applySunriseLight(color.rgb, uDaylight);
        gl_FragColor = color;
        #include <colorspace_fragment>
      }
    `,
  });
  const plane = new THREE.PlaneGeometry(1, 1);
  const villa = new THREE.Mesh(plane, villaMaterial);
  villa.renderOrder = 2;
  scene.add(villa);

  const sunMaterial = createRealisticSunMaterial(THREE);
  const sun = new THREE.Mesh(plane, sunMaterial);
  sun.renderOrder = 0;
  sun.position.z = -2;
  scene.add(sun);

  // Reusable leaf silhouettes with a folded surface, soft edges and a fine vein.
  const leafMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTint: { value: new THREE.Color('#69713a') },
      uOpacity: { value: 0.89 },
    },
    vertexShader: sharedVertex,
    fragmentShader: `
      uniform vec3 uTint;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float y = vUv.y;
        float center = 0.5 + 0.11 * sin(y * 3.14159);
        float edge = pow(max(0.0, sin(y * 3.14159)), 0.85) * 0.43;
        float distance = abs(vUv.x - center);
        float alpha = (1.0 - smoothstep(edge - 0.025, edge + 0.018, distance))
                      * smoothstep(0.0, 0.035, y) * (1.0 - smoothstep(0.965, 1.0, y));
        float fold = smoothstep(center - 0.03, center + 0.07, vUv.x);
        vec3 color = uTint * (0.77 + 0.38 * fold + 0.14 * sin(y * 3.14159));
        float vein = 1.0 - smoothstep(0.007, 0.018, distance);
        color += vec3(0.035, 0.036, 0.009) * vein;
        gl_FragColor = vec4(color, alpha * uOpacity);
        #include <colorspace_fragment>
      }
    `,
  });
  // Small, staggered leaves drift away from planted terraces and tree crowns.
  // Reuse the existing leaf geometry/shader instead of loading particle assets.
  const fallingLeaves = [];
  const leafColors = ['#6b793d', '#8d914e', '#a48b49', '#526638'];
  const leafSources = [
    { x: 0.11, y: 0.30 }, // main villa's terrace planting
    { x: 0.48, y: 0.68 }, // flowering tree in front of the main villa
    { x: 0.63, y: 0.42 }, // next planted balcony
    { x: 0.78, y: 0.71 }, // next street tree
  ];
  for (let i = 0; i < 14; i++) {
    const material = leafMaterial.clone();
    material.uniforms.uTint.value.set(leafColors[i % leafColors.length]);
    material.uniforms.uOpacity.value = 0;
    const leaf = new THREE.Mesh(plane, material);
    leaf.renderOrder = 6;
    leaf.position.z = 3 + i * 0.002;
    leaf.visible = false;
    scene.add(leaf);
    fallingLeaves.push({
      leaf,
      source: leafSources[i % leafSources.length],
      phase: (i * 0.61803398875) % 1,
      lifetime: 9 + (i % 5) * 1.7,
      length: 13 + (i % 4) * 3,
      offset: Math.sin(i * 2.4),
      spin: (i % 2 ? 1 : -1) * (1.5 + (i % 3) * 0.6),
    });
  }

  let width = 1;
  let height = 1;
  let imageBox = { left: 0, top: 0, width: 1, height: 1 };
  let elapsed = reducedMotion.matches ? 16 : 0;
  let windTime = 0;
  let paused = reducedMotion.matches;
  let visible = true;
  let contextLost = false;
  let frame = 0;
  let previous = 0;
  let pointerX = 0;
  let pointerY = 0;
  let driftX = 0;
  let driftY = 0;
  let completed = false;
  let atmosphereStep = -1;
  const duration = 16;

  function syncButtons() {
    if (motionButton) {
      motionButton.setAttribute('aria-pressed', String(paused));
      motionButton.setAttribute('aria-label', paused ? 'Play scene animation' : 'Pause scene animation');
      const label = motionButton.querySelector('[data-motion-label]');
      if (label) label.textContent = paused ? 'Play motion' : 'Pause motion';
    }
    if (status) status.textContent = paused ? 'Morning, at your pace' : elapsed < duration ? 'Sunrise in motion' : 'A little sun. A gentle breeze.';
    hero.dataset.motion = paused ? 'paused' : 'playing';
  }

  function positionScene() {
    const r = canvas.getBoundingClientRect();
    width = Math.max(1, r.width);
    height = Math.max(1, r.height);
    renderer.setSize(width, height, false);
    camera.right = width;
    camera.top = height;
    camera.updateProjectionMatrix();
    const b = image.getBoundingClientRect();
    const css = getComputedStyle(image);
    const ratio = villaTexture.image.width / villaTexture.image.height;
    let iw = b.width;
    let ih = b.height;
    let ix = b.left - r.left;
    let iy = b.top - r.top;
    if (css.objectFit === 'contain' && Math.abs(iw / ih - ratio) > 0.01) {
      const fittedWidth = Math.min(iw, ih * ratio);
      const fittedHeight = fittedWidth / ratio;
      ix += (iw - fittedWidth) / 2;
      iy += (ih - fittedHeight) * (css.objectPosition.includes('100%') || css.objectPosition.includes('bottom') ? 1 : 0.5);
      iw = fittedWidth;
      ih = fittedHeight;
    }
    imageBox = { left: ix, top: iy, width: iw, height: ih };
    plantWind.resize({ ...imageBox, canvasHeight: height });
    villa.scale.set(iw, ih, 1);
    villa.position.set(ix + iw / 2, height - iy - ih / 2, 0);
    const haloSize = Math.max(320, Math.min(1100, iw * 0.78));
    sun.scale.set(haloSize, haloSize, 1);
    render();
  }

  function render() {
    if (contextLost) return;
    const t = Math.min(elapsed / duration, 1);
    const progress = 1 - Math.pow(1 - t, 2.2);
    // CSS sky layers share the sun's elevation clock. Quantization avoids
    // style writes on every wind frame once the sunrise has settled.
    const nextAtmosphereStep = Math.round(progress * 200);
    if (nextAtmosphereStep !== atmosphereStep) {
      atmosphereStep = nextAtmosphereStep;
      const elevation = atmosphereStep / 200;
      const dawn = 1 - THREE.MathUtils.smoothstep(elevation, 0.08, 0.80);
      const golden = THREE.MathUtils.smoothstep(elevation, 0.12, 0.40)
        * (1 - THREE.MathUtils.smoothstep(elevation, 0.50, 0.95));
      hero.style.setProperty('--dawn-opacity', dawn.toFixed(3));
      hero.style.setProperty('--golden-opacity', golden.toFixed(3));
    }
    villaMaterial.uniforms.uDaylight.value = progress;
    const gust = 0.9 + Math.sin(windTime * 0.37) * 0.18 + Math.sin(windTime * 0.79) * 0.1;
    plantWind.update({ time: windTime, wind: villaMaterial.uniforms.uWind.value, gust, daylight: progress });
    sunMaterial.uniforms.uDaylight.value = progress;
    sun.position.x = imageBox.left + imageBox.width * 0.57 + driftX * 2;
    sun.position.y = height - (imageBox.top + imageBox.height * (0.44 - progress * 0.32)) + driftY * 2;

    const airborne = villaMaterial.uniforms.uWind.value > 0;
    const mobile = width < 600;
    const maxLeaves = mobile ? 8 : fallingLeaves.length;
    // Remap cropped canopies to a visible planted area, never to the copy column.
    const leftBound = Math.max(mobile ? width * 0.08 : width * 0.48, imageBox.left + imageBox.width * 0.08);
    const rightBound = width - 20;
    const roadY = Math.min(height - 55, imageBox.top + imageBox.height * 0.95);
    fallingLeaves.forEach(({ leaf, source, phase, lifetime, length, offset, spin }, i) => {
      leaf.visible = airborne && i < maxLeaves;
      if (!leaf.visible) return;
      const progress = (windTime / lifetime + phase) % 1;
      const startX = THREE.MathUtils.clamp(imageBox.left + imageBox.width * source.x, leftBound, rightBound);
      const startY = imageBox.top + imageBox.height * source.y;
      const fallDistance = Math.max(65, roadY - startY);
      const flutter = Math.sin(progress * Math.PI * 5 + phase * Math.PI * 2);
      // Drift develops after release; each leaf falls at its own pace.
      const travel = Math.pow(progress, 1.15);
      const sway = Math.sin(progress * Math.PI * 3.5 + phase * 4) * 22 * Math.sin(progress * Math.PI);
      leaf.position.x = startX + offset * 13 + travel * (mobile ? 32 : 65) + sway;
      leaf.position.y = height - (startY + travel * fallDistance + flutter * 5 * Math.sin(progress * Math.PI));
      leaf.rotation.set(Math.sin(windTime * 1.4 + phase * 6) * 0.45,
        Math.sin(windTime * 1.1 + phase * 9) * 0.95,
        phase * Math.PI * 2 + progress * spin + flutter * 0.35);
      const size = length * (mobile ? 0.78 : 1) * (0.9 + progress * 0.15);
      leaf.scale.set(size * 0.55, size, 1);
      const fadeIn = THREE.MathUtils.smoothstep(progress, 0, 0.1);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.79, 1);
      leaf.material.uniforms.uOpacity.value = fadeIn * fadeOut * 0.86;
    });
    renderer.render(scene, camera);
  }

  function tick(now) {
    frame = 0;
    if (paused || !visible || document.hidden || contextLost) { previous = 0; return; }
    const delta = previous ? Math.min((now - previous) / 1000, 0.06) : 0;
    previous = now;
    elapsed = Math.min(duration, elapsed + delta);
    windTime += delta;
    driftX += (pointerX - driftX) * 0.035;
    driftY += (pointerY - driftY) * 0.035;
    render();
    if (elapsed === duration && !completed) { completed = true; syncButtons(); }
    frame = requestAnimationFrame(tick);
  }

  function schedule() {
    if (!frame && !paused && visible && !document.hidden && !contextLost) frame = requestAnimationFrame(tick);
  }
  function suspend() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
  }
  function setPaused(value) {
    paused = Boolean(value);
    if (paused) suspend();
    else schedule();
    syncButtons();
  }
  function replay() {
    elapsed = 0;
    completed = false;
    villaMaterial.uniforms.uWind.value = 1;
    setPaused(false);
    render();
  }

  motionButton?.addEventListener('click', () => {
    // Explicit playback is allowed even when the system prefers less motion.
    if (paused) villaMaterial.uniforms.uWind.value = 1;
    setPaused(!paused);
  });
  replayButton?.addEventListener('click', replay);
  hero.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || reducedMotion.matches) return;
    const r = hero.getBoundingClientRect();
    pointerX = (event.clientX - r.left) / r.width - 0.5;
    pointerY = (event.clientY - r.top) / r.height - 0.5;
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { pointerX = 0; pointerY = 0; });
  document.addEventListener('visibilitychange', () => document.hidden ? suspend() : schedule());
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      elapsed = duration;
      windTime = 0;
      driftX = 0;
      driftY = 0;
      villaMaterial.uniforms.uWind.value = 0;
      setPaused(true);
      render();
    } else {
      villaMaterial.uniforms.uWind.value = 1;
      setPaused(false);
    }
  });
  const intersection = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) schedule();
    else suspend();
  }, { threshold: 0 });
  intersection.observe(hero);
  const resize = new ResizeObserver(positionScene);
  resize.observe(canvas.parentElement);
  resize.observe(image);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    suspend();
    hero.dataset.sceneReady = 'false';
    if (status) status.textContent = 'A quieter kind of morning';
    for (const button of [replayButton, motionButton]) {
      if (button) { button.hidden = true; button.style.display = 'none'; }
    }
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    positionScene();
    hero.dataset.sceneReady = 'true';
    for (const button of [replayButton, motionButton]) {
      if (button) { button.hidden = false; button.style.removeProperty('display'); }
    }
    syncButtons();
    schedule();
  });

  positionScene();
  syncButtons();
  // Hide the DOM fallback only after the texture loaded and a frame rendered.
  hero.dataset.sceneReady = 'true';
  if (replayButton) replayButton.disabled = false;
  if (motionButton) motionButton.disabled = false;
  schedule();
  window.__elaraScene = {
    replay, setPaused,
    getState: () => ({ paused, elapsed, windTime, visible, contextLost, reducedMotion: reducedMotion.matches, running: Boolean(frame), width, height, plants: plantWind.getState() }),
  };
}
