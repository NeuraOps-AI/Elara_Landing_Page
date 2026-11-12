// Photo-derived plant layers. All extraction happens in memory; the source
// photograph stays unchanged and the architecture is never deformed.
import { SUNRISE_LIGHTING_GLSL } from './sunrise-lighting.js?v=4';

const REGIONS = [
  {
    name: 'main-balcony', type: 'balcony', box: [120, 251, 588, 148],
    polygon: [[137,284],[161,263],[215,259],[283,268],[350,286],[419,299],[482,307],[550,310],[611,329],[667,343],[694,387],[636,375],[554,361],[472,346],[391,332],[310,318],[231,307],[173,310],[145,321]],
    baseline: [170, 309, 675, 382], bendHeight: 63, amplitude: 8, phase: 0.4,
  },
  {
    name: 'middle-balcony', type: 'balcony', box: [782, 370, 358, 100],
    polygon: [[788,402],[812,383],[846,374],[883,380],[935,393],[988,403],[1041,413],[1096,426],[1132,449],[1133,462],[1062,445],[993,434],[922,424],[853,416],[818,426],[788,440]],
    baseline: [850, 416, 1122, 454], baselineLeft: [788, 440, 850, 416], bendHeight: 49, amplitude: 8, phase: 1.8,
  },
  {
    name: 'right-balcony', type: 'balcony', box: [1178, 437, 234, 84],
    polygon: [[1182,460],[1221,446],[1250,450],[1281,463],[1317,469],[1361,478],[1392,491],[1406,516],[1344,502],[1283,488],[1224,480],[1182,493]],
    baseline: [1224, 480, 1400, 514], baselineLeft: [1182, 493, 1224, 480], bendHeight: 43, amplitude: 7, phase: 3.2,
  },
  {
    name: 'left-street-tree', type: 'tree', box: [0, 571, 205, 326],
    polygon: [[0,658],[18,625],[28,594],[60,577],[89,589],[119,603],[144,641],[172,668],[191,708],[202,752],[183,786],[149,802],[126,822],[108,858],[80,889],[48,893],[40,833],[17,802],[0,768]],
    baseline: [0, 892, 205, 892], bendHeight: 300, amplitude: 15, phase: 0.8,
  },
  {
    name: 'central-street-tree', type: 'tree', box: [622, 643, 256, 245],
    polygon: [[625,732],[632,698],[653,679],[680,672],[699,648],[727,658],[750,674],[778,659],[808,670],[832,686],[857,689],[875,723],[858,750],[827,770],[823,799],[813,827],[790,844],[770,866],[741,883],[714,872],[707,836],[692,807],[665,795],[645,770]],
    baseline: [622, 881, 878, 881], bendHeight: 225, amplitude: 16, phase: 2.4,
  },
  {
    name: 'middle-street-tree', type: 'tree', box: [1122, 669, 205, 197],
    polygon: [[1126,752],[1139,718],[1159,702],[1183,680],[1210,673],[1234,681],[1260,691],[1285,690],[1305,718],[1322,745],[1307,776],[1287,789],[1284,817],[1259,837],[1220,863],[1189,855],[1187,817],[1163,802],[1139,787]],
    baseline: [1122, 860, 1327, 860], bendHeight: 184, amplitude: 14, phase: 4.1,
  },
  {
    name: 'right-street-tree', type: 'tree', box: [1405, 683, 131, 177],
    polygon: [[1408,738],[1417,711],[1442,696],[1471,687],[1504,694],[1535,716],[1535,762],[1514,784],[1494,806],[1485,850],[1461,857],[1458,806],[1442,788],[1425,774]],
    baseline: [1405, 851, 1536, 851], bendHeight: 158, amplitude: 13, phase: 5.6,
  },
  {
    name: 'background-tree', type: 'rear-tree', box: [0, 282, 148, 325],
    polygon: [[0,359],[21,322],[55,302],[80,286],[111,293],[128,318],[145,347],[122,375],[113,431],[111,473],[94,516],[102,548],[83,585],[54,606],[18,589],[0,564]],
    baseline: [0, 631, 148, 631], bendHeight: 329, amplitude: 11, phase: 3.7,
  },
  {
    name: 'left-planter', type: 'shrub', box: [7, 851, 207, 94],
    polygon: [[10,924],[8,902],[27,880],[65,867],[107,858],[147,867],[185,877],[211,896],[198,915],[103,933],[28,943]],
    baseline: [12, 936, 208, 905], bendHeight: 53, amplitude: 4, phase: 1.3,
  },
  {
    name: 'central-planter', type: 'shrub', box: [622, 843, 296, 72],
    polygon: [[625,897],[646,879],[675,863],[707,852],[746,846],[786,854],[819,859],[853,856],[890,866],[915,885],[896,898],[827,903],[756,908],[684,913],[636,910]],
    baseline: [626, 909, 911, 891], bendHeight: 49, amplitude: 4, phase: 2.8,
  },
  {
    name: 'middle-planter', type: 'shrub', box: [1136, 826, 225, 60],
    polygon: [[1139,860],[1157,847],[1187,839],[1219,832],[1254,836],[1295,839],[1333,846],[1358,861],[1339,875],[1280,879],[1219,884],[1160,877]],
    baseline: [1140, 878, 1358, 868], bendHeight: 43, amplitude: 3.5, phase: 4.8,
  },
  {
    name: 'right-planter', type: 'shrub', box: [1415, 817, 114, 53],
    polygon: [[1418,848],[1435,832],[1455,822],[1482,820],[1505,833],[1526,850],[1515,862],[1473,867],[1433,861]],
    baseline: [1418, 863, 1527, 856], bendHeight: 38, amplitude: 3, phase: 5.9,
  },
];

