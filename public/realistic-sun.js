// A photographic sun sprite shared by the villa and terrace scenes.
// coreRadius is measured from the centre in normalized [-1, 1] plane space.
// horizonV/centerV/spanV use top-down coordinates in the panorama photograph.
export function createRealisticSunMaterial(THREE, {
  coreRadius = 0.15,
  horizonV,
  horizonFeather = 0.0125,
  spanV = 1,
  centerV = 0.5,
  depthTest = true,
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest,
    uniforms: {
      uDaylight: { value: 0 },
      uCoreRadius: { value: coreRadius },
      uCenterV: { value: centerV },
      uSpanV: { value: spanV },
      uHorizonEnabled: { value: Number.isFinite(horizonV) ? 1 : 0 },
      uHorizonV: { value: horizonV ?? 0.514 },
      uHorizonFeather: { value: horizonFeather },
      uCoreDawn: { value: new THREE.Color('#ffbd78') },
      uCoreGolden: { value: new THREE.Color('#ffe4a5') },
      uCoreMorning: { value: new THREE.Color('#fffdf2') },
      uLimbDawn: { value: new THREE.Color('#dc854e') },
      uLimbGolden: { value: new THREE.Color('#f6c071') },
      uLimbMorning: { value: new THREE.Color('#ffe4b0') },
      uGlowDawn: { value: new THREE.Color('#eaa476') },
      uGlowGolden: { value: new THREE.Color('#f4ca8d') },
      uGlowMorning: { value: new THREE.Color('#f9e4bd') },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uDaylight;
      uniform float uCoreRadius;
      uniform float uCenterV;
      uniform float uSpanV;
      uniform float uHorizonEnabled;
      uniform float uHorizonV;
      uniform float uHorizonFeather;
      uniform vec3 uCoreDawn;
      uniform vec3 uCoreGolden;
      uniform vec3 uCoreMorning;
      uniform vec3 uLimbDawn;
      uniform vec3 uLimbGolden;
      uniform vec3 uLimbMorning;
      uniform vec3 uGlowDawn;
      uniform vec3 uGlowGolden;
      uniform vec3 uGlowMorning;
      varying vec2 vUv;

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float radius = length(p);
        float q = radius / max(uCoreRadius, 0.001);
        float daylight = clamp(uDaylight, 0.0, 1.0);
        float golden = smoothstep(0.05, 0.48, daylight);
        float morning = smoothstep(0.38, 0.95, daylight);

        // The longer optical path at the horizon warms the whole disk.
        // As elevation increases, peach becomes gold and then luminous ivory.
        float body = 1.0 - smoothstep(0.76, 1.16, q);
        float limb = pow(clamp(q, 0.0, 1.0), 1.65);
        vec3 core = mix(mix(uCoreDawn, uCoreGolden, golden), uCoreMorning, morning);
        vec3 edge = mix(mix(uLimbDawn, uLimbGolden, golden), uLimbMorning, morning);
        vec3 bodyColor = mix(core, edge, limb * mix(0.40, 0.25, morning));

        // Restrained, broad horizontal variations suggest intervening air.
        // On the terrace these layers stay aligned to the photographed sky.
        float sourceV = uCenterV + (0.5 - vUv.y) * uSpanV;
        float airY = mix(p.y * 0.16, sourceV, uHorizonEnabled);
        float air = 0.5 + 0.32 * sin(airY * 47.0 + 1.2)
                        + 0.18 * sin(airY * 109.0 + 0.7);
        float lowerLimb = 1.0 - smoothstep(-0.8, 0.5, p.y / uCoreRadius);
        float transmission = 1.0 - air * lowerLimb * mix(0.085, 0.025, morning);
        float bodyAlpha = body * mix(0.96, 0.985, morning) * transmission;

        // Close optical bloom softens the limb; a much fainter anisotropic
        // veil blends into the sky. There are no rays or lens-flare sprites.
        float nearBloom = exp(-max(q - 0.80, 0.0) * mix(3.2, 4.0, morning));
        float hazeRadius = length(vec2(p.x * mix(0.78, 0.94, morning), p.y * 1.08));
        float haze = exp(-pow(hazeRadius / (uCoreRadius * mix(3.15, 2.15, morning)), 2.0));
        float envelope = 1.0 - smoothstep(0.58, 0.84, radius);
        float glowAlpha = (nearBloom * mix(0.19, 0.13, morning)
                        + haze * mix(0.050, 0.020, morning)) * envelope;
        vec3 glowColor = mix(mix(uGlowDawn, uGlowGolden, golden), uGlowMorning, morning);

        // Compose in linear space, then return straight alpha for Three.js.
        float alpha = bodyAlpha + glowAlpha * (1.0 - bodyAlpha);
        vec3 color = (bodyColor * bodyAlpha
                    + glowColor * glowAlpha * (1.0 - bodyAlpha))
                    / max(alpha, 0.00001);
        float aboveHorizon = 1.0 - smoothstep(
          uHorizonV - uHorizonFeather,
          uHorizonV + uHorizonFeather,
          sourceV
        );
        alpha *= mix(1.0, aboveHorizon, uHorizonEnabled);
        gl_FragColor = vec4(color, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
}
