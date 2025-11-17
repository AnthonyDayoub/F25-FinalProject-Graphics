import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// Import orbit controls for testing
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // ✨ Removed, you have a custom camera

// ✨ 1. Added Clock for physics
const clock = new THREE.Clock();

// --- Basic Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01030a); // Night sky
scene.fog = new THREE.FogExp2(0x040b16, 0.012);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const defaultCameraPosition = new THREE.Vector3(0, 7, 20);
const defaultCameraTarget = new THREE.Vector3(0, 2, -5);
camera.position.copy(defaultCameraPosition);
camera.lookAt(defaultCameraTarget);
const listener = new THREE.AudioListener();
camera.add(listener);
const audioContext = listener.context;

// Camera follow helpers
const chaseLerpFactor = 0.12;
const idleLerpFactor = 0.05;
const carWorldPosition = new THREE.Vector3();
const carWorldQuaternion = new THREE.Quaternion();
let carModel = null;

// Camera / car sizing helpers
// const carBoundingBox = new THREE.Box3(); // Unused, can remove if you want
// const carSize = new THREE.Vector3(); // Unused, can remove if you want
const followSpherical = new THREE.Spherical(8, THREE.MathUtils.degToRad(42), 0);
let minCameraDistance = 4;
let maxCameraDistance = 0;
const minPolarAngle = THREE.MathUtils.degToRad(20);
const maxPolarAngle = THREE.MathUtils.degToRad(70);
const pointerRotationSpeed = 0.0055;
const scrollZoomFactor = 0.004;
const relativeCameraOffset = new THREE.Vector3();
const desiredCameraPosition = new THREE.Vector3();
const lookAtOffset = new THREE.Vector3(0, 1.5, 0);
const lookAtTarget = new THREE.Vector3();
const pointerState = {
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0
};

// --- Texture + Audio Helpers ---
const createCanvasTexture = (drawFn, size = 512, isColor = true) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    drawFn(ctx, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return texture;
};

const createStripedTexture = ({ colorA, colorB, stripes = 10, size = 1024 }) => createCanvasTexture((ctx, dim) => {
    const stripeHeight = dim / stripes;
    for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 === 0 ? colorA : colorB;
        ctx.fillRect(0, i * stripeHeight, dim, stripeHeight);
    }
}, size, true);

