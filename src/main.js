import './style.css';
import {
  AmbientLight,
  DirectionalLight,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
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

const moonMapLight = new DirectionalLight(0xffffff, 2.2);
moonMapLight.position.set(-3, 1.4, 4);
scene.add(moonMapLight);

const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 160_000_000);

const renderer = new WebGLRenderer({ antialias: true });
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
  controls.update();
  camera.updateMatrixWorld();
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

  renderer.render(scene, camera);
}

animate();
