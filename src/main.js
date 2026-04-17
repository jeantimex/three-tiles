import './style.css';
import {
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { TilesRenderer, GlobeControls, CAMERA_FRAME } from '3d-tiles-renderer';
import { XYZTilesPlugin } from '3d-tiles-renderer/plugins';
import GUI from 'lil-gui';

const SAN_FRANCISCO = { lat: 37.7749, lon: -122.4194 };
const VIEW_HEIGHT_METERS = 12_000_000;
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
const wireframeGeometry = new SphereGeometry(1, 64, 32);
wireframeGeometry.rotateX(-Math.PI / 2);
wireframeGeometry.scale(radius.x, radius.y, radius.z);
const wireframe = new Mesh(
  wireframeGeometry,
  new MeshBasicMaterial({ color: 0x66ccff, wireframe: true }),
);
wireframe.visible = true;
wireframe.scale.setScalar(0.999);
scene.add(wireframe);

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

const settings = { tileSource: TILE_SOURCES.openStreetMap.label };
const gui = new GUI({ title: 'three-tiles' });
gui.add(settings, 'tileSource', [
  TILE_SOURCES.openStreetMap.label,
  TILE_SOURCES.moon.label,
  'None',
]).name('Tiles').onChange((value) => {
  const sourceKey = Object.entries(TILE_SOURCES).find(([, source]) => source.label === value)?.[0];
  activeTileRenderer = sourceKey ? tileRenderers[sourceKey] : tileRenderers.openStreetMap;
  controls.setTilesRenderer(activeTileRenderer);
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
    const isActive = tiles === activeTileRenderer && settings.tileSource !== 'None';
    tiles.group.visible = isActive;
    if (isActive) {
      tiles.update();
    }
  });

  const azDeg = MathUtils.radToDeg(readCameraCartographic().azimuth);
  compassNeedle.setAttribute('transform', `rotate(${-azDeg})`);

  renderer.render(scene, camera);
}

animate();
