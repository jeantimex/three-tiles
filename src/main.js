import './style.css';
import {
  AmbientLight,
  Camera,
  Color,
  DirectionalLight,
  Euler,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  Vector2,
  WebGLRenderer,
} from 'three';
import { TilesRenderer, GlobeControls, CAMERA_FRAME } from '3d-tiles-renderer';
import { XYZTilesPlugin } from '3d-tiles-renderer/plugins';
import GUI from 'lil-gui';

const SAN_FRANCISCO = { lat: 37.7749, lon: -122.4194 };
const VIEW_HEIGHT_METERS = 12_000_000;
const MOON_MAP_LABEL = 'Moon Map';
const NONE_LABEL = 'None';
const TILE_SOURCES = {
  openStreetMap: {
    label: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    levels: 19,
  },
  moon: {
    label: 'Moon',
    url: 'https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/opm-moon-basemap-v0-1/1/{z}/{x}/{y}.png',
    levels: 8,
  },
};

const app = document.getElementById('app');

const scene = new Scene();
scene.add(new AmbientLight(0xffffff, 0.08));

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function randomColor(hue, saturation, lightness) {
  return new Color().setHSL(hue, saturation, lightness);
}

function randomFromRanges(ranges) {
  const range = ranges[Math.floor(Math.random() * ranges.length)];
  return randomRange(range[0], range[1]);
}

const skySeed = randomRange(1, 10_000);
const skyRotation = new Matrix4().makeRotationFromEuler(
  new Euler(
    randomRange(0, Math.PI * 2),
    randomRange(0, Math.PI * 2),
    randomRange(0, Math.PI * 2),
    'XYZ',
  ),
);
const skyPaletteHue = randomFromRanges([
  [0.0, 0.1],
  [0.56, 0.68],
]);
const skyAccentHue = randomFromRanges([
  [0.0, 0.07],
  [0.82, 0.96],
]);
const skyPalette = {
  base: randomColor(randomRange(0.58, 0.68), 0.45, 0.006),
  cool: randomColor(randomRange(0.58, 0.68), randomRange(0.62, 0.9), randomRange(0.22, 0.38)),
  warm: randomColor(randomRange(0.055, 0.13), randomRange(0.72, 0.95), randomRange(0.38, 0.56)),
  rose: randomColor(randomRange(0.0, 0.045), randomRange(0.72, 0.95), randomRange(0.32, 0.5)),
  violet: randomColor(skyAccentHue, randomRange(0.58, 0.9), randomRange(0.22, 0.38)),
  pale: randomColor(randomRange(0.08, 0.14), randomRange(0.38, 0.65), randomRange(0.58, 0.74)),
};