function canvasFor(width, height) {
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
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!source[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && dx * dx + dy * dy <= radius * radius + 1) {
            result[yy * width + xx] = 255;
          }
        }
      }
    }
  }
  return result;
}

function greyTexture(THREE, values, width, height) {
  const canvas = canvasFor(width, height);
  const context = canvas.getContext('2d');
  const data = context.createImageData(width, height);
  for (let i = 0; i < values.length; i++) {
    data.data[i * 4] = values[i];
    data.data[i * 4 + 1] = values[i];
    data.data[i * 4 + 2] = values[i];
    data.data[i * 4 + 3] = 255;
  }
  context.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function extractMask(region, sourcePixels, cleanPixels, sourceWidth) {
  const [left, top, width, height] = region.box;
  const boundary = canvasFor(width, height);
  const context = boundary.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.beginPath();
  region.polygon.forEach(([x, y], i) => i ? context.lineTo(x - left, y - top) : context.moveTo(x - left, y - top));
  context.closePath();
  context.fill();
  const polygon = context.getImageData(0, 0, width, height).data;
  const seed = new Uint8Array(width * height);
  const difference = new Float32Array(width * height);
  const eligible = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!polygon[i * 4 + 3]) continue;
      const p = ((top + y) * sourceWidth + left + x) * 4;
      const r = sourcePixels[p], g = sourcePixels[p + 1], b = sourcePixels[p + 2];
      if (sourcePixels[p + 3] < 24) continue;
      const change = Math.max(Math.abs(r - cleanPixels[p]), Math.abs(g - cleanPixels[p + 1]), Math.abs(b - cleanPixels[p + 2]), Math.abs(sourcePixels[p + 3] - cleanPixels[p + 3]));
      difference[i] = change;
      eligible[i] = 1;
      const green = g > r * 0.88 && g > b * 1.17 && g - b > 13 && g > 25;
      const flower = r > g * 1.2 && b > g * 0.76 && r > 105 && r - b > 8;
      if ((green || flower) && change > 20) seed[i] = 255;
    }
  }
  // Nearby changed pixels include pale petals, yellow leaf tips and fine stems.
  // The tiny reach prevents rectangular wall/window patches joining a crown.
  const near = dilate(seed, width, height, 3);
  const wide = dilate(seed, width, height, 5);
  const mask = new Uint8Array(seed.length);
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!eligible[i]) continue;
      const p = ((top + y) * sourceWidth + left + x) * 4;
      const r = sourcePixels[p], g = sourcePixels[p + 1], b = sourcePixels[p + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const colored = max - min > 28;
      const dark = max < 128;
      const paleFlower = min > 130 && max - min < 65;
      const changed = smoothstep(16, 42, difference[i]);
      let strength = seed[i] ? 1 : near[i] && (colored || dark || paleFlower) ? changed : wide[i] && (dark || paleFlower) && difference[i] > 55 ? 0.85 : 0;
      strength *= polygon[i * 4 + 3] / 255;
      mask[i] = Math.round(strength * 255);
      if (mask[i] > 127) count++;
    }
  }
  return { mask, count };
}

