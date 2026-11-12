// Photo-derived foreground planting projected onto the terrace panorama.
// Regions use normalized source-image coordinates (origin at the top left).
// The cleanplate is visible only where the original foliage has been removed.
import { MORNING_LIGHTING_GLSL } from './morning-lighting.js?v=1';
const LEFT_BED = [
  [0.151,0.749],[0.151,0.615],[0.158,0.552],[0.170,0.540],
  [0.186,0.571],[0.200,0.576],[0.208,0.537],[0.226,0.529],
  [0.243,0.567],[0.259,0.570],[0.276,0.618],[0.286,0.633],
  [0.295,0.582],[0.313,0.579],[0.331,0.633],[0.346,0.639],
  [0.359,0.668],[0.374,0.666],[0.384,0.714],[0.384,0.754],
];
const RIGHT_BED = [
  [0.685,0.755],[0.691,0.714],[0.707,0.702],[0.713,0.654],
  [0.730,0.649],[0.747,0.672],[0.758,0.606],[0.772,0.580],
  [0.791,0.585],[0.799,0.637],[0.810,0.610],[0.824,0.622],
  [0.828,0.586],[0.847,0.579],[0.862,0.597],[0.875,0.622],
  [0.893,0.618],[0.905,0.590],[0.921,0.558],[0.943,0.558],
  [0.956,0.615],[0.963,0.643],[0.980,0.644],[0.985,0.733],
  [0.985,0.791],[0.942,0.780],[0.900,0.772],[0.850,0.764],
  [0.800,0.760],[0.750,0.757],
];

function clipAtX(polygon, boundary, keepRight) {
  const output = [];
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i], previous = polygon[(i + polygon.length - 1) % polygon.length];
    const inside = keepRight ? current[0] >= boundary : current[0] <= boundary;
    const previousInside = keepRight ? previous[0] >= boundary : previous[0] <= boundary;
    if (inside !== previousInside) {
      const t = (boundary - previous[0]) / (current[0] - previous[0]);
      output.push([boundary, previous[1] + (current[1] - previous[1]) * t]);
    }
    if (inside) output.push(current);
  }
  return output;
}

function plantingBed(name, polygon, cuts, anchor, heights, phase) {
  return cuts.slice(0, -1).map((left, i) => ({
    name: `${name}-${i + 1}`,
    polygon: clipAtX(clipAtX(polygon, left, true), cuts[i + 1], false),
    anchor, bendHeight: heights[i], amplitude: 6.2 + (i % 3) * 0.8,
    phase: phase + i * 0.56,
  }));
}

const REGIONS = [
  ...plantingBed('left-planter', LEFT_BED, [0.151,0.205,0.242,0.288,0.331,0.384],
    [0.151,0.748,0.384,0.754], [0.210,0.220,0.180,0.173,0.115], 0.7),
  ...plantingBed('right-planter', RIGHT_BED, [0.685,0.754,0.800,0.848,0.895,0.950,0.985],
    [0.685,0.751,0.985,0.789], [0.115,0.185,0.185,0.183,0.225,0.155], 2.8),
];

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function smoothstep(low, high, value) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

function dilate(source, width, height, radius) {
  const result = new Uint8Array(source.length);
  const offsets = [];
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius + 1) offsets.push([x, y]);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!source[y * width + x]) continue;
      for (const [dx, dy] of offsets) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < width && yy >= 0 && yy < height) result[yy * width + xx] = 255;
      }
    }
  }
  return result;
}

