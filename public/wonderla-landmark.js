// Reference-led Sky Wheel silhouette: a glazed observation tower, broad red
// polygonal deck, low roof pavilion, and a wheel mounted on that roof.
// The returned group's origin is the tower's base, not the wheel's centre.
export function createWonderlaLandmark({ THREE, imageHeight }) {
  const group = new THREE.Group();
  group.name = 'wonderla-observation-tower';
  group.scale.setScalar(imageHeight);
  const architecture = new THREE.Group();
  // The slight turn exposes the darker right-hand glass face in the reference.
  architecture.rotation.y = -0.17;
  group.add(architecture);
  const haze = new THREE.Color('#d5ceba');
  const softened = (hex, strength = 0.13) => new THREE.Color(hex).lerp(haze, strength);
  const material = (hex, opacity = 1, strength = 0.13) => new THREE.MeshBasicMaterial({
    color: softened(hex, strength), transparent: opacity < 1, opacity,
    depthTest: false, depthWrite: false,
  });
  const lineMaterial = (hex, opacity) => new THREE.LineBasicMaterial({
    color: softened(hex, 0.1), transparent: true, opacity,
    depthTest: false, depthWrite: false,
  });
  function mesh(geometry, materials, x, y, z, order = 2) {
    const object = new THREE.Mesh(geometry, materials);
    object.position.set(x, y, z);
    object.renderOrder = order;
    architecture.add(object);
    return object;
  }

  const shaftWidth = 0.038;
  const shaftDepth = 0.030;
  const shaftBottom = 0.005;
  const shaftHeight = 0.120;
  const shaftTop = shaftBottom + shaftHeight;
  mesh(new THREE.BoxGeometry(0.049, 0.005, 0.037), [
    material('#888f87'), material('#bcc0ae'), material('#c9c9b6'),
    material('#777f74'), material('#bdc0ac'), material('#989e91'),
  ], 0, 0.0025, 0);
  mesh(new THREE.BoxGeometry(shaftWidth, shaftHeight, shaftDepth), [
    material('#577d91'), material('#91adba'), material('#a1b4bd'),
    material('#657d82'), material('#6b9db9'), material('#78939f'),
  ], 0, shaftBottom + shaftHeight / 2, 0);

  // Glazing is real geometry with quiet changes in reflected sky tone. The
  // mullions remain a fine grid rather than a high-contrast checkerboard.
  const positions = [], colors = [];
  const columns = 4, rows = 18;
  const panelWidth = shaftWidth / columns;
  const panelHeight = shaftHeight / rows;
  const frontZ = shaftDepth / 2 + 0.00012;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x0 = -shaftWidth / 2 + column * panelWidth + 0.00023;
      const x1 = x0 + panelWidth - 0.00046;
      const y0 = shaftBottom + row * panelHeight + 0.00014;
      const y1 = y0 + panelHeight - 0.00028;
      const tone = softened('#68a2bf', 0.11);
      const reflection = 0.91 + row / rows * 0.11 + Math.sin(row * 1.37 + column * 2.23) * 0.045;
      tone.multiplyScalar(reflection);
      for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) {
        positions.push(x, y, frontZ);
        colors.push(tone.r, tone.g, tone.b);
      }
    }
  }
  const panels = new THREE.BufferGeometry();
  panels.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  panels.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  mesh(panels, new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false }), 0, 0, 0, 3);
  const mullions = [];
  for (let row = 0; row <= rows; row++) {
    const y = shaftBottom + row * panelHeight;
    mullions.push(-shaftWidth / 2, y, frontZ + 0.0001, shaftWidth / 2, y, frontZ + 0.0001);
    mullions.push(shaftWidth / 2 + 0.0001, y, -shaftDepth / 2, shaftWidth / 2 + 0.0001, y, shaftDepth / 2);
  }
  for (let column = 0; column <= columns; column++) {
    const x = -shaftWidth / 2 + column * panelWidth;
    mullions.push(x, shaftBottom, frontZ + 0.0001, x, shaftTop, frontZ + 0.0001);
  }
  for (let column = 1; column < 3; column++) {
    const z = -shaftDepth / 2 + shaftDepth * column / 3;
    mullions.push(shaftWidth / 2 + 0.0001, shaftBottom, z, shaftWidth / 2 + 0.0001, shaftTop, z);
  }
  const mullionGeometry = new THREE.BufferGeometry();
  mullionGeometry.setAttribute('position', new THREE.Float32BufferAttribute(mullions, 3));
  const windowGrid = new THREE.LineSegments(mullionGeometry, lineMaterial('#b5c6cc', 0.37));
  windowGrid.renderOrder = 4;
  architecture.add(windowGrid);

  function octagonalDeck(topRadius, bottomRadius, height, y, side, top, bottom) {
    const deck = mesh(new THREE.CylinderGeometry(topRadius, bottomRadius, height, 8), [
      material(side), material(top), material(bottom),
    ], 0, y, 0, 5);
    deck.rotation.y = Math.PI / 8;
    deck.scale.z = 0.77;
    return deck;
  }
  // The splayed underside and pink-burgundy fascia are the distinctive cap.
  octagonalDeck(0.044, 0.022, 0.009, 0.1225, '#875064', '#a36777', '#604a55');
  octagonalDeck(0.045, 0.045, 0.0055, 0.1295, '#b66f83', '#c58f9c', '#7d4d60');
  octagonalDeck(0.0418, 0.0425, 0.0022, 0.1332, '#8c5267', '#c2a0a8', '#75485b');

  // A compact glazed observation room and pale roof sit above the wide deck.
  mesh(new THREE.BoxGeometry(0.052, 0.0094, 0.026), [
    material('#5e7582'), material('#8396a1'), material('#b8bcb5'),
    material('#5d6970'), material('#68838f'), material('#70818a'),
  ], 0, 0.1391, 0, 6);
  const pavilionLines = [];
  for (let i = 0; i <= 6; i++) {
    const x = -0.026 + i * 0.052 / 6;
    pavilionLines.push(x, 0.1345, 0.0132, x, 0.1437, 0.0132);
  }
  pavilionLines.push(-0.027, 0.135, 0.0132, 0.027, 0.135, 0.0132);
  const pavilionGeometry = new THREE.BufferGeometry();
  pavilionGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pavilionLines, 3));
  const pavilionGrid = new THREE.LineSegments(pavilionGeometry, lineMaterial('#dfddd0', 0.71));
  pavilionGrid.renderOrder = 7;
  architecture.add(pavilionGrid);
  const roof = octagonalDeck(0.032, 0.033, 0.0026, 0.1454, '#c2c5bc', '#e5e5d9', '#969d96');
  roof.renderOrder = 8;
  mesh(new THREE.BoxGeometry(0.047, 0.0018, 0.022), material('#515c62', 0.93), 0, 0.1476, -0.003, 9);

  const wheelRadius = 0.0415;
  const hubHeight = 0.1952;
  const wheel = new THREE.Group();
  wheel.position.set(0, hubHeight, 0.003);
  architecture.add(wheel);
  const rotor = new THREE.Group();
  wheel.add(rotor);
  const rimMaterial = lineMaterial('#e7ece5', 0.92);
  const rearRimMaterial = lineMaterial('#a6b4b3', 0.57);
  const spokeMaterial = lineMaterial('#cbd6d1', 0.63);
  function ring(radius, z, rim) {
    const points = [];
    for (let i = 0; i < 96; i++) {
      const angle = i / 96 * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z));
    }
    const object = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), rim);
    object.renderOrder = 10;
    rotor.add(object);
  }
  ring(wheelRadius, -0.0016, rearRimMaterial);
  ring(wheelRadius, 0.0016, rimMaterial);
  ring(wheelRadius * 0.947, 0.0016, rimMaterial);

  function roofStrut(x, z) {
    const base = new THREE.Vector3(x, 0.1484, z);
    const top = new THREE.Vector3(0, hubHeight, 0.003);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, base.distanceTo(top), 5), material('#dce2d9', 0.88));
    beam.position.copy(base.clone().add(top).multiplyScalar(0.5));
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.sub(base).normalize());
    beam.renderOrder = 11;
    architecture.add(beam);
  }
  roofStrut(-0.017, 0.009);
  roofStrut(0.017, 0.009);
  const hub = new THREE.Mesh(new THREE.CircleGeometry(0.0021, 16), material('#d6dfd8'));
  hub.position.z = 0.004;
  hub.renderOrder = 12;
  wheel.add(hub);

  const spokePoints = [];
  const gondolas = [];
  const podColors = ['#4d6474', '#715665', '#586c75', '#6d657b'];
  const podGeometry = new THREE.SphereGeometry(0.0025, 8, 6);
  const windowGeometry = new THREE.PlaneGeometry(0.0027, 0.0015);
  const windowMaterial = material('#354751', 0.93, 0.2);
  for (let i = 0; i < 16; i++) {
    const angle = i / 16 * Math.PI * 2;
    const x = Math.cos(angle) * wheelRadius, y = Math.sin(angle) * wheelRadius;
    spokePoints.push(0, 0, 0.0016, x, y, 0.0016);
    // A second fine radial member gives the reference's lacy white wheel.
    const innerAngle = angle + Math.PI / 16;
    spokePoints.push(0, 0, -0.0016, Math.cos(innerAngle) * wheelRadius, Math.sin(innerAngle) * wheelRadius, -0.0016);
    const hanger = new THREE.Group();
    hanger.position.set(x, y, 0.003);
    const cabin = new THREE.Mesh(podGeometry, material(podColors[i % podColors.length], 0.98, 0.18));
    cabin.scale.set(1, 0.79, 0.70);
    cabin.position.y = -0.0033;
    cabin.renderOrder = 13;
    hanger.add(cabin);
    const pane = new THREE.Mesh(windowGeometry, windowMaterial);
    pane.position.set(0, -0.0026, 0.0018);
    pane.renderOrder = 14;
    hanger.add(pane);
    rotor.add(hanger);
    gondolas.push(hanger);
  }
  const spokeGeometry = new THREE.BufferGeometry();
  spokeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(spokePoints, 3));
  const spokes = new THREE.LineSegments(spokeGeometry, spokeMaterial);
  spokes.renderOrder = 10;
  rotor.add(spokes);

  // A very shallow, soft foreground haze lets the footing settle into the
  // distant tree line instead of ending in a conspicuous hard white edge.
  const footingHaze = new THREE.Mesh(new THREE.PlaneGeometry(0.067, 0.015), new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uTint: { value: softened('#87907a', 0.08) } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTint;
      varying vec2 vUv;
      void main() {
        float sides = exp(-pow((vUv.x - 0.5) * 3.0, 2.0));
        float lift = 1.0 - smoothstep(0.0, 0.82, vUv.y);
        gl_FragColor = vec4(uTint, sides * lift * 0.25);
        #include <colorspace_fragment>
      }
    `,
  }));
  footingHaze.position.set(0, 0.0075, shaftDepth / 2 + 0.003);
  footingHaze.renderOrder = 15;
  architecture.add(footingHaze);

  return {
    group,
    update(time) {
      rotor.rotation.z = -time * 0.035;
      gondolas.forEach(gondola => { gondola.rotation.z = -rotor.rotation.z; });
    },
    getState: () => ({ wheelRotation: rotor.rotation.z, totalHeight: imageHeight * 0.2367, hubHeight: imageHeight * hubHeight, shaftHeight: imageHeight * shaftHeight }),
    dispose() {
      const geometries = new Set(), materials = new Set();
      group.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(item => materials.add(item));
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(value => value.dispose());
      group.removeFromParent();
      group.clear();
    },
  };
}
