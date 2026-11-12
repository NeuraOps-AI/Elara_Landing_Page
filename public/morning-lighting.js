// One linear-light grade for the panorama, its clean backing and moving plants.
// Source UVs keep the horizon glow tied to the landscape as the viewer turns.
export const MORNING_LIGHTING_GLSL = `
  vec3 applyMorningLight(vec3 color, vec2 sourceUv, float daylight) {
    float elevation = clamp(daylight, 0.0, 1.0);
    float morning = smoothstep(0.0, 1.0, elevation);
    float clearAir = smoothstep(0.35, 1.0, elevation);
    float golden = smoothstep(0.04, 0.32, elevation)
                 * (1.0 - smoothstep(0.42, 0.95, elevation));
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float shadow = 1.0 - smoothstep(0.12, 0.62, luminance);

    // Cool, subdued ambient dawn becomes clean daylight. The brief warmer
    // phase affects illuminated surfaces more than shaded leaves and recesses.
    vec3 gain = mix(vec3(0.50, 0.57, 0.73), vec3(1.008, 1.002, 0.990), morning);
    gain += vec3(0.13, 0.035, -0.055) * golden * (1.0 - shadow * 0.45);
    vec3 lit = color * gain;
    lit += vec3(-0.010, 0.003, 0.018) * shadow * (1.0 - clearAir);

    // A soft band of dawn scattering, strongest in the sun's direction.
    // Limit it to the open sky; the ceiling, door and foreground stay textured.
    float topDown = 1.0 - sourceUv.y;
    float skyOpening = smoothstep(0.153, 0.174, sourceUv.x)
                     * smoothstep(0.14, 0.24, topDown)
                     * (1.0 - smoothstep(0.485, 0.525, topDown));
    float horizon = exp(-pow((topDown - 0.50) / 0.105, 2.0));
    float facingSun = exp(-pow((sourceUv.x - 0.55) / 0.34, 2.0));
    vec3 haze = mix(vec3(0.42, 0.255, 0.28), vec3(0.98, 0.61, 0.29),
                    smoothstep(0.0, 0.40, elevation));
    float scattering = skyOpening * horizon * (0.55 + 0.45 * facingSun)
                     * 0.30 * (1.0 - clearAir) * (0.65 + 0.35 * golden);
    return max(mix(lit, haze, scattering), vec3(0.0));
  }
`;
