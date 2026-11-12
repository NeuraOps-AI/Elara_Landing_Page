// Shared by the architecture and extracted plants so their exposure and warmth
// stay aligned while the sun rises. Values operate in the linear color space.
export const SUNRISE_LIGHTING_GLSL = `
  vec3 applySunriseLight(vec3 color, float daylight) {
    float elevation = clamp(daylight, 0.0, 1.0);
    float morning = smoothstep(0.05, 0.94, elevation);
    float golden = smoothstep(0.08, 0.35, elevation)
                 * (1.0 - smoothstep(0.45, 0.96, elevation));
    // The same balance reaches every extracted plant and the architecture.
    // Cool indirect dawn becomes a brief warm low-sun phase, then neutral light.
    vec3 balance = mix(vec3(0.80, 0.88, 1.08), vec3(1.015, 1.0, 0.985), morning);
    balance *= mix(vec3(1.0), vec3(1.045, 1.005, 0.95), golden);
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luminance), color, mix(0.88, 1.0, morning));
    return color * balance * mix(0.66, 1.01, morning);
  }
`;