function maskTexture(THREE, values, width, height) {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(width, height);
  for (let i = 0; i < values.length; i++) {
    pixels.data[i * 4] = values[i];
    pixels.data[i * 4 + 1] = values[i];
    pixels.data[i * 4 + 2] = values[i];
    pixels.data[i * 4 + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function regionPixels(region, width, height) {
  // Shared clump boundaries land on pixel edges, avoiding duplicate soft seams.
  const polygon = region.polygon.map(([x, y]) => [Math.round(x * width), y * height]);
  const left = Math.max(0, Math.floor(Math.min(...polygon.map(p => p[0]))) - 2);
  const top = Math.max(0, Math.floor(Math.min(...polygon.map(p => p[1]))) - 2);
  const right = Math.min(width, Math.ceil(Math.max(...polygon.map(p => p[0]))) + 2);
  const bottom = Math.min(height, Math.ceil(Math.max(...polygon.map(p => p[1]))) + 2);
  return {
    ...region,
    polygon,
    box: [left, top, right - left, bottom - top],
    anchor: region.anchor.map((value, i) => value * (i % 2 ? height : width)),
    bendHeight: region.bendHeight * height,
  };
}

function extract(region, original, clean, sourceWidth) {
  const [left, top, width, height] = region.box;
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.beginPath();
  region.polygon.forEach(([x, y], i) => i ? context.lineTo(x - left, y - top) : context.moveTo(x - left, y - top));
  context.closePath();
  context.fill();
  const boundary = context.getImageData(0, 0, width, height).data;
  const seed = new Uint8Array(width * height);
  const change = new Float32Array(seed.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!boundary[i * 4 + 3]) continue;
      const p = ((top + y) * sourceWidth + left + x) * 4;
      const r = original[p], g = original[p + 1], b = original[p + 2];
      const difference = Math.max(Math.abs(r - clean[p]), Math.abs(g - clean[p + 1]), Math.abs(b - clean[p + 2]));
      change[i] = difference;
      const green = g > r * 0.82 && g > b * 1.25 && g - b > 22 && g > 27;
      const flower = r > g * 1.18 && r - b > 48 && g > 75;
      if ((green || flower) && difference > 20) seed[i] = 255;
    }
  }
  const nearby = dilate(seed, width, height, 2);
  const far = dilate(seed, width, height, 4);
  const mask = new Uint8Array(seed.length);
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!boundary[i * 4 + 3]) continue;
      const p = ((top + y) * sourceWidth + left + x) * 4;
      const r = original[p], g = original[p + 1], b = original[p + 2];
      const high = Math.max(r, g, b), low = Math.min(r, g, b);
      const darkStem = high < 139;
      const palePetal = low > 128 && high - low < 65;
      const colored = high - low > 35;
      let alpha = seed[i] ? 1 : nearby[i] && (darkStem || palePetal || colored) ? smoothstep(18, 42, change[i])
        : far[i] && (darkStem || palePetal) && change[i] > 64 ? 0.85 : 0;
      alpha *= boundary[i * 4 + 3] / 255;
      mask[i] = Math.round(alpha * 255);
      if (mask[i] > 127) count++;
    }
  }
  return { mask, count };
}