const starfieldMaterial = new ShaderMaterial({
  uniforms: {
    time: { value: 0 },
    hashSeed: { value: skySeed },
    cloudOffsetA: { value: new Vector3(randomRange(-80, 80), randomRange(-80, 80), randomRange(-80, 80)) },
    cloudOffsetB: { value: new Vector3(randomRange(-80, 80), randomRange(-80, 80), randomRange(-80, 80)) },
    cloudOffsetC: { value: new Vector3(randomRange(-80, 80), randomRange(-80, 80), randomRange(-80, 80)) },
    dustOffset: { value: new Vector3(randomRange(-80, 80), randomRange(-80, 80), randomRange(-80, 80)) },
    skyBasisX: { value: new Vector3().setFromMatrixColumn(skyRotation, 0) },
    skyBasisY: { value: new Vector3().setFromMatrixColumn(skyRotation, 1) },
    skyBasisZ: { value: new Vector3().setFromMatrixColumn(skyRotation, 2) },
    baseColor: { value: skyPalette.base },
    coolColor: { value: skyPalette.cool },
    warmColor: { value: skyPalette.warm },
    roseColor: { value: skyPalette.rose },
    violetColor: { value: skyPalette.violet },
    paleColor: { value: skyPalette.pale },
    cameraBasisX: { value: new Vector3(1, 0, 0) },
    cameraBasisY: { value: new Vector3(0, 1, 0) },
    cameraBasisZ: { value: new Vector3(0, 0, -1) },
    cameraFovScale: { value: new Vector2(1, 1) },
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    uniform float hashSeed;
    uniform vec3 cloudOffsetA;
    uniform vec3 cloudOffsetB;
    uniform vec3 cloudOffsetC;
    uniform vec3 dustOffset;
    uniform vec3 skyBasisX;
    uniform vec3 skyBasisY;
    uniform vec3 skyBasisZ;
    uniform vec3 baseColor;
    uniform vec3 coolColor;
    uniform vec3 warmColor;
    uniform vec3 roseColor;
    uniform vec3 violetColor;
    uniform vec3 paleColor;
    uniform vec3 cameraBasisX;
    uniform vec3 cameraBasisY;
    uniform vec3 cameraBasisZ;
    uniform vec2 cameraFovScale;
    varying vec2 vUv;

    float hash(vec3 p) {
      p += hashSeed;
      p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);

      float n000 = hash(i + vec3(0.0, 0.0, 0.0));
      float n100 = hash(i + vec3(1.0, 0.0, 0.0));
      float n010 = hash(i + vec3(0.0, 1.0, 0.0));
      float n110 = hash(i + vec3(1.0, 1.0, 0.0));
      float n001 = hash(i + vec3(0.0, 0.0, 1.0));
      float n101 = hash(i + vec3(1.0, 0.0, 1.0));
      float n011 = hash(i + vec3(0.0, 1.0, 1.0));
      float n111 = hash(i + vec3(1.0, 1.0, 1.0));

      float nx00 = mix(n000, n100, f.x);
      float nx10 = mix(n010, n110, f.x);
      float nx01 = mix(n001, n101, f.x);
      float nx11 = mix(n011, n111, f.x);
      float nxy0 = mix(nx00, nx10, f.y);
      float nxy1 = mix(nx01, nx11, f.y);
      return mix(nxy0, nxy1, f.z);
    }

    float fbm(vec3 p) {
      float value = 0.0;
      float amplitude = 0.55;
      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p);
        p *= 2.08;
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      p *= cameraFovScale;
      vec3 cameraDir = normalize(cameraBasisX * p.x + cameraBasisY * p.y + cameraBasisZ);
      vec3 dir = normalize(vec3(dot(cameraDir, skyBasisX), dot(cameraDir, skyBasisY), dot(cameraDir, skyBasisZ)));
      float bandTilt = mix(-0.65, 0.65, hash(vec3(2.0, 7.0, 11.0)));
      float band = pow(1.0 - abs(dir.y * 0.95 + dir.x * bandTilt), 2.4);
      float cloudA = fbm(dir * 3.2 + cloudOffsetA + vec3(0.0, 0.0, time * 0.005));
      float cloudB = fbm(dir * 8.0 + cloudOffsetB);
      float cloudC = fbm(dir * 5.4 + cloudOffsetC);
      float nebula = smoothstep(0.38, 0.82, cloudA) * band;
      nebula += smoothstep(0.5, 0.88, cloudB) * band * 0.35;
      float warmNebula = smoothstep(0.42, 0.9, cloudC) * band;
      float violetNebula = smoothstep(0.6, 0.94, cloudB + cloudC * 0.35) * band;
      float dustLane = smoothstep(0.5, 0.9, fbm(dir * 12.0 + dustOffset)) * band;

      vec3 base = baseColor;
      vec3 blueCloud = coolColor * nebula * 0.65;
      vec3 goldCloud = warmColor * warmNebula * 0.45;
      vec3 roseCloud = roseColor * violetNebula * 0.24;
      vec3 violetCloud = violetColor * pow(violetNebula, 2.0) * 0.28;
      vec3 paleCloud = paleColor * pow(nebula + warmNebula, 2.0) * 0.24;

      vec3 starCell = floor(dir * 420.0);
      float starRand = hash(starCell);
      float star = smoothstep(0.996, 1.0, starRand);
      float brightStar = smoothstep(0.9995, 1.0, starRand);
      vec3 starColor = mix(vec3(0.55, 0.68, 1.0), vec3(1.0, 0.96, 0.82), hash(starCell + 4.7));
      float blinkChance = smoothstep(0.45, 1.0, hash(starCell + 17.3));
      float blinkRate = mix(0.55, 2.2, hash(starCell + 9.1));
      float blinkClock = time * blinkRate + hash(starCell + 22.4) * 40.0;
      float blinkWindow = floor(blinkClock);
      float blinkT = fract(blinkClock);
      float blinkSeed = hash(starCell + vec3(blinkWindow, blinkWindow * 2.17, blinkWindow * 3.31));
      float twinkle = pow(smoothstep(0.78, 0.98, blinkT) * (1.0 - smoothstep(0.98, 1.0, blinkT)), 0.8);
      twinkle *= smoothstep(0.35, 1.0, blinkSeed);
      float blink = 0.55 + 0.45 * twinkle * blinkChance;
      float sparkleChance = smoothstep(0.88, 1.0, hash(starCell + 31.7));
      float sparkleRate = mix(0.25, 1.1, hash(starCell + 42.2));
      float sparkleClock = time * sparkleRate + hash(starCell + 51.9) * 70.0;
      float sparkleWindow = floor(sparkleClock);
      float sparkleT = fract(sparkleClock);
      float sparkleSeed = hash(starCell + vec3(sparkleWindow * 4.7, sparkleWindow, sparkleWindow * 1.9));
      float sparkle = smoothstep(0.78, 0.92, sparkleT) * (1.0 - smoothstep(0.92, 1.0, sparkleT));
      sparkle *= sparkleChance * smoothstep(0.72, 1.0, sparkleSeed);

      vec3 color = base + blueCloud + paleCloud;
      color += starColor * star * blink * 1.15;
      color += vec3(1.0) * brightStar * (0.7 + 1.2 * twinkle * blinkChance);
      color += vec3(0.85, 0.92, 1.0) * star * sparkle * 2.2;
      color += goldCloud + roseCloud + violetCloud;
      color *= 1.0 - dustLane * 0.35;
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
const backgroundScene = new Scene();
const backgroundCamera = new Camera();
const background = new Mesh(new PlaneGeometry(2, 2), starfieldMaterial);
backgroundScene.add(background);

const moonMapLight = new DirectionalLight(0xffffff, 2.2);
moonMapLight.position.set(-3, 1.4, 4);
scene.add(moonMapLight);

const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 160_000_000);

const renderer = new WebGLRenderer({ antialias: true });
renderer.autoClear = false;
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

function createTilesRenderer({ url, levels }) {
  const tiles = new TilesRenderer();
  tiles.registerPlugin(
    new XYZTilesPlugin({
      url,
      shape: 'ellipsoid',
      endCaps: false,
      levels,
    }),
  );
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  scene.add(tiles.group);
  return tiles;
}

const tileRenderers = Object.fromEntries(
  Object.entries(TILE_SOURCES).map(([key, source]) => [key, createTilesRenderer(source)]),
);
let activeTileRenderer = tileRenderers.openStreetMap;
Object.values(tileRenderers).forEach((tiles) => {
  tiles.group.visible = tiles === activeTileRenderer;
});

// Wireframe ellipsoid matching WGS84 (radius.x/y equatorial, radius.z polar, Z-axis = pole).
const { radius } = activeTileRenderer.ellipsoid;
const polarLimit = MathUtils.degToRad(85.05113);
const polarPhiLength = Math.PI / 2 - polarLimit;
const northPolarWireframeGeometry = new SphereGeometry(1, 64, 8, 0, Math.PI * 2, 0, polarPhiLength);
northPolarWireframeGeometry.rotateX(Math.PI / 2);
northPolarWireframeGeometry.scale(radius.x, radius.y, radius.z);
const southPolarWireframeGeometry = new SphereGeometry(1, 64, 8, 0, Math.PI * 2, Math.PI - polarPhiLength, polarPhiLength);
southPolarWireframeGeometry.rotateX(Math.PI / 2);
southPolarWireframeGeometry.scale(radius.x, radius.y, radius.z);
const wireframeMaterial = new MeshBasicMaterial({ color: 0x66ccff, wireframe: true });
const northPolarWireframe = new Mesh(
  northPolarWireframeGeometry,
  wireframeMaterial,
);
const southPolarWireframe = new Mesh(
  southPolarWireframeGeometry,
  wireframeMaterial,
);
northPolarWireframe.visible = true;
southPolarWireframe.visible = true;
scene.add(northPolarWireframe, southPolarWireframe);

const tileShadowGeometry = new SphereGeometry(1, 96, 48);
tileShadowGeometry.rotateX(Math.PI / 2);
tileShadowGeometry.scale(radius.x, radius.y, radius.z);

const tileShadowMaterial = new ShaderMaterial({
  uniforms: {
    lightDirection: { value: new Vector3(-0.55, 0.25, 0.8).normalize() },
    opacity: { value: 0.72 },
  },
  vertexShader: `
    varying vec3 vWorldNormal;

    void main() {
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 lightDirection;
    uniform float opacity;
    varying vec3 vWorldNormal;

    void main() {
      float light = dot(normalize(vWorldNormal), normalize(lightDirection));
      float lit = smoothstep(-0.12, 0.25, light);
      gl_FragColor = vec4(0.0, 0.0, 0.0, (1.0 - lit) * opacity);
    }
  `,
  transparent: true,
  depthWrite: false,
});
const tileShadow = new Mesh(tileShadowGeometry, tileShadowMaterial);
tileShadow.renderOrder = 10;
tileShadow.scale.setScalar(1.002);
tileShadow.visible = false;
scene.add(tileShadow);

const textureLoader = new TextureLoader();
const moonColorMap = textureLoader.load(`${import.meta.env.BASE_URL}moon/lroc_color_poles_8k.jpg`);
moonColorMap.colorSpace = SRGBColorSpace;

const moonMapGeometry = new SphereGeometry(1, 256, 128);
moonMapGeometry.rotateX(Math.PI / 2);
moonMapGeometry.scale(radius.x, radius.y, radius.z);
const moonMapLitMaterial = new MeshStandardMaterial({
  map: moonColorMap,
  roughness: 1,
});
const moonMapFlatMaterial = new MeshBasicMaterial({
  map: moonColorMap,
});
const moonMap = new Mesh(moonMapGeometry, moonMapLitMaterial);
moonMap.visible = false;
scene.add(moonMap);

const controls = new GlobeControls(scene, camera, renderer.domElement, activeTileRenderer);
controls.enableDamping = true;

// Place the camera directly above San Francisco, looking straight down, with north up.
// azimuth=0 → facing north; elevation=-π/2 → pitched down to nadir; roll=0.
const cameraFrame = new Matrix4();
activeTileRenderer.ellipsoid.getObjectFrame(
  MathUtils.degToRad(SAN_FRANCISCO.lat),
  MathUtils.degToRad(SAN_FRANCISCO.lon),
  VIEW_HEIGHT_METERS,
  0,
  -Math.PI / 2,
  0,
  cameraFrame,
  CAMERA_FRAME,
);
camera.matrixAutoUpdate = false;
camera.matrix.copy(cameraFrame);
camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
camera.matrixAutoUpdate = true;
camera.updateMatrixWorld();

const settings = {
  tileSource: TILE_SOURCES.openStreetMap.label,
  moonMapShadows: true,
};
const gui = new GUI({ title: 'three-tiles' });
gui.add(settings, 'tileSource', [
  TILE_SOURCES.openStreetMap.label,
  TILE_SOURCES.moon.label,
  MOON_MAP_LABEL,
  NONE_LABEL,
]).name('Tiles').onChange((value) => {
  const sourceKey = Object.entries(TILE_SOURCES).find(([, source]) => source.label === value)?.[0];
  activeTileRenderer = sourceKey ? tileRenderers[sourceKey] : tileRenderers.moon;

  if (value === MOON_MAP_LABEL) {
    controls.setScene(moonMap);
    controls.setEllipsoid(activeTileRenderer.ellipsoid, activeTileRenderer.group);
  } else {
    controls.setTilesRenderer(activeTileRenderer);
  }
});
gui.add(settings, 'moonMapShadows').name('Shadows').onChange((value) => {
  moonMap.material = value ? moonMapLitMaterial : moonMapFlatMaterial;
});

const compassNeedle = document.getElementById('compass-needle');
const compassButton = document.getElementById('compass');
const _tmpMat = new Matrix4();
const _carto = { lat: 0, lon: 0, height: 0, azimuth: 0, elevation: 0, roll: 0 };
const _cameraBasisX = new Vector3();
const _cameraBasisY = new Vector3();
const _cameraBasisZ = new Vector3();

function readCameraCartographic() {
  _tmpMat.copy(activeTileRenderer.group.matrixWorld).invert().multiply(camera.matrixWorld);
  activeTileRenderer.ellipsoid.getCartographicFromObjectFrame(_tmpMat, _carto, CAMERA_FRAME);
  return _carto;
}

let northAnim = null;
const _targetQuat = new Quaternion();
const _targetPos = new Vector3();
const _targetScale = new Vector3();

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

compassButton.addEventListener('click', () => {
  const { lat, lon, height, elevation } = readCameraCartographic();
  const frame = new Matrix4();
  activeTileRenderer.ellipsoid.getObjectFrame(lat, lon, height, 0, elevation, 0, frame, CAMERA_FRAME);
  frame.premultiply(activeTileRenderer.group.matrixWorld);
  frame.decompose(_targetPos, _targetQuat, _targetScale);

  northAnim = {
    startQuat: camera.quaternion.clone(),
    startTime: performance.now(),
    duration: 500,
  };
});

renderer.domElement.addEventListener('pointerdown', () => {
  northAnim = null;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  Object.values(tileRenderers).forEach((tiles) => {
    tiles.setResolutionFromRenderer(camera, renderer);
  });
});

function animate() {
  requestAnimationFrame(animate);
  starfieldMaterial.uniforms.time.value = performance.now() * 0.001;
  controls.update();
  camera.updateMatrixWorld();
  camera.matrixWorld.extractBasis(_cameraBasisX, _cameraBasisY, _cameraBasisZ);
  starfieldMaterial.uniforms.cameraBasisX.value.copy(_cameraBasisX);
  starfieldMaterial.uniforms.cameraBasisY.value.copy(_cameraBasisY);
  starfieldMaterial.uniforms.cameraBasisZ.value.copy(_cameraBasisZ).negate();
  const fovY = Math.tan(MathUtils.degToRad(camera.fov) / 2);
  starfieldMaterial.uniforms.cameraFovScale.value.set(fovY * camera.aspect, fovY);
  Object.values(tileRenderers).forEach((tiles) => {
    tiles.group.updateMatrixWorld();
  });

  if (northAnim) {
    const t = Math.min((performance.now() - northAnim.startTime) / northAnim.duration, 1);
    camera.quaternion.slerpQuaternions(northAnim.startQuat, _targetQuat, easeInOutCubic(t));
    camera.updateMatrixWorld();
    if (t >= 1) northAnim = null;
  }

  Object.values(tileRenderers).forEach((tiles) => {
    const isActive = tiles === activeTileRenderer && settings.tileSource !== NONE_LABEL && settings.tileSource !== MOON_MAP_LABEL;
    tiles.group.visible = isActive;
    if (isActive) {
      tiles.update();
    }
  });
  moonMap.visible = settings.tileSource === MOON_MAP_LABEL;
  northPolarWireframe.visible = settings.tileSource !== MOON_MAP_LABEL;
  southPolarWireframe.visible = settings.tileSource !== MOON_MAP_LABEL;
  moonMapLight.visible = moonMap.visible && settings.moonMapShadows;
  tileShadow.visible =
    settings.moonMapShadows &&
    settings.tileSource !== MOON_MAP_LABEL &&
    settings.tileSource !== NONE_LABEL;

  const azDeg = MathUtils.radToDeg(readCameraCartographic().azimuth);
  compassNeedle.setAttribute('transform', `rotate(${-azDeg})`);

  renderer.clear();
  renderer.render(backgroundScene, backgroundCamera);
  renderer.clearDepth();
  renderer.render(scene, camera);
}

animate();