const createNormalMapTexture = (size = 512, intensity = 0.35) => createCanvasTexture((ctx, dim) => {
    const base = 128;
    for (let y = 0; y < dim; y++) {
        for (let x = 0; x < dim; x++) {
            const angle = Math.sin((x / dim) * Math.PI * 8 + (y / dim) * Math.PI * 4);
            const nx = base + angle * 64 * intensity;
            const ny = base + Math.cos((y / dim) * Math.PI * 6) * 64 * intensity;
            const nz = 255;
            ctx.fillStyle = `rgb(${nx},${ny},${nz})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }
}, size, false);

const createNoiseTexture = (size = 512, darkness = 0.2) => createCanvasTexture((ctx, dim) => {
    const imageData = ctx.createImageData(dim, dim);
    for (let i = 0; i < imageData.data.length; i += 4) {
        const shade = 200 - Math.random() * 80 * darkness;
        imageData.data[i] = shade;
        imageData.data[i + 1] = shade;
        imageData.data[i + 2] = shade;
        imageData.data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
}, size, false);

const createArrowTexture = (size = 512) => createCanvasTexture((ctx, dim) => {
    ctx.clearRect(0, 0, dim, dim);
    const gradient = ctx.createLinearGradient(0, 0, dim, dim);
    gradient.addColorStop(0, '#00f6ff');
    gradient.addColorStop(1, '#ff2dfb');
    ctx.fillStyle = gradient;
    ctx.shadowColor = '#1effff';
    ctx.shadowBlur = 25;
    ctx.beginPath();
    ctx.moveTo(dim * 0.15, dim * 0.1);
    ctx.lineTo(dim * 0.85, dim * 0.5);
    ctx.lineTo(dim * 0.15, dim * 0.9);
    ctx.lineTo(dim * 0.25, dim * 0.5);
    ctx.closePath();
    ctx.fill();
}, size, true);

const createLoopingAudioBuffer = (audioContext, frequency = 120, duration = 2, variance = 0.25) => {
    const sampleRate = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const wobble = Math.sin(2 * Math.PI * variance * t) * 0.35;
        data[i] = Math.sin(2 * Math.PI * frequency * t) * (0.4 + wobble);
    }
    return buffer;
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true; // Enable shadows
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.domElement.style.cursor = 'grab';
renderer.domElement.style.touchAction = 'none';
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const environmentTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = environmentTexture;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector3(1, 1, 1), 1.25, 0.4, 0.85);
composer.addPass(bloomPass);
const afterimagePass = new AfterimagePass(0.78);
composer.addPass(afterimagePass);
const filmPass = new FilmPass(0.45, 0.025, 648, false);
composer.addPass(filmPass);

// --- All your custom camera event listeners (unchanged) ---
const releasePointerCapture = (event) => {
    if (renderer.domElement.hasPointerCapture && renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
    }
};

const stopPointerDrag = (event) => {
    if (pointerState.pointerId !== event.pointerId) {
        return;
    }
    pointerState.dragging = false;
    pointerState.pointerId = null;
    renderer.domElement.style.cursor = 'grab';
    releasePointerCapture(event);
};

const onPointerDown = (event) => {
    if (event.button !== 0) return;
    pointerState.dragging = true;
    pointerState.pointerId = event.pointerId;
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
};

const onPointerMove = (event) => {
    if (!pointerState.dragging || pointerState.pointerId !== event.pointerId) {
        return;
    }
    event.preventDefault();
    const deltaX = event.clientX - pointerState.lastX;
    const deltaY = event.clientY - pointerState.lastY;
    followSpherical.theta -= deltaX * pointerRotationSpeed;
    followSpherical.phi = THREE.MathUtils.clamp(
        followSpherical.phi + deltaY * pointerRotationSpeed,
        minPolarAngle,
        maxPolarAngle
    );
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
};

const onWheel = (event) => {
    event.preventDefault();
    followSpherical.radius = THREE.MathUtils.clamp(
        followSpherical.radius + event.deltaY * scrollZoomFactor,
        minCameraDistance,
        maxCameraDistance
    );
};

renderer.domElement.addEventListener('pointerdown', onPointerDown);
renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('pointerup', stopPointerDrag);
renderer.domElement.addEventListener('pointerleave', stopPointerDrag);
renderer.domElement.addEventListener('pointercancel', stopPointerDrag);
renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
// --- End of camera listeners ---

// --- Lights ---
const hemiLight = new THREE.HemisphereLight(0x0f1f3c, 0x010101, 0.55);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0x2bb1ff, 1.2);
keyLight.position.set(18, 26, 6);
keyLight.castShadow = true;
keyLight.shadow.bias = -0.0008;
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0xff2dfb, 2.4, 120, 2);
rimLight.position.set(-10, 12, 5);
scene.add(rimLight);

// --- Floor ---
const floorGeometry = new THREE.PlaneGeometry(100, 100);
const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x491057, 
    side: THREE.DoubleSide
});
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2; // Rotate it to be horizontal
floor.position.y = 0; // Position it at the origin
floor.receiveShadow = true; // Allow the floor to receive shadows
scene.add(floor);

// --- Track + Environment (cyber F1 loop) ---
const trackGroup = new THREE.Group();
trackGroup.name = 'trackGroup';

const trackWidth = 10;
const trackNormalMap = createNormalMapTexture(1024, 0.6);
const trackRoughnessMap = createNoiseTexture(1024, 0.85);
const trackEmissiveMap = createStripedTexture({ colorA: '#011429', colorB: '#03253f', stripes: 36 });
trackEmissiveMap.wrapT = THREE.MirroredRepeatWrapping;

const guardRailMaterial = new THREE.MeshStandardMaterial({
    color: 0x00f7ff,
    emissive: 0x00f7ff,
    emissiveIntensity: 1.4,
    metalness: 0.85,
    roughness: 0.25,
    roughnessMap: trackRoughnessMap,
    metalnessMap: trackRoughnessMap,
    aoMap: trackRoughnessMap,
    aoMapIntensity: 0.5,
    envMapIntensity: 1.3
});

const trackSegmentMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x050505,
    emissive: 0x02112c,
    emissiveIntensity: 0.65,
    metalness: 0.9,
    roughness: 0.45,
    roughnessMap: trackRoughnessMap,
    metalnessMap: trackRoughnessMap,
    normalMap: trackNormalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    emissiveMap: trackEmissiveMap,
    clearcoat: 0.55,
    clearcoatRoughness: 0.2,
    aoMap: trackRoughnessMap,
    aoMapIntensity: 0.7,
    envMapIntensity: 1.1
});

const arrowTexture = createArrowTexture(512);
const createNeonArrow = (zOffset, tilt = 0) => {
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 5),
        new THREE.MeshBasicMaterial({
            map: arrowTexture,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        })
    );
    plane.position.set(0, 0.26, zOffset);
    plane.rotation.set(-Math.PI / 2, 0, tilt);
    return plane;
};

const ensureAO = (geometry) => {
    if (geometry.attributes.uv && !geometry.attributes.uv2) {
        geometry.setAttribute('uv2', geometry.attributes.uv.clone());
    }
};

const createTrackSurface = (length) => {
    const geometry = new THREE.BoxGeometry(trackWidth, 0.4, length, 14, 1, Math.max(12, Math.floor(length / 2)));
    ensureAO(geometry);
    const mesh = new THREE.Mesh(geometry, trackSegmentMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.z = -length / 2;
    return mesh;
};

const createGuardRail = (length, offsetX) => {
    const rail = new THREE.Mesh(
        (() => {
            const geometry = new THREE.BoxGeometry(0.4, 0.9, length, 1, 1, Math.max(6, Math.floor(length / 4)));
            ensureAO(geometry);
            return geometry;
        })(),
        guardRailMaterial
    );
    rail.castShadow = true;
    rail.receiveShadow = true;
    rail.position.set(offsetX, 0.65, -length / 2);
    return rail;
};

const trackSectionsConfig = [
    { length: 40, turn: THREE.MathUtils.degToRad(-10), bank: THREE.MathUtils.degToRad(6), elevation: 0 },
    { length: 34, turn: THREE.MathUtils.degToRad(-24), bank: THREE.MathUtils.degToRad(11), elevation: 0.8 },
    { length: 52, turn: THREE.MathUtils.degToRad(18), bank: THREE.MathUtils.degToRad(-8), elevation: -0.5 },
    { length: 28, turn: THREE.MathUtils.degToRad(32), bank: THREE.MathUtils.degToRad(14), elevation: 0.6 },
    { length: 44, turn: THREE.MathUtils.degToRad(-32), bank: THREE.MathUtils.degToRad(-7), elevation: -0.4 },
    { length: 30, turn: THREE.MathUtils.degToRad(18), bank: THREE.MathUtils.degToRad(9), elevation: 0.3 },
    { length: 38, turn: THREE.MathUtils.degToRad(-18), bank: THREE.MathUtils.degToRad(-12), elevation: 0 },
    { length: 32, turn: THREE.MathUtils.degToRad(15), bank: THREE.MathUtils.degToRad(7), elevation: 0.4 },
    { length: 30, turn: THREE.MathUtils.degToRad(20), bank: THREE.MathUtils.degToRad(-9), elevation: -0.2 },
    { length: 48, turn: THREE.MathUtils.degToRad(-13), bank: THREE.MathUtils.degToRad(5), elevation: 0 }
];

const headingAxis = new THREE.Vector3(0, 1, 0);
const trackAdvance = new THREE.Vector3();
let currentHeading = 0;
const currentPosition = new THREE.Vector3(0, 0.2, 0);
const trackSurfaceReferences = [];

trackSectionsConfig.forEach((sectionConfig, index) => {
    const section = new THREE.Group();
    section.name = `trackSection_${index}`;
    section.position.copy(currentPosition);
    section.rotation.y = currentHeading;
    trackGroup.add(section);

    const surface = createTrackSurface(sectionConfig.length);
    surface.rotation.z = sectionConfig.bank;
    surface.position.y = sectionConfig.elevation;
    section.add(surface);
    trackSurfaceReferences.push({ surface, length: sectionConfig.length });

    const leftRail = createGuardRail(sectionConfig.length, trackWidth / 2 + 0.4);
    leftRail.rotation.z = sectionConfig.bank;
    leftRail.position.y = 0.6 + sectionConfig.elevation;
    section.add(leftRail);

    const rightRail = createGuardRail(sectionConfig.length, -trackWidth / 2 - 0.4);
    rightRail.rotation.z = sectionConfig.bank;
    rightRail.position.y = 0.6 + sectionConfig.elevation;
    section.add(rightRail);

    for (let i = 1; i <= 3; i++) {
        const arrow = createNeonArrow((-sectionConfig.length * i) / 4, sectionConfig.bank);
        section.add(arrow);
    }

    const halo = new THREE.Mesh(
        new THREE.TorusGeometry(2.6, 0.08, 12, 80),
        new THREE.MeshStandardMaterial({
            color: 0xff2dfb,
            emissive: 0xff2dfb,
            emissiveIntensity: 0.8,
            transparent: true,
            opacity: 0.85
        })
    );
    halo.position.set(0, 2.2 + sectionConfig.elevation, -sectionConfig.length * 0.65);
    halo.rotation.x = Math.PI / 2;
    halo.rotation.z = sectionConfig.bank;
    section.add(halo);

    trackAdvance.set(0, 0, -sectionConfig.length);
    trackAdvance.applyAxisAngle(headingAxis, currentHeading);
    currentPosition.add(trackAdvance);
    currentPosition.y += sectionConfig.elevation * 0.2;
    currentHeading += sectionConfig.turn;
});

scene.add(trackGroup);

const pointInPolygon = (polygon, x, z) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x;
        const zi = polygon[i].y;
        const xj = polygon[j].x;
        const zj = polygon[j].y;
        const intersect = ((zi > z) !== (zj > z)) &&
            (x < ((xj - xi) * (z - zi)) / (zj - zi + Number.EPSILON) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

trackGroup.updateMatrixWorld(true);
const boundaryInnerPoints = [];
const boundaryOuterPoints = [];

trackSurfaceReferences.forEach(({ surface, length }) => {
    const samples = Math.max(6, Math.floor(length / 5));
    for (let i = 0; i <= samples; i++) {
        const z = -length * (i / samples);
        const innerLocal = new THREE.Vector3(trackWidth / 2, 0.08, z);
        const outerLocal = new THREE.Vector3(-trackWidth / 2, 0.08, z);
        const innerWorld = innerLocal.clone();
        const outerWorld = outerLocal.clone();
        surface.localToWorld(innerWorld);
        surface.localToWorld(outerWorld);
        boundaryInnerPoints.push(new THREE.Vector2(innerWorld.x, innerWorld.z));
        boundaryOuterPoints.push(new THREE.Vector2(outerWorld.x, outerWorld.z));
    }
});

const trackSpawnPoint = boundaryInnerPoints[10]
    ? new THREE.Vector3(boundaryInnerPoints[10].x, 0.35, boundaryInnerPoints[10].y)
    : new THREE.Vector3(0, 0.35, 2);

const trackBoundaryHelper = {
    contains: (x, z) => pointInPolygon(boundaryOuterPoints, x, z) && !pointInPolygon(boundaryInnerPoints, x, z),
    spawnPoint: trackSpawnPoint,
    spawnHeading: currentHeading
};

// --- City + Sky (neon metropolis) ---
const cityBlocks = new THREE.Group();
cityBlocks.name = 'cityBlocks';
const skyStuff = new THREE.Group();
skyStuff.name = 'skyStuff';

const buildingNormalMap = createNormalMapTexture(512, 0.25);
const buildingRoughnessMap = createNoiseTexture(512, 0.5);
const windowEmissionTexture = createStripedTexture({ colorA: '#14f1ff', colorB: '#ff2dfb', stripes: 6 });

const createBuilding = ({ width, height, depth, color, emissive = 0x0b1c2f }) => {
    const buildingGroup = new THREE.Group();
    const bodyGeometry = new THREE.BoxGeometry(width, height, depth);
    ensureAO(bodyGeometry);
    const body = new THREE.Mesh(
        bodyGeometry,
        new THREE.MeshStandardMaterial({
            color,
            metalness: 0.65,
            roughness: 0.35,
            roughnessMap: buildingRoughnessMap,
            metalnessMap: buildingRoughnessMap,
            normalMap: buildingNormalMap,
            emissive,
            emissiveIntensity: 0.25
        })
    );
    body.position.y = height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    buildingGroup.add(body);

    const windowMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x00c3ff,
        emissiveIntensity: 1.2,
        emissiveMap: windowEmissionTexture,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide
    });

    for (let y = 2; y < height; y += 1.5) {
        const window = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.8, 0.2), windowMaterial);
        window.position.set(0, y, depth / 2 + 0.01);
        buildingGroup.add(window);
        const backWindow = window.clone();
        backWindow.position.z = -depth / 2 - 0.01;
        backWindow.rotation.y = Math.PI;
        buildingGroup.add(backWindow);
    }

    const holoBillboard = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.7, height * 0.25),
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            map: windowEmissionTexture,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide
        })
    );
    holoBillboard.position.set(0, height * 0.65, depth / 2 + 0.2);
    buildingGroup.add(holoBillboard);

    const antennaGeometry = new THREE.CylinderGeometry(0.1, 0.1, 2, 8);
    ensureAO(antennaGeometry);
    const antenna = new THREE.Mesh(
        antennaGeometry,
        new THREE.MeshStandardMaterial({
            color: 0x0ff8ff,
            emissive: 0x0ff8ff,
            emissiveIntensity: 1.1
        })
    );
    antenna.position.y = height + 1;
    buildingGroup.add(antenna);

    return buildingGroup;
};

const cityGridSize = 5;
const blockSpacing = 14;
for (let x = -cityGridSize; x <= cityGridSize; x++) {
    for (let z = 0; z < 6; z++) {
        const height = 10 + Math.random() * 18;
        const width = 4 + Math.random() * 3;
        const depth = 4 + Math.random() * 3;
        const building = createBuilding({
            width,
            height,
            depth,
            color: new THREE.Color().setHSL(0.6 + Math.random() * 0.15, 0.4, 0.15 + Math.random() * 0.1),
            emissive: 0x051129
        });
        building.position.set(x * blockSpacing + (Math.random() - 0.5) * 4, 0, -z * blockSpacing - 20);
        cityBlocks.add(building);
    }
}

cityBlocks.scale.set(1.5, 1.5, 1.5);
cityBlocks.position.set(0, 0, -10);

const flyingBillboard = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 4),
    new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x00a8ff,
        emissiveMap: windowEmissionTexture,
        emissiveIntensity: 1.4,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92
    })
);
flyingBillboard.position.set(-6, 8, -12);
flyingBillboard.rotation.y = Math.PI / 5;
skyStuff.add(flyingBillboard);

const drone = new THREE.Group();
const droneBody = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 24, 24),
    new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.7,
        roughness: 0.2,
        emissive: 0x00e1ff,
        emissiveIntensity: 0.5
    })
);
drone.add(droneBody);
const droneProp = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.08, 12, 24),
    new THREE.MeshStandardMaterial({ color: 0xffd200, emissive: 0xff8900, emissiveIntensity: 0.6 })
);
droneProp.rotation.x = Math.PI / 2;
drone.add(droneProp);
drone.position.set(4, 6, -6);

const droneAudio = new THREE.PositionalAudio(listener);
droneAudio.setBuffer(createLoopingAudioBuffer(audioContext, 160, 2, 0.4));
droneAudio.setLoop(true);
droneAudio.setRefDistance(6);
droneAudio.setVolume(0.3);
droneAudio.play();
drone.add(droneAudio);
skyStuff.add(drone);

const distantTraffic = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 8, 8),
    new THREE.MeshStandardMaterial({
        color: 0xff5132,
        emissive: 0xff3300,
        emissiveIntensity: 1.2
    })
);
distantTraffic.position.set(0, 7, -30);
skyStuff.add(distantTraffic);

const skyBeacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.8),
    new THREE.MeshStandardMaterial({
        color: 0xff2dfb,
        emissive: 0xff2dfb,
        emissiveIntensity: 1.6
    })
);
skyBeacon.position.set(8, 10, -15);
skyStuff.add(skyBeacon);

skyStuff.scale.set(1.3, 1.3, 1.3);
skyStuff.position.set(0, 1, -8);

scene.add(cityBlocks, skyStuff);

// --- ✨ 2. Removed the old OrbitControls section ---
// const controls = new OrbitControls(camera, renderer.domElement);
// controls.enabled = true; 
// controls.target.set(0, 2, -5);
// controls.update();

// --- CarControls Class ---
class CarControls {
    constructor(model, trackGuard, engineAudio) {
        this.model = model;
        this.trackGuard = trackGuard;
        this.engineAudio = engineAudio;
        this.speed = 0;
        this.maxSpeed = 26;
        this.acceleration = 8;
        this.brakeStrength = 3.2;
        this.drag = 0.45;
        this.steering = 0;
        this.maxSteer = 0.9;
        this.steerSpeed = 2.4;
        this.forwardVector = new THREE.Vector3(0, 0, -1);
        this.movementVector = new THREE.Vector3();
        this.proposedPosition = new THREE.Vector3();
        this.previousValidPosition = model.position.clone();
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false
        };
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
    }
    onKeyDown(event) {
        switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
            this.keys.forward = true;
            break;
        case 'KeyS':
        case 'ArrowDown':
            this.keys.backward = true;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            this.keys.left = true;
            break;
        case 'KeyD':
        case 'ArrowRight':
            this.keys.right = true;
            break;
        }
    }
    onKeyUp(event) {
        switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
            this.keys.forward = false;
            break;
        case 'KeyS':
        case 'ArrowDown':
            this.keys.backward = false;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            this.keys.left = false;
            break;
        case 'KeyD':
        case 'ArrowRight':
            this.keys.right = false;
            break;
        }
    }
    update(deltaTime) {
        if (this.keys.left) {
            this.steering += this.steerSpeed * deltaTime;
        } else if (this.keys.right) {
            this.steering -= this.steerSpeed * deltaTime;
        } else {
            if (this.steering > 0) {
                this.steering -= this.steerSpeed * deltaTime;
                this.steering = Math.max(0, this.steering);
            } else if (this.steering < 0) {
                this.steering += this.steerSpeed * deltaTime;
                this.steering = Math.min(0, this.steering);
            }
        }
        this.steering = THREE.MathUtils.clamp(this.steering, -this.maxSteer, this.maxSteer);

        if (this.keys.forward) {
            this.speed += this.acceleration * deltaTime;
        } else if (this.keys.backward) {
            this.speed -= this.brakeStrength * deltaTime;
        } else {
            if (this.speed > 0) {
                this.speed -= this.drag * deltaTime;
                this.speed = Math.max(0, this.speed);
            } else if (this.speed < 0) {
                this.speed += this.drag * deltaTime;
                this.speed = Math.min(0, this.speed);
            }
        }
        this.speed = THREE.MathUtils.clamp(this.speed, -this.maxSpeed / 2, this.maxSpeed);

        if (Math.abs(this.speed) > 0.01) {
            const steerAngle = this.steering * (this.speed / this.maxSpeed);
            this.model.rotateY(steerAngle * deltaTime);
        }

        const moveDistance = this.speed * deltaTime;
        if (Math.abs(moveDistance) > 0.0001) {
            this.forwardVector.set(0, 0, -1).applyQuaternion(this.model.quaternion);
            this.movementVector.copy(this.forwardVector).multiplyScalar(moveDistance);
            this.proposedPosition.copy(this.model.position).add(this.movementVector);

            if (this.trackGuard.contains(this.proposedPosition.x, this.proposedPosition.z)) {
                this.model.position.copy(this.proposedPosition);
                this.previousValidPosition.copy(this.proposedPosition);
            } else {
                this.speed = 0;
                this.model.position.copy(this.previousValidPosition);
            }
        } else {
            this.previousValidPosition.copy(this.model.position);
        }

        if (this.engineAudio) {
            const normalizedSpeed = THREE.MathUtils.clamp(Math.abs(this.speed) / this.maxSpeed, 0, 1);
            this.engineAudio.setPlaybackRate(0.8 + normalizedSpeed * 1.2);
            this.engineAudio.setVolume(0.2 + normalizedSpeed * 0.8);
        }
    }
}

// --- carController variable (unchanged) ---
let carController;

// --- Model Loader Logic (unchanged) ---
const loader = new GLTFLoader();

loader.setPath('cyberpunk_car/'); 

loader.load(
    'scene.gltf',
    function (gltf) {
        console.log("Model loaded successfully:", gltf);
        const model = gltf.scene;
        model.scale.set(0.0035, 0.0035, 0.0035);
        model.traverse(function (node) {
            if (node.isMesh) {
                node.castShadow = true;
            }
        });
        
        carModel = model;
        scene.add(model);
        
        // Initialize the CarControls with track boundary helper
        carController = new CarControls(carModel, trackBoundaryHelper);
    },
    function (xhr) {
        console.log((xhr.loaded / xhr.total * 100) + '% loaded');
    },
    function (error) {
        console.error('An error happened while loading the model:', error);
    }
);

// --- ✨ 3. UPDATED Render Loop ---
function animate() {
    requestAnimationFrame(animate);

    // Get time delta for physics
    const deltaTime = clock.getDelta();

    // ✨ 4. ADDED this block to update the car driving
    if (carController) {
        carController.update(deltaTime);
    }

    // This is your new custom camera logic (unchanged)
    if (carModel) {
        carModel.getWorldPosition(carWorldPosition);
        carModel.getWorldQuaternion(carWorldQuaternion);

        followSpherical.radius = THREE.MathUtils.clamp(
            followSpherical.radius,
            minCameraDistance,
            maxCameraDistance
        );
        relativeCameraOffset.setFromSpherical(followSpherical);
        relativeCameraOffset.applyQuaternion(carWorldQuaternion);

        desiredCameraPosition.copy(carWorldPosition).add(relativeCameraOffset);
        camera.position.lerp(desiredCameraPosition, chaseLerpFactor);

        lookAtTarget.copy(carWorldPosition).add(lookAtOffset);
        camera.lookAt(lookAtTarget);
    } else {
        camera.position.lerp(defaultCameraPosition, idleLerpFactor);
        camera.lookAt(defaultCameraTarget);
    }

    renderer.render(scene, camera);
}

// Handle window resize (unchanged)
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}, false);

// Start the animation (unchanged)
animate();