export async function createTerracePlants({ THREE, originalTexture, cleanTexture, radius, span, imageHeight }) {
  const width = originalTexture.image.width;
  const height = originalTexture.image.height;
  if (cleanTexture.image.width !== width || cleanTexture.image.height !== height) {
    throw new Error('The terrace planting needs a matching photograph and cleanplate.');
  }
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(originalTexture.image, 0, 0);
  const original = context.getImageData(0, 0, width, height).data;
  context.clearRect(0, 0, width, height);
  context.drawImage(cleanTexture.image, 0, 0);
  const clean = context.getImageData(0, 0, width, height).data;
  const union = new Uint8Array(width * height);
  const group = new THREE.Group();
  group.name = 'terrace-plant-wind';
  const clock = { value: 0 }, motion = { value: 0 }, daylight = { value: 1 };
  const gust = { value: 1 };
  let latest = { time: 0, daylight: 1, motion: 0 };
  const layers = [];

  for (const definition of REGIONS) {
    const region = regionPixels(definition, width, height);
    const [left, top, w, h] = region.box;
    const { mask, count } = extract(region, original, clean, width);
    const texture = maskTexture(THREE, mask, w, h);
    // Vacated antialiased outlines reveal clean scenery, never a second crown.
    const footprint = dilate(mask, w, h, 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (footprint[i]) union[(top + y) * width + left + x] = 255;
      }
    }
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      uniforms: {
        uMap: { value: originalTexture }, uMask: { value: texture },
        uTime: clock, uMotion: motion, uDaylight: daylight, uGust: gust,
        uRect: { value: new THREE.Vector4(left, top, w, h) },
        uSourceSize: { value: new THREE.Vector2(width, height) },
        uAnchor: { value: new THREE.Vector4(...region.anchor) },
        uBendHeight: { value: region.bendHeight },
        uAmplitude: { value: region.amplitude }, uPhase: { value: region.phase },
        uRadius: { value: radius - 0.02 }, uBaseRadius: { value: radius },
        uSpan: { value: span }, uImageHeight: { value: imageHeight },
      },
      vertexShader: `
        uniform vec4 uRect;
        uniform vec4 uAnchor;
        uniform vec2 uSourceSize;
        uniform float uTime;
        uniform float uMotion;
        uniform float uGust;
        uniform float uAmplitude;
        uniform float uPhase;
        uniform float uBendHeight;
        uniform float uRadius;
        uniform float uBaseRadius;
        uniform float uSpan;
        uniform float uImageHeight;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec2 source = vec2(uRect.x + uv.x * uRect.z, uRect.y + (1.0 - uv.y) * uRect.w);
          float anchorY = mix(uAnchor.y, uAnchor.w, (source.x - uAnchor.x) / max(1.0, uAnchor.z - uAnchor.x));
          float rooted = clamp((anchorY - source.y) / uBendHeight, 0.0, 1.0);
          float bend = rooted * rooted;
          float wave = sin(uTime * 0.79 + uPhase) * 0.76 + sin(uTime * 1.39 + uPhase * 1.2) * 0.14;
          float flutter = sin(uTime * 2.12 + uv.x * 9.0 + uv.y * 4.0 + uPhase) * 0.12;
          float strength = uMotion * uGust * smoothstep(0.0, 1.0, uTime);
          source.x += (wave + flutter) * uAmplitude * bend * strength;
          source.y += sin(uTime * 1.09 + uv.x * 5.0 + uPhase) * uAmplitude * 0.08 * bend * strength;
          float angle = (source.x / uSourceSize.x - 0.5) * uSpan;
          vec3 curved = vec3(sin(angle) * uRadius,
            (0.5 - source.y / uSourceSize.y) * uImageHeight * (uRadius / uBaseRadius),
            -cos(angle) * uRadius);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(curved, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform sampler2D uMask;
        uniform vec2 uSourceSize;
        uniform vec4 uRect;
        uniform float uDaylight;
        varying vec2 vUv;
        ${MORNING_LIGHTING_GLSL}
        void main() {
          float mask = texture2D(uMask, vUv).r;
          if (mask < 0.005) discard;
          vec2 sourceUv = vec2((uRect.x + vUv.x * uRect.z) / uSourceSize.x,
            1.0 - (uRect.y + (1.0 - vUv.y) * uRect.w) / uSourceSize.y);
          vec4 color = texture2D(uMap, sourceUv);
          color.rgb = applyMorningLight(color.rgb, sourceUv, uDaylight);
          color.a *= mask;
          gl_FragColor = color;
          #include <colorspace_fragment>
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, Math.max(24, Math.ceil(w / 12)), Math.max(18, Math.ceil(h / 10))), material);
    mesh.name = region.name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
    layers.push({ region, texture, mesh, count });
  }

  const removalTexture = maskTexture(THREE, union, width, height);
  return {
    group, removalTexture,
    update(values) {
      latest = { ...latest, ...values };
      clock.value = latest.time;
      motion.value = latest.motion;
      daylight.value = latest.daylight;
      gust.value = 0.88 + Math.sin(latest.time * 0.31) * 0.14 + Math.sin(latest.time * 0.67) * 0.08;
    },
    getState() {
      return {
        ...latest,
        sourceSize: [width, height],
        layers: layers.map(({ region, count }) => ({
          name: region.name, maskPixels: count, amplitude: region.amplitude,
          tipSway: (Math.sin(latest.time * 0.79 + region.phase) * 0.76 + Math.sin(latest.time * 1.39 + region.phase * 1.2) * 0.14)
            * region.amplitude * latest.motion * gust.value * smoothstep(0, 1, latest.time),
        })),
      };
    },
    dispose() {
      removalTexture.dispose();
      for (const { texture, mesh } of layers) { texture.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
      group.clear();
    },
  };
}