export async function createPlantWind({ THREE, originalTexture, cleanTexture }) {
  const sourceWidth = originalTexture.image.width;
  const sourceHeight = originalTexture.image.height;
  if (sourceWidth !== 1536 || sourceHeight !== 1024 || cleanTexture.image.width !== sourceWidth || cleanTexture.image.height !== sourceHeight) {
    throw new Error('Plant layers require the matching 1536 × 1024 villa images.');
  }
  const sourceCanvas = canvasFor(sourceWidth, sourceHeight);
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  sourceContext.drawImage(originalTexture.image, 0, 0);
  const sourcePixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
  sourceContext.clearRect(0, 0, sourceWidth, sourceHeight);
  sourceContext.drawImage(cleanTexture.image, 0, 0);
  const cleanPixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
  const union = new Uint8Array(sourceWidth * sourceHeight);
  const group = new THREE.Group();
  group.name = 'photo-plant-wind';
  const clock = { value: 0 };
  const wind = { value: 0 };
  const gust = { value: 1 };
  const daylight = { value: 1 };
  let scale = 1;
  let latest = { time: 0, wind: 0, gust: 1, daylight: 1 };
  const layers = [];

  for (const region of REGIONS) {
    const [left, top, width, height] = region.box;
    const { mask, count } = extractMask(region, sourcePixels, cleanPixels, sourceWidth);
    const maskTexture = greyTexture(THREE, mask, width, height);
    // Remove the exact static footprint, with a 1px fringe for antialiasing.
    const edge = dilate(mask, width, height, 1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const target = (top + y) * sourceWidth + left + x;
        const value = Math.max(mask[i], Math.round(edge[i] * 0.32));
        union[target] = Math.max(union[target], value);
      }
    }
    const uniforms = {
      uMap: { value: originalTexture }, uMask: { value: maskTexture },
      uTime: clock, uWind: wind, uGust: gust, uDaylight: daylight,
      uPhase: { value: region.phase }, uAmplitude: { value: region.amplitude },
      uSourceSize: { value: new THREE.Vector2(sourceWidth, sourceHeight) },
      uRect: { value: new THREE.Vector4(left, top, width, height) },
      uAnchor: { value: new THREE.Vector4(...region.baseline) },
      uAnchorLeft: { value: new THREE.Vector4(...(region.baselineLeft || region.baseline)) },
      uBendHeight: { value: region.bendHeight },
    };
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms,
      vertexShader: `
        uniform vec4 uRect;
        uniform vec4 uAnchor;
        uniform vec4 uAnchorLeft;
        uniform float uTime;
        uniform float uWind;
        uniform float uGust;
        uniform float uPhase;
        uniform float uAmplitude;
        uniform float uBendHeight;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec2 source = vec2(uRect.x + uv.x * uRect.z, uRect.y + (1.0 - uv.y) * uRect.w);
          float anchorY = mix(uAnchor.y, uAnchor.w, (source.x - uAnchor.x) / (uAnchor.z - uAnchor.x));
          if (source.x < uAnchor.x) anchorY = mix(uAnchorLeft.y, uAnchorLeft.w, (source.x - uAnchorLeft.x) / (uAnchorLeft.z - uAnchorLeft.x));
          float rooted = clamp((anchorY - source.y) / uBendHeight, 0.0, 1.0);
          float bend = rooted * rooted;
          float strength = uWind * uGust * smoothstep(0.0, 0.8, uTime);
          float wave = sin(uTime * 0.88 + uPhase) * 0.76 + sin(uTime * 1.57 + uPhase * 1.3) * 0.16;
          float flutter = sin(uTime * 2.13 + uv.x * 9.0 + uv.y * 3.0 + uPhase) * 0.11;
          vec3 displaced = position;
          displaced.x += (wave + flutter) * uAmplitude * bend * strength;
          displaced.y += sin(uTime * 1.17 + uPhase + uv.x * 3.0) * uAmplitude * 0.065 * bend * strength;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform sampler2D uMask;
        uniform vec2 uSourceSize;
        uniform vec4 uRect;
        uniform float uDaylight;
        varying vec2 vUv;
        ${SUNRISE_LIGHTING_GLSL}
        void main() {
          float mask = texture2D(uMask, vUv).r;
          if (mask < 0.005) discard;
          vec2 sourceUv = vec2((uRect.x + vUv.x * uRect.z) / uSourceSize.x,
                               1.0 - (uRect.y + (1.0 - vUv.y) * uRect.w) / uSourceSize.y);
          vec4 color = texture2D(uMap, sourceUv);
          color.rgb = applySunriseLight(color.rgb, uDaylight);
          color.a *= mask;
          gl_FragColor = color;
          #include <colorspace_fragment>
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, region.type === 'balcony' ? 48 : 28, 22), material);
    mesh.name = region.name;
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    group.add(mesh);
    layers.push({ region, mesh, maskTexture, count, cssAmplitude: region.amplitude });
  }

  const removalTexture = greyTexture(THREE, union, sourceWidth, sourceHeight);

  return {
    removalTexture, group,
    update(values) {
      latest = { ...latest, ...values };
      clock.value = latest.time;
      wind.value = latest.wind;
      gust.value = latest.gust;
      daylight.value = latest.daylight;
    },
    resize({ left, top, width, height, canvasHeight }) {
      scale = width / sourceWidth;
      const scaleY = height / sourceHeight;
      for (const layer of layers) {
        const { region, mesh } = layer;
        const [x, y, w, h] = region.box;
        mesh.position.set(left + (x + w / 2) * scale, canvasHeight - top - (y + h / 2) * scaleY, 0.1);
        mesh.scale.set(scale, scaleY, 1);
        layer.cssAmplitude = region.type === 'tree' ? Math.min(12, Math.max(6, region.amplitude * scale))
          : region.type === 'rear-tree' ? Math.min(7, Math.max(3, region.amplitude * scale))
          : region.type === 'shrub' ? Math.min(3, Math.max(1.4, region.amplitude * scale))
          : Math.min(7, Math.max(3.5, region.amplitude * scale));
        mesh.material.uniforms.uAmplitude.value = layer.cssAmplitude / Math.max(scale, 0.001);
      }
    },
    getState() {
      return {
        ...latest, scale,
        layers: layers.map(({ region, count, cssAmplitude }) => ({
          name: region.name, maskPixels: count, anchor: region.baseline,
          maxTipSway: cssAmplitude,
          tipSway: (Math.sin(latest.time * 0.88 + region.phase) * 0.76 + Math.sin(latest.time * 1.57 + region.phase * 1.3) * 0.16) * cssAmplitude * latest.wind * latest.gust * smoothstep(0, 0.8, latest.time),
        })),
      };
    },
    dispose() {
      removalTexture.dispose();
      for (const { mesh, maskTexture } of layers) { mesh.geometry.dispose(); mesh.material.dispose(); maskTexture.dispose(); }
      group.clear();
    },
  };
}
