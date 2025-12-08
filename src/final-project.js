import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// --- CONFIGURATION CONSTANTS ---
const ENGINE_CLASSES = {
    '50cc': { maxSpeed: 80, accel: 30, brake: 60, steer: 0.02, gravity: 150 },
    '100cc': { maxSpeed: 100, accel: 40, brake: 55, steer: 0.02, gravity: 170 },
    '150cc': { maxSpeed: 120, accel: 45, brake: 50, steer: 0.02, gravity: 180 }, 
    '200cc': { maxSpeed: 180, accel: 80, brake: 50, steer: 0.02, gravity: 200 }
};

const CAR_MODELS = {
    'cyber': { 
        name: 'Cyber Car', 
        path: 'cyberpunk_car.glb', 
        scale: 1,
        rotation: Math.PI,      
        zOffset: 0,
        yOffset: -1,      
        wheelNames: ["Object_99", "Object_93"],
        fixPivot: true,
        hasCockpit: false,
        steeringWheelName: null,
        steeringAxis: null,
        fixSteeringPivot: false,
        invertSteering: false,
    },
    'bmw': { 
        name: 'BMW M4 GTS', 
        path: '2016_bmw_m4_gts.glb',
        scale: 200,         
        rotation: Math.PI,  
        zOffset: 0,
        yOffset: -0.5,       
        wheelNames: [ 'tire', 'carwheel'],
        fixPivot: true,
        hasCockpit: true,
        steeringWheelName: ["steering_wheel"],
        steeringAxis: 'y',
        fixSteeringPivot: true,
        invertSteering: false


                                  
        
    },
    'x5': {
        name: 'BMW X5 (2019)',
        path: '2019_bmw_x5_xdrive30d.glb',
        scale: 200,
        rotation: Math.PI,
        zOffset: 0,
        yOffset: -0.5,
        wheelNames: [
            'tire_0',
            'rim_black_0',
            'rim_chrome_0',
            'disk_1',
            'disk_2'
        ],
        fixPivot: true,
        spinAxis: 'x',
        disableWheelSpin: true,
        hasCockpit: true,
        steeringWheelName: [],
        steeringAxis: 'y',
        fixSteeringPivot: false,
        invertSteering: false
    },
    'civic': { 
        name: 'Honda Civic Type R', 
        path: 'honda_civic.glb',
        scale: 200,         
        rotation: Math.PI, 
        zOffset: 0,
        yOffset: -0.5,   
        wheelNames: ["308", "314", "361", "317", "448", "311", "343", "598", "334", "337", "634", "340", "353", "691", "727",  "327",  "454", "356", "347", "350", "324", "330", "321"],
        fixPivot: true,
        hasCockpit: true,
        steeringWheelName: ["87" , "90"],
        steeringAxis: 'z',
        fixSteeringPivot: true,
        invertSteering: false,
        wheelstoFlip: ["356", "347", "350", "324", "330", "321"],
    
    },
    'supra': { 
        name: 'Toyota Supra', 
        path: 'supra.glb',
        scale: 2,         
        rotation: Math.PI,   
        zOffset: 0,
        yOffset: -.5,   
        wheelNames: ["120", "149"],
        fixPivot: true,
        hasCockpit: true,
        steeringWheelName: ["204", "205"],
        steeringAxis: 'y',
        fixSteeringPivot: true,
        invertSteering: true

    },
    'odyssey': { 
        name: 'Honda Odyssey', 
        path: 'odyssey.glb',
        scale: 0.02,         
        rotation: 0,   
        zOffset: 0,
        yOffset: -.5,    
        wheelNames: ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "46", "47", "48"],
        fixPivot: true,
        hasCockpit: true,
        steeringWheelName: ["204", "205"],
        steeringAxis: 'y',
        fixSteeringPivot: true,
        invertSteering: true
    }
};

let GAME_STATE = {
    mode: 'traditional', // 5 laps or endless
    engine: '150cc',
    car: 'cyber',
    isPlaying: false
};

// --- ANTI-GHOST SYSTEM ---
window.gameLoopId = null;

const clock = new THREE.Clock();

// --- UI Elements ---
const uiSpeed = document.getElementById('speed-display');

const btnReset = document.getElementById('reset-btn');

// --- Time Trial UI ---
const uiTimeCurrent = document.getElementById('time-current');
const uiTimeBest = document.getElementById('time-best');
const uiLapCount = document.getElementById('lap-count');

// --- Format Time ---
function formatTime(seconds) {
    if (seconds === Infinity) return "--:--.--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds * 100) % 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

// --- CAMERA STATE ---
let cameraMode = 0; // 0 = Chase, 1 = Hood/Cockpit
const cameraOffsets = [
    // Mode 0: Chase (Calculated dynamically via spherical, so we leave this blank/unused)
    null, 

    // Mode 1: Hood Cam (Up 2.5, Forward 1.0)
    new THREE.Vector3(0, 2.5, -1.0),
    new THREE.Vector3(0, 1.7, 0.8)   // Mode 2: Cockpit (Lower & Inside)

    
];


// --- Basic Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01030a); 
scene.fog = new THREE.FogExp2(0x040b16, 0.002);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
const defaultCameraPosition = new THREE.Vector3(0, 10, 20);
const defaultCameraTarget = new THREE.Vector3(0, 0, 0);
camera.position.copy(defaultCameraPosition);
camera.lookAt(defaultCameraTarget);

// --- AUDIO SETUP  ---
const listener = new THREE.AudioListener();
camera.add(listener); // Listener stays on camera (Ears)

let carController = null;
const audioLoader = new THREE.AudioLoader();

// PositionalAudio 
const idleSound = new THREE.PositionalAudio(listener);
const accelerationSound = new THREE.PositionalAudio(listener);
const driftSound = new THREE.PositionalAudio(listener); 

// MUSIC & SFX (Global / 2D) 
const bgmNormal = new THREE.Audio(listener);
const bgmFast   = new THREE.Audio(listener);
const sfxFanfare = new THREE.Audio(listener);
const bgmMenu = new THREE.Audio(listener);


// Configure 3D Sound Settings
// RefDistance: Sound is full volume within this distance (e.g., 10 units)
// RolloffFactor: How fast it gets quiet as you move away
function configureSound(sound) {
    sound.setRefDistance(10); 
    sound.setRolloffFactor(0.5); 
    sound.setDistanceModel('linear'); // Smooth fading
}

configureSound(idleSound);
configureSound(accelerationSound);
configureSound(driftSound);

const tryAttachAudio = () => {
    if (carController && idleSound.buffer && accelerationSound.buffer && driftSound.buffer) {
        carController.setEngineAudio(idleSound, accelerationSound, driftSound);
    }
};


audioLoader.load('idle.mp3', (buffer) => {
    idleSound.setBuffer(buffer);
    idleSound.setLoop(true);
    idleSound.setVolume(0);
    tryAttachAudio();
});
audioLoader.load('acceleration.mp3', (buffer) => {
    accelerationSound.setBuffer(buffer);
    accelerationSound.setLoop(true);
    accelerationSound.setVolume(0); 
    tryAttachAudio();
});
audioLoader.load('drift.mp3', (buffer) => {
    driftSound.setBuffer(buffer);
    driftSound.setLoop(true);
    driftSound.setVolume(0);  
    tryAttachAudio();
});


audioLoader.load('menu.mp3', (buffer) => {
    bgmMenu.setBuffer(buffer);
    bgmMenu.setLoop(true); // Loop forever
    bgmMenu.setVolume(1);

    
});

// --- LOAD MUSIC ---
audioLoader.load('bgm.mp3', (buffer) => {
    bgmNormal.setBuffer(buffer);
    bgmNormal.setLoop(true);
    bgmNormal.setVolume(1);
});

audioLoader.load('bgmfast.mp3', (buffer) => {
    bgmFast.setBuffer(buffer);
    bgmFast.setLoop(true);
    bgmFast.setVolume(1);
});

audioLoader.load('fanfare.mp3', (buffer) => {
    sfxFanfare.setBuffer(buffer);
    sfxFanfare.setLoop(false); 
    sfxFanfare.setVolume(1.5);
});

// Camera follow helpers
const chaseLerpFactor = 1.12;
const carWorldPosition = new THREE.Vector3();
const carWorldQuaternion = new THREE.Quaternion();
let carModel = null;

// Camera / car sizing helpers
const followSpherical = new THREE.Spherical(15, THREE.MathUtils.degToRad(60), 0);
let minCameraDistance = 5;
let maxCameraDistance = 30;
const minPolarAngle = THREE.MathUtils.degToRad(20);
const maxPolarAngle = THREE.MathUtils.degToRad(85);
const pointerRotationSpeed = 0.0055;
const scrollZoomFactor = 0.05;
const relativeCameraOffset = new THREE.Vector3();
const desiredCameraPosition = new THREE.Vector3();
const lookAtOffset = new THREE.Vector3(0, 2, 0);
const lookAtTarget = new THREE.Vector3();
const pointerState = { dragging: false, pointerId: null, lastX: 0, lastY: 0 };

// --- COLLISION GLOBAL ---
const mapColliders = []; 
const animatedObjects = [];
const ghostColliders = [];

const renderer = new THREE.WebGLRenderer({ 
    antialias: true});
renderer.shadowMap.enabled = true; 
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.domElement.style.cursor = 'grab';
renderer.domElement.style.touchAction = 'none';
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

scene.environment = null; // Neon style

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector3(1, 1, 1), 1.6, 0.35, 0.9);
composer.addPass(bloomPass);

// --- Pointer / camera events ---
const releasePointerCapture = (event) => {
    if (renderer.domElement.hasPointerCapture && renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
    }
};
const stopPointerDrag = (event) => {
    if (pointerState.pointerId !== event.pointerId) return;
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
    if (!pointerState.dragging || pointerState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - pointerState.lastX;
    const deltaY = event.clientY - pointerState.lastY;
    followSpherical.theta -= deltaX * pointerRotationSpeed;
    followSpherical.phi = THREE.MathUtils.clamp(followSpherical.phi + deltaY * pointerRotationSpeed, minPolarAngle, maxPolarAngle);
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
};
const onWheel = (event) => {
    event.preventDefault();
    followSpherical.radius = THREE.MathUtils.clamp(followSpherical.radius + event.deltaY * scrollZoomFactor, minCameraDistance, maxCameraDistance);
};

renderer.domElement.addEventListener('pointerdown', onPointerDown);
renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('pointerup', stopPointerDrag);
renderer.domElement.addEventListener('pointerleave', stopPointerDrag);
renderer.domElement.addEventListener('pointercancel', stopPointerDrag);
renderer.domElement.addEventListener('wheel', onWheel, { passive: false });


// --- Lights ---
function setupNeonLighting() {
    const ambient = new THREE.AmbientLight(0x2a1036, 0.25); 
    scene.add(ambient);

    const cyanDir = new THREE.DirectionalLight(0x5cf7ff, 0.9);
    cyanDir.position.set(1, 1.2, 0.4);
    cyanDir.castShadow = false;
    scene.add(cyanDir);

    const pinkDir = new THREE.DirectionalLight(0xff5cf1, 0.9);
    pinkDir.position.set(-1, 1.1, -0.5);
    pinkDir.castShadow = false;
    scene.add(pinkDir);
}
setupNeonLighting();

const cityNeonLights = [];
function addCityNeonLights() {
    const lightSets = [
        { pos: new THREE.Vector3(80, 40, 0), color: 0x5cf7ff },
        { pos: new THREE.Vector3(-80, 40, 0), color: 0xff5cf1 },
        { pos: new THREE.Vector3(0, 35, 120), color: 0x5cf7ff },
        { pos: new THREE.Vector3(0, 35, -120), color: 0xff5cf1 },
        { pos: new THREE.Vector3(140, 30, 140), color: 0xff5cf1 },
        { pos: new THREE.Vector3(-140, 30, -140), color: 0x5cf7ff },
        { pos: new THREE.Vector3(140, 30, -140), color: 0x5cf7ff },
        { pos: new THREE.Vector3(-140, 30, 140), color: 0xff5cf1 },
    ];

    lightSets.forEach(({ pos, color }) => {
        const l = new THREE.PointLight(color, 12, 280, 2);
        l.position.copy(pos);
        l.castShadow = false;
        scene.add(l);
        cityNeonLights.push(l);
    });
}
addCityNeonLights();

// --- Map sectoring ---
const trackSectors = [];
const trackSectorMap = new Map();
const sectorWorkVec = new THREE.Vector3();
const bboxHelper = new THREE.Box3();
const sizeHelper = new THREE.Vector3();
const trackSectorSize = 200; 
let trackRenderDistance = 400; 
let sectorCullingEnabled = true;
const carBoundsHelper = new THREE.Box3();
const carSizeHelper = new THREE.Vector3();
const carCenterHelper = new THREE.Vector3();

function styleMeshForNeon(child) {
    if (!child.material) return;
    bboxHelper.setFromObject(child);
    bboxHelper.getSize(sizeHelper);
    const isBuilding = sizeHelper.y > 15 && sizeHelper.y > sizeHelper.x * 0.7 && sizeHelper.y > sizeHelper.z * 0.7;
    const isTrack = !isBuilding && sizeHelper.y < 12 && (sizeHelper.x > 6 || sizeHelper.z > 6);
    const treatAsTrack = isTrack || !isBuilding; 
    const neonPalette = [0x00c8ff, 0xff3fb3];
    const neonColor = neonPalette[child.id % neonPalette.length];

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const styled = materials.map((mat) => {
        const clone = mat.clone();
        clone.metalness = treatAsTrack ? 0.65 : Math.max(0.5, clone.metalness ?? 0.5);
        clone.roughness = treatAsTrack ? 0.28 : Math.min(0.35, clone.roughness ?? 0.35);
        clone.envMapIntensity = treatAsTrack ? 1.1 : 1.6;

        if (treatAsTrack) {
            clone.emissive = new THREE.Color(0x0c1228);
            clone.emissiveIntensity = 0.6;
        } else if (isBuilding) {
            clone.emissive = new THREE.Color(neonColor);
            clone.emissiveIntensity = 1.8;
        } else {
            clone.emissiveIntensity = clone.emissiveIntensity ?? 0.35;
        }
        return clone;
    });
    child.material = Array.isArray(child.material) ? styled : styled[0];
}

// Painting to look like Anthony's Car
function applyBlackPaint(model) {
    if(model )
    model.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat) => {
            const name = (mat.name || '').toLowerCase();
         
            if (!name.includes('carpaint')) return;
            if (mat.color) mat.color.set('#111111');
            if ('metalness' in mat) mat.metalness = Math.max(mat.metalness ?? 0.6, 0.85);
            if ('roughness' in mat) mat.roughness = 0.28;
        });
    });
}

// Headlights and Tailights Setup
function setupCarLighting(model) {
    // Calculate Local Bounds
    carBoundsHelper.setFromObject(model);
    carBoundsHelper.getSize(carSizeHelper);
    carBoundsHelper.getCenter(carCenterHelper);
    
    // Convert World Center to Local Center
    const localCenter = new THREE.Vector3().copy(carCenterHelper).sub(model.position);
    
    // COMMON CONFIG
    const xOffset = carSizeHelper.x * 0.3; 
    // Headlights sit slightly lower than roof, Taillights slightly higher than bumper
    const yPos = localCenter.y + (carSizeHelper.y * 0.1); 

    // --- VISIBILITY FILL LIGHT ---
    // A soft light that hovers above the car so it's never too dark to see.
    // Intensity: 3.0 (Bright enough to see paint, not bright enough to blind you)
    // Distance: 25 (Small radius, so it doesn't light up the ground too much)
    const fillLight = new THREE.PointLight(0xffffff,800.0, 20);
    
  
    fillLight.position.set(localCenter.x, yPos + 10.0, localCenter.z + 2.0);
    fillLight.castShadow = false;
    model.add(fillLight);

    // --- FRONT LIGHTS ---
    const frontZ = localCenter.z - (carSizeHelper.z * 0.5) + 0.5; 
    const frontReach = Math.max(300, carSizeHelper.z * 30);
    const headBulbGeom = new THREE.SphereGeometry(0.001, 16, 16);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const makeHeadLight = (xSign) => {
        const light = new THREE.SpotLight(0xffffff, 300, frontReach, Math.PI / 3, 0.3, 1.2);
        light.castShadow = false;
        light.position.set(localCenter.x + xSign * xOffset, yPos, frontZ);
        
        const target = new THREE.Object3D();
        target.position.set(localCenter.x + xSign * xOffset, yPos, frontZ - 100); // Point Forward (-Z)
        
        model.add(target);
        light.target = target;
        model.add(light);
        
        const bulb = new THREE.Mesh(headBulbGeom, headMat);
        bulb.position.copy(light.position);
        bulb.renderOrder = 10;
        model.add(bulb);
    };

    // --- REAR LIGHTS ---
    const backZ = localCenter.z + (carSizeHelper.z * 0.5) - 0.4;
    const tailReach = 50; 
    const tailBulbGeom = new THREE.BoxGeometry(0.001, 0.001, .001); // Rectangular look
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red Color

    const makeTailLight = (xSign) => {
        const light = new THREE.SpotLight(0xff0000, 100, tailReach, Math.PI / 2, 0.5, 1);
        light.castShadow = false;
        light.position.set(localCenter.x + xSign * xOffset, yPos, backZ);

        const target = new THREE.Object3D();
        target.position.set(localCenter.x + xSign * xOffset, yPos, backZ + 50);
        
        model.add(target);
        light.target = target;
        model.add(light);

        const lens = new THREE.Mesh(tailBulbGeom, tailMat);
        lens.position.copy(light.position);
        lens.renderOrder = 10;
        model.add(lens);
    };

    makeHeadLight(1);  // Left Front
    makeHeadLight(-1); // Right Front
    makeTailLight(1);  // Left Rear
    makeTailLight(-1); // Right Rear
}

function updateSectorVisibility(carPos) {
    if (!sectorCullingEnabled || !trackSectors.length) return;
    trackSectors.forEach((sector) => {
        if (!sector.anchor) return;
        sector.anchor.getWorldPosition(sectorWorkVec);
        const visible = carPos.distanceTo(sectorWorkVec) < trackRenderDistance;
        sector.meshes.forEach((mesh) => {
            mesh.visible = visible;
        });
    });
}

// --- SPONSOR BILLBOARD ---
function createSponsorBillboard(position) {

    if (scene.getObjectByName("MoravianSign")) {
        return; 
    }
    const loader = new THREE.TextureLoader();
    
    loader.load('MVU_Logo.png', (texture) => {
        

        const wrapper = new THREE.Group();
        wrapper.name = "MoravianSign";
        wrapper.position.copy(position);
        scene.add(wrapper);

        const poleGeo = new THREE.CylinderGeometry(1, 1, 45, 16);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.8 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = -20; 
        wrapper.add(pole);

   
        const signGroup = new THREE.Group();
        wrapper.add(signGroup); 
      
        const boxGeo = new THREE.BoxGeometry(62, 22, 2); 
        const boxMat = new THREE.MeshPhongMaterial({ 
        color: 0x111111,
        emissive: 0x00ffcc,
        emissiveIntensity: 0.01
        });
        const box = new THREE.Mesh(boxGeo, boxMat);
        signGroup.add(box);

    
        const planeGeo = new THREE.PlaneGeometry(60, 20);
        const planeMat = new THREE.MeshBasicMaterial({ 
            map: texture,
            side: THREE.DoubleSide, 
            transparent: true
        });
        const frontImage = new THREE.Mesh(planeGeo, planeMat);
        frontImage.position.z = 1.1;
        signGroup.add(frontImage);


        const backImage = frontImage.clone();
        backImage.rotation.y = Math.PI; 
        backImage.position.z = -1.1; 
        signGroup.add(backImage);

    
        animatedObjects.push(signGroup);
        
  
    });
}

// --- Safety Net ---
function addSafetyNet() {
    const geometry = new THREE.BoxGeometry(5000, 1, 5000);
    const material = new THREE.MeshBasicMaterial({ color: 0x0000ff, visible: false });
    const safetyFloor = new THREE.Mesh(geometry, material);
    
    safetyFloor.position.set(0, -20, 0); 
    safetyFloor.name = 'SafetyNet'; 
    
    scene.add(safetyFloor);
    

    mapColliders.push(safetyFloor); 
}
addSafetyNet();




// Time Trial Manager
class TimeTrialManager {
    constructor(uiCurrent, uiBest, uiLap) {
        this.uiCurrent = uiCurrent;
        this.uiBest = uiBest;
        this.uiLap = uiLap;
        this.lapTimes = [];
        
        this.lap = 1;
        this.bestTime = Infinity;
        
      
        this.lapStartTime = 0; 
        this.totalStartTime = 0; 
        this.currentLapDuration = 0;
        
        this.isRunning = false;
        this.isWarmup = true; 

   
        this.minLapTime = 5.0; 

    
        this.lastUITime = 0;   
        this.uiUpdateRate = 65; 
        this.workVec = new THREE.Vector3(); 
        this.workQuat = new THREE.Quaternion(); 
        this.yAxis = new THREE.Vector3(0, 1, 0);

        // Checkpoints Config
        this.checkpoints = [
            { pos: new THREE.Vector3(370, 25, -130), rot: 0, radius: 20, passed: false }, 
            { pos: new THREE.Vector3(80, 47, 615), rot: 1.5, radius: 35, passed: false },
            { pos: new THREE.Vector3(4, 10, 80), rot: 0, radius: 15, passed: false, isFinish: true } 
        ];
        
        this.nextCheckpointIndex = 0;
        this.debugMeshes = [];

        // Create Checkpoint Visuals
        this.checkpoints.forEach((cp) => {
            const geometry = new THREE.BoxGeometry(cp.radius * 3.0, 25, 1);
            const material = new THREE.MeshBasicMaterial({ 
                color: cp.isFinish ? 0x00ff00 : 0x00ffff, 
                transparent: true, opacity: 0.25, side: THREE.DoubleSide, 
                depthWrite: false, blending: THREE.AdditiveBlending 
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(cp.pos);
            mesh.position.y += 10; 
            mesh.rotation.y = cp.rot; 
            scene.add(mesh);
            this.debugMeshes.push(mesh);
        });
    }

    start() {
        this.isWarmup = true;
        this.isRunning = false;
        this.lapTimes = [];

 
        if (bgmNormal.isPlaying) bgmNormal.stop();
        if (bgmFast.isPlaying) bgmFast.stop();
        if (sfxFanfare.isPlaying) sfxFanfare.stop();

        
        
        if (this.uiCurrent) {
            this.uiCurrent.innerText = "WARMUP";
            this.uiCurrent.style.color = '#ffaa00'; 
        }

        if (GAME_STATE.mode === 'traditional') {
            document.getElementById('max-laps').innerText = "/ 5";
        } else {
            document.getElementById('max-laps').innerText = "";
        }
        
        this.nextCheckpointIndex = 2; // Look for finish line first
        this.lap = 1;
        this.resetCheckpointsVisuals();
    }
    
    fullReset() {
        this.lap = 1;
        this.bestTime = Infinity;
        this.lapTimes = [];
        if (this.uiBest) this.uiBest.innerText = "--:--.--";
        if (this.uiLap) this.uiLap.innerText = this.lap;
        this.start(); 
    }

    resetCheckpointsVisuals() {
        this.checkpoints.forEach(cp => cp.passed = false);
        this.debugMeshes.forEach((m, idx) => {
            const isFin = this.checkpoints[idx].isFinish;
            m.material.color.setHex(isFin ? 0x00ff00 : 0x00ffff);
            m.material.opacity = 0;
        });
    }

    update(carPosition) {
        const now = performance.now();

        if (this.isRunning) {
            const totalRaceTime = (now - this.totalStartTime) / 1000.0;
            
            if (now - this.lastUITime > this.uiUpdateRate) {
                if (this.uiCurrent) this.uiCurrent.innerText = formatTime(totalRaceTime);
                this.lastUITime = now;
            }
        }

        const targetCP = this.checkpoints[this.nextCheckpointIndex];
        const targetMesh = this.debugMeshes[this.nextCheckpointIndex];

        this.workVec.copy(carPosition).sub(targetCP.pos);
        this.workQuat.setFromAxisAngle(this.yAxis, -targetCP.rot); 
        this.workVec.applyQuaternion(this.workQuat);

        const gateHalfWidth = (targetCP.radius * 3.0) / 2.0; 
        const gateThickness = 6.0; 

        if (Math.abs(this.workVec.x) < gateHalfWidth && Math.abs(this.workVec.z) < gateThickness) {
            

            if (targetMesh.material.opacity < 0.05) {
                targetMesh.material.color.setHex(0x333333);
                targetMesh.material.opacity = 0.1;
            }

            if (targetCP.isFinish) {
                if (this.isWarmup) {
                   
                  
                    this.isWarmup = false;
                    this.isRunning = true;

                    if (bgmNormal.buffer && !bgmNormal.isPlaying) {
                        bgmNormal.play();
                    }
                    
                    this.lapTimes = [];
                    const startT = performance.now();
                    this.totalStartTime = startT;
                    this.lapStartTime = startT; // Start Lap 1 Timer
                    
                    if(this.uiCurrent) this.uiCurrent.style.color = '#00ffcc';
                    
                    this.nextCheckpointIndex = 0;
                    this.resetCheckpointsVisuals();
                } else {
                 
                    const potentialDuration = (performance.now() - this.lapStartTime) / 1000.0;

                    if (potentialDuration > this.minLapTime) {
                        const lapEndT = performance.now();
                        const duration = (lapEndT - this.lapStartTime) / 1000.0;
                   
                        this.lapStartTime = lapEndT;
                        this.completeLap(duration);
                        
                    }
                }
            } else {
            
                this.nextCheckpointIndex++;
            }
        } 
        else if (targetMesh.material.opacity === 0) {
            targetMesh.material.color.setHex(0xffff00);
            targetMesh.material.opacity = 0.0; 
        }
    }

    completeLap(duration) {
        this.lapTimes.push(duration);
       

        if (duration < this.bestTime) {
            this.bestTime = duration;
            if (this.uiBest) this.uiBest.innerText = formatTime(this.bestTime);
            if (this.uiCurrent) {
                this.uiCurrent.style.color = '#00ff00';
                setTimeout(() => { if(this.uiCurrent) this.uiCurrent.style.color = '#00ffcc'; }, 1000);
            }
        }

        // Check for Race Finish (Traditional Mode)
        if (GAME_STATE.mode === 'traditional' && this.lap >= 5) {
            this.endGame();
            return;
        }

        if (GAME_STATE.mode === 'traditional' && this.lap === 4) {
       
            if (bgmNormal.isPlaying) bgmNormal.stop();
            if (bgmFast.buffer) bgmFast.play();
        }

        this.lap++;
        if (this.uiLap) this.uiLap.innerText = this.lap;
        
        this.nextCheckpointIndex = 0;
        this.resetCheckpointsVisuals();
    }

    endGame() {
        if (carController) carController.canDrive = false;
        this.isRunning = false;

        // 1. STOP ALL MUSIC
        if (bgmNormal.isPlaying) bgmNormal.stop();
        if (bgmFast.isPlaying) bgmFast.stop();
        if (sfxFanfare.buffer) sfxFanfare.play();
        idleSound.setVolume(0);
        accelerationSound.setVolume(0);
        driftSound.setVolume(0);

        // 2. GET LAPS 
        let lapsToCount = this.lapTimes;
        if (GAME_STATE.mode === 'traditional') {
             lapsToCount = this.lapTimes.slice(-5);
        }

        const totalTime = lapsToCount.reduce((a, b) => a + b, 0);

        // 3. UPDATE UI
        const uiContainer = document.getElementById('ui-container');
        const resultsScreen = document.getElementById('results-screen');
        
        if (uiContainer) uiContainer.classList.add('hidden');
        if (resultsScreen) resultsScreen.classList.remove('hidden');
        
        // Connect to HTML elements
        const lapElements = [
            document.getElementById('res-lap1'),
            document.getElementById('res-lap2'),
            document.getElementById('res-lap3'),
            document.getElementById('res-lap4'),
            document.getElementById('res-lap5')
        ];
        const lTotal = document.getElementById('res-total');

        // Best Lap Logic
        let bestTime = Infinity;
        let bestIndex = -1;

        lapsToCount.forEach((time, index) => {
            if (lapElements[index]) {
                lapElements[index].innerText = formatTime(time);
                lapElements[index].style.color = "white"; 
                lapElements[index].style.textShadow = "none";
                lapElements[index].style.fontWeight = "normal";
            }
            
            if (time < bestTime) {
                bestTime = time;
                bestIndex = index;
            }
        });


        if (bestIndex !== -1 && lapElements[bestIndex]) {
            const winner = lapElements[bestIndex];
            winner.style.color = "#FFD700"; 
            winner.style.textShadow = "0 0 10px #FFD700, 0 0 20px #FFAA00"; 
            winner.style.fontWeight = "bold";
        }
        
        if (lTotal) lTotal.innerText = formatTime(totalTime);
    }
}
    const timeTrial = new TimeTrialManager(uiTimeCurrent, uiTimeBest, uiLapCount);
    
    function createSmokeTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        

        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 28);
        
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');    
        grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)'); 
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');     
        
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
}

class CarControls {
    constructor(model, idleSoundRef, accelerationSoundRef, driftSoundRef, physicsStats, wheelKeywords=[], shouldFixPivot = false, spinAxis = 'x', steeringWheelNames = [], steeringAxis = 'z', fixSteeringPivot = false, invertSteering, disableWheelSpin = false, wheelstoFlip = []) {
    
        this.model = model;
        this.invertSteering = invertSteering;
        this.spinAxis = spinAxis || 'x';
        this.disableWheelSpin = disableWheelSpin;
        this.wheelstoFlip = wheelstoFlip;
        

        
        
        // Wheel Setup
        this.wheels = [];
        const foundWheelMeshes = [];
        if (wheelKeywords.length > 0) {
            this.model.traverse((child) => {
                if (child.isMesh) {
                    const isWheel = wheelKeywords.some(keyword => {
                        if (keyword.startsWith('=')) return child.name === keyword.substring(1);
                        return child.name.toLowerCase().includes(keyword.toLowerCase());
                    });
                    if (isWheel) foundWheelMeshes.push(child);
                }
            });
        }
        // Wheel Pivot Logic
        foundWheelMeshes.forEach(mesh => {
            if (shouldFixPivot) {
                const box = new THREE.Box3().setFromObject(mesh);
                const center = new THREE.Vector3();
                box.getCenter(center);
                const pivot = new THREE.Group();
                pivot.name = mesh.name;
                mesh.parent.add(pivot);
                pivot.position.copy(mesh.parent.worldToLocal(center.clone()));
                pivot.attach(mesh);
                this.wheels.push(pivot);
            } else {
                this.wheels.push(mesh);
            }
        });
    


    
        this.steeringParts = [];
        this.steeringAxis = steeringAxis; 
        if (!Array.isArray(steeringWheelNames)) {
            if (typeof steeringWheelNames === 'string') {
                steeringWheelNames = [steeringWheelNames];
            } else {
                steeringWheelNames = []; // 
            }
        }

        if (steeringWheelNames && steeringWheelNames.length > 0) {
            const rawSteeringParts = [];
            this.model.traverse((child) => {
                if (child.isMesh || child.type === 'Group') {
                    const isMatch = steeringWheelNames.some(keyword => {
                        if (keyword.startsWith('=')) return child.name === keyword.substring(1);
                        return child.name.toLowerCase().includes(keyword.toLowerCase());
                    });
                    if (isMatch) rawSteeringParts.push(child);
                }
            });

            rawSteeringParts.forEach(part => {
                if (fixSteeringPivot) { 
                    
        
                    const box = new THREE.Box3().setFromObject(part);
                    const center = new THREE.Vector3();
                    box.getCenter(center);

                    const pivot = new THREE.Group();
                    part.parent.add(pivot);

                    pivot.position.copy(part.parent.worldToLocal(center.clone()));

                    pivot.attach(part);

                    this.steeringParts.push(pivot);
                  
                } else {
                    this.steeringParts.push(part);
                }
            });
        }


        
        // --- 1. DYNAMIC CAR STATS ---
        const stats = physicsStats || { maxSpeed: 120, accel: 45, brake: 50, steer: 0.005, gravity: 180 };
        this.maxSpeed = stats.maxSpeed; 
        this.acceleration = stats.accel;
        this.brakeStrength = stats.brake;
        this.maxSteer = stats.steer; 
        this.gravity = stats.gravity;
        this.drag = 0.5;

        // --- 2. PHYSICS CONSTANTS ---
        this.rideHeight = 0.5; 
        this.tiltSpeed = 0.08; 
        this.carLength = 4.0;
        this.wallBounce = 0.2; 

        // --- 3. STATE ---
        this.speed = 0;
        this.velocity = new THREE.Vector3();
        this.moveDirection = new THREE.Vector3(0, 0, -1);
        this.isGrounded = false;
        this.isDriftingState = false;
        this.badObjects = [];
        this.lastSafePosition = new THREE.Vector3(0, 30, 180); 
        this.lastSafeQuaternion = new THREE.Quaternion();
        this.safePosTimer = 0;
        this.groundMemory = 0; 
        this.memoryDuration = 0.1; 
        this.lastValidGroundY = -Infinity;

        // --- 4. RAYCASTERS ---
        this.groundRaycaster = new THREE.Raycaster();
        this.upRaycaster = new THREE.Raycaster();
        this.wallRaycaster = new THREE.Raycaster();

        // --- 5. AUDIO & INPUT ---
        this.idleSound = idleSoundRef || null;
        this.accelerationSound = accelerationSoundRef || null;
        this.driftSound = driftSoundRef || null;
        this.keys = { forward: false, backward: false, left: false, right: false, space: false };
        this.canDrive = true; 

        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));

        // --- 6. VISUAL DEBUGGERS ---
        this.debugMode = false;
        this.arrowSuspension = new THREE.ArrowHelper(new THREE.Vector3(0,-1,0), new THREE.Vector3(), 15, 0x00ff00);
        this.arrowWall = new THREE.ArrowHelper(new THREE.Vector3(0,0,-1), new THREE.Vector3(), 6, 0xff0000);
        this.mindSphere = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 8), new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.5 }));
        scene.add(this.arrowSuspension);
        scene.add(this.arrowWall);
        scene.add(this.mindSphere); 
        this.arrowSuspension.visible = false;
        this.arrowWall.visible = false;
        this.mindSphere.visible = false;

        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'v') {
                this.debugMode = !this.debugMode;
                this.arrowSuspension.visible = this.debugMode;
                this.arrowWall.visible = this.debugMode;
                this.mindSphere.visible = this.debugMode;
            }
        });

        // --- 7. SMOKE PARTICLE SYSTEM ---
        this.smokeParticles = [];
        const smokeTex = createSmokeTexture();
        const smokeMat = new THREE.SpriteMaterial({ map: smokeTex, color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
        for (let i = 0; i < 40; i++) {
            const p = new THREE.Sprite(smokeMat);
            p.visible = false;
            p.scale.set(4, 4, 4); 
            scene.add(p);
            this.smokeParticles.push({ mesh: p, life: 0 });
        }
        this.smokeTimer = 0; 
    }


    setEngineAudio(idle, accel, drift) {
        this.idleSound = idle;
        this.accelerationSound = accel;
        this.driftSound = drift;
        if(this.idleSound && !this.idleSound.isPlaying) this.idleSound.play();
        if(this.accelerationSound && !this.accelerationSound.isPlaying) this.accelerationSound.play();
        if(this.driftSound && !this.driftSound.isPlaying) this.driftSound.play();
        if(this.idleSound) this.idleSound.setVolume(0);
        if(this.accelerationSound) this.accelerationSound.setVolume(0); 
        if(this.driftSound) this.driftSound.setVolume(0);             
    }

    updateEngineAudio() {
        if (!this.idleSound || !this.accelerationSound || !this.driftSound) return;
        if (this.idleSound.context && this.idleSound.context.state === 'suspended') {
            this.idleSound.context.resume();
        }
        const isMoving = Math.abs(this.speed) > 1.0; 
        if (isMoving) {
            if (!this.accelerationSound.isPlaying) this.accelerationSound.play();
            this.accelerationSound.setVolume(0.5);
            const speedRatio = Math.min(Math.abs(this.speed) / this.maxSpeed, 1.0);
            this.accelerationSound.setPlaybackRate(0.8 + (speedRatio * 0.7));
            this.idleSound.setVolume(0);
        } else {
            if (!this.idleSound.isPlaying) this.idleSound.play();
            this.idleSound.setVolume(0.5);
            this.accelerationSound.setVolume(0);
        }
        if (this.isDriftingState && this.isGrounded && Math.abs(this.speed) > 20) {
            if (!this.driftSound.isPlaying) this.driftSound.play();
            const currentVol = this.driftSound.getVolume();
            this.driftSound.setVolume(THREE.MathUtils.lerp(currentVol, 0.6, 0.2));
        } else {
            const currentVol = this.driftSound.getVolume();
            this.driftSound.setVolume(THREE.MathUtils.lerp(currentVol, 0, 0.2));
        }
    }

    manualReset() {
        this.speed = 0;
        this.velocity.set(0, 0, 0);
        this.model.position.set(0, 30, 180); 
        this.model.rotation.set(0, 0, 0);
        this.lastSafePosition.set(0, 30, 180);
        this.moveDirection.set(0, 0, -1);
        this.groundMemory = 0;
    }

    hardRespawn() {
        console.log("Void Respawn");
        this.model.position.copy(this.lastSafePosition);
        this.model.position.y += 2.0; 
        const safeEuler = new THREE.Euler().setFromQuaternion(this.lastSafeQuaternion, 'YXZ');
        this.model.rotation.set(0, safeEuler.y, 0);
        this.moveDirection.set(0, 0, -1).applyEuler(this.model.rotation);
        this.speed = 0;
        this.velocity.set(0,0,0);
        this.safePosTimer = 0;
        this.groundMemory = 0;
    }

    onKeyDown(event) {
        if (!this.canDrive && ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code)) return;
        switch (event.code) {
            case 'KeyW': case 'ArrowUp': this.keys.forward = true; break;
            case 'KeyS': case 'ArrowDown': this.keys.backward = true; break;
            case 'KeyA': case 'ArrowLeft': this.keys.left = true; break;
            case 'KeyD': case 'ArrowRight': this.keys.right = true; break;
            case 'Space': this.keys.space = true; break; 
        }
    }
    onKeyUp(event) {
        switch (event.code) {
            case 'KeyW': case 'ArrowUp': this.keys.forward = false; break;
            case 'KeyS': case 'ArrowDown': this.keys.backward = false; break;
            case 'KeyA': case 'ArrowLeft': this.keys.left = false; break;
            case 'KeyD': case 'ArrowRight': this.keys.right = false; break;
            case 'Space': this.keys.space = false; break;
        }
    }

    spawnSmoke(pos) {
        const p = this.smokeParticles.find(p => p.life <= 0);
        if (p) {
            p.mesh.visible = true;
            p.mesh.position.copy(pos);
            p.mesh.position.x += (Math.random() - 0.5) * 1.5; 
            p.mesh.position.z += (Math.random() - 0.5) * 1.5;
            p.mesh.position.y += 0.5; 
            p.mesh.scale.set(4, 4, 4);
            p.mesh.material.opacity = 0.9;
            p.life = 1.0; 
        }
    }
    updateSmoke(deltaTime) {
        this.smokeParticles.forEach(p => {
            if (p.life > 0) {
                p.life -= deltaTime;
                p.mesh.position.y += deltaTime * 3.0; 
                const scale = 4 + (1.0 - p.life) * 8.0; 
                p.mesh.scale.set(scale, scale, scale);
                p.mesh.material.opacity = p.life * 0.9; 
                if (p.life <= 0) p.mesh.visible = false;
            }
        });
    }

    updateDebugVisuals(suspensionOrigin, wallOrigin, wallDir) {
        if (!this.debugMode) return;
        if (this.arrowSuspension) {
            this.arrowSuspension.position.copy(suspensionOrigin);
            this.arrowSuspension.setDirection(new THREE.Vector3(0, -1, 0));
        }
        if (this.arrowWall) {
            this.arrowWall.position.copy(wallOrigin);
            this.arrowWall.setDirection(wallDir);
        }
        if (this.mindSphere) {
            this.mindSphere.position.copy(wallOrigin);
        }
    }

    checkWallCollisions() {
        if (Math.abs(this.speed) < 1.0) return; 
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        this.model.getWorldPosition(worldPos);
        this.model.getWorldQuaternion(worldQuat);
        const forwardDir = new THREE.Vector3(0, 0, (this.speed > 0 ? -1 : 1));
        forwardDir.applyQuaternion(worldQuat).normalize();
        const rayOrigin = worldPos.clone();
        rayOrigin.y += 2;
        this.wallRaycaster.set(rayOrigin, forwardDir);
        this.wallRaycaster.far = this.carLength + 2.0; 
        const hits = this.wallRaycaster.intersectObjects(mapColliders);
        if (hits.length > 0) {
            const hit = hits[0];
            if (hit.object.name === "SafetyNet") return;
            if (!hit.face || !hit.face.normal) return;
            const normal = hit.face.normal.clone();
            normal.transformDirection(hit.object.matrixWorld).normalize();
            if (isNaN(normal.x) || isNaN(normal.y)) return;
            const specialTolerances = { "Object_40_1": 0.1, "Object_22": 0.8, "Object_34_1": 1.0, "Object_35_1": 1.0, "Object_50_1": 0.3, "Object_7_1" : 0.1, "Object_14_1" : 0.1};
            let activeTolerance = .5; 
            if (specialTolerances[hit.object.name] !== undefined) {
                activeTolerance = specialTolerances[hit.object.name];
            }
            if (Math.abs(normal.y) > activeTolerance) return; 
            if (hit.distance < this.carLength) {
                const impactAngle = forwardDir.dot(normal);
                if (impactAngle < -0.8) {
                    let bounceSpeed = -this.speed * this.wallBounce;
                    if (bounceSpeed < -20) bounceSpeed = -20;
                    if (bounceSpeed > 20) bounceSpeed = 20;
                    this.speed = bounceSpeed;
                    const pushOut = forwardDir.clone().multiplyScalar(-1.5);
                    this.model.position.add(pushOut);
                } else {
                    const slideDir = forwardDir.clone().sub(normal.clone().multiplyScalar(impactAngle));
                    slideDir.normalize();
                    const lookTarget = this.model.position.clone().add(slideDir);
                    this.model.lookAt(lookTarget);
                    this.model.rotateY(Math.PI);
                    this.speed *= 0.4; 
                    const pushOut = normal.clone().multiplyScalar(3.0);
                    this.model.position.add(pushOut);
                }
                this.model.updateMatrixWorld(true);
            }
        }
    }

    // --- MAIN LOOP ---
    update(deltaTime) {
        if (this.canDrive) {
            if (this.keys.forward) this.speed += this.acceleration * deltaTime;
            else if (this.keys.backward) this.speed -= this.brakeStrength * deltaTime;
            else this.speed *= (1 - this.drag * deltaTime);
            this.isDriftingState = this.keys.space && Math.abs(this.speed) > 10;
            if (this.keys.left) this.steering = this.maxSteer * (this.isDriftingState ? 2.0 : 1.0);
            else if (this.keys.right) this.steering = -this.maxSteer * (this.isDriftingState ? 2.0 : 1.0);
            else this.steering = 0;
            this.updateSmoke(deltaTime);
            if (this.isDriftingState && this.isGrounded) {
                this.smokeTimer += deltaTime;
                if (this.smokeTimer > 0.05) { 
                    this.smokeTimer = 0;
                    const worldPos = new THREE.Vector3();
                    this.model.getWorldPosition(worldPos);
                    const worldQuat = new THREE.Quaternion();
                    this.model.getWorldQuaternion(worldQuat);
                    const offsetL = new THREE.Vector3(-1.5, 0, 2.5); 
                    offsetL.applyQuaternion(worldQuat);
                    offsetL.add(worldPos);
                    this.spawnSmoke(offsetL);
                    const offsetR = new THREE.Vector3(1.5, 0, 2.5); 
                    offsetR.applyQuaternion(worldQuat);
                    offsetR.add(worldPos);
                    this.spawnSmoke(offsetR);
                }
            }
        } else {
            this.speed *= (1 - this.drag * deltaTime);
            this.steering = 0;
            this.isDriftingState = false;
            this.updateSmoke(deltaTime);
        }
        this.speed = THREE.MathUtils.clamp(this.speed, -this.maxSpeed, this.maxSpeed);
        if (Math.abs(this.speed) > 0.1) {
            this.model.rotateY(this.steering * (this.speed > 0 ? 1 : -1));
        }
        this.model.updateMatrixWorld(true);
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        this.model.getWorldPosition(worldPos);
        this.model.getWorldQuaternion(worldQuat);
        const forwardDir = new THREE.Vector3(0, 0, (this.speed > 0 ? -1 : 1));
        forwardDir.applyQuaternion(worldQuat).normalize();
        const wallRayOrigin = worldPos.clone(); 
        wallRayOrigin.y += 2.0; 
        const suspRayOrigin = worldPos.clone();
        suspRayOrigin.y += 5.0; 
        this.checkWallCollisions();
        const finalWorldQuat = new THREE.Quaternion();
        this.model.getWorldQuaternion(finalWorldQuat);
        const carFacingDir = new THREE.Vector3(0, 0, -1).applyQuaternion(finalWorldQuat);
        const grip = (this.keys.space && Math.abs(this.speed) > 10) ? 0.12 : 0.8; 
        this.moveDirection.lerp(carFacingDir, grip).normalize();
        if (Math.abs(this.speed) < 5) this.moveDirection.copy(carFacingDir);
        this.velocity.x = this.moveDirection.x * this.speed;
        this.velocity.z = this.moveDirection.z * this.speed;
        
        let rayOrigin = suspRayOrigin.clone();
        this.groundRaycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
        this.groundRaycaster.far = 15.0; 
        let hits = this.groundRaycaster.intersectObjects(mapColliders);
        let groundHit = null;
        if (hits.length > 0) groundHit = hits[0];
        if (!groundHit) {
            this.upRaycaster.set(worldPos, new THREE.Vector3(0, 1, 0));
            this.upRaycaster.far = 5.0; 
            const upHits = this.upRaycaster.intersectObjects(mapColliders);
            if (upHits.length > 0) {
                const roof = upHits[0];
                if (!this.badObjects.includes(roof.object.name)) groundHit = roof; 
            }
        }
        let isRayHittingSomething = false;
        if (groundHit) {
            const name = groundHit.object.name;
            const isBadObject = this.badObjects.includes(name) || name.includes("SafetyNet");
            if (!isBadObject) {
                let groundNormal = groundHit.face.normal.clone().applyQuaternion(groundHit.object.quaternion);
                const angle = groundNormal.angleTo(new THREE.Vector3(0, 1, 0)); 
                if (angle < 1.0 || groundHit.distance < 0) { 
                    const targetY = groundHit.point.y + this.rideHeight;
                    const distToTarget = Math.abs(targetY - this.model.position.y);
                    const snapDistance = 2.0; 
                    if (distToTarget < snapDistance) {
                        isRayHittingSomething = true;
                        this.isGrounded = true;
                        this.groundMemory = this.memoryDuration;
                        this.lastValidGroundY = groundHit.point.y; 
                        this.velocity.y = Math.max(0, this.velocity.y);
                        this.model.position.y = THREE.MathUtils.lerp(this.model.position.y, targetY, 0.5);
                        if (angle < 1.0) {
                            const currentLook = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat);
                            const project = currentLook.clone().sub(groundNormal.clone().multiplyScalar(currentLook.dot(groundNormal))).normalize();
                            const targetRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), project, groundNormal);
                            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(targetRot);
                            this.model.quaternion.slerp(targetQuat, this.tiltSpeed);
                        }
                        this.safePosTimer += deltaTime;
                        if (this.safePosTimer > 1.0 && Math.abs(this.speed) > 5) {
                            this.lastSafePosition.copy(this.model.position);
                            this.lastSafePosition.y += 1.0; 
                            this.lastSafeQuaternion.copy(this.model.quaternion);
                            this.safePosTimer = 0;
                        }
                    }
                }
            }
        }
        if (!isRayHittingSomething) {
            this.groundMemory -= deltaTime;
            if (this.groundMemory > 0) {
                const targetY = this.lastValidGroundY + this.rideHeight;
                this.model.position.y = THREE.MathUtils.lerp(this.model.position.y, targetY, 0.5);
                this.velocity.y = 0;
                this.isGrounded = true; 
            } else {
                this.velocity.y -= this.gravity * deltaTime; 
                this.isGrounded = false;
                this.safePosTimer = 0;
            }
        }
        this.model.position.addScaledVector(this.velocity, deltaTime);
        if(this.model.position.y < -10) this.hardRespawn();
        if (this.isGrounded) {
             const euler = new THREE.Euler().setFromQuaternion(this.model.quaternion, 'YXZ');
             euler.x *= 0.9; 
             euler.z *= 0.9; 
             this.model.quaternion.setFromEuler(euler);
        }
        this.updateEngineAudio();
        this.updateDebugVisuals(suspRayOrigin, wallRayOrigin, forwardDir);
        if (typeof uiSpeed !== 'undefined') uiSpeed.innerText = Math.abs(this.speed).toFixed(1);

        // --- SPIN THE WHEELS ---
        if (this.wheels.length > 0 && !this.disableWheelSpin) {
            const spinAmount = this.speed * deltaTime * 0.5; 
            this.wheels.forEach(wheel => {
                let finalSpin = spinAmount;

           
                const shouldFlip = this.wheelstoFlip.some(keyword => 
                    wheel.name.includes(keyword)
                );

                if (shouldFlip) {
                    finalSpin *= -1; // FLIP IT!
                }

                // Apply rotation
                if (this.spinAxis === 'z') wheel.rotateZ(finalSpin);
                else if (this.spinAxis === 'y') wheel.rotateY(finalSpin);
                else wheel.rotateX(finalSpin);
            });
        }

       // --- ANIMATE VISUAL STEERING WHEEL(S) ---
       if (this.steeringParts.length > 0) {
        this.steeringParts.forEach(part => {

            let directionFlip = (this.steeringAxis === 'y') ? 1.0 : -1.0; 

            if( this.invertSteering ) {
                directionFlip *= -1.0;
            }

            const rotAmount = this.steering * 10.0 * directionFlip;

            part.rotation[this.steeringAxis] = rotAmount;
        });
    }
    }
}
// --- Loaders ---
export function levelOneBackground() {
   

    const loader = new GLTFLoader();
    
    loader.load('moonview_highway.glb', (gltf) => {
 
        const model = gltf.scene;

        model.scale.set(600.0, 600.0, 600.0); 
        model.position.set(0, -10, 0); 
        
        scene.add(model);

        // --- THE BAN LIST ---
        const noCollisionKeywords = [
            
            "Object_0",
            "Object_23_1",
           "Object_57_1",
            "Object_17_1",
            "Object_16_1",
            "Object_41",
           
        
        ];

        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                styleMeshForNeon(child); 


                const isBanned = noCollisionKeywords.some(keyword => child.name.includes(keyword));

                if (!isBanned) {
                    mapColliders.push(child);
                } else {
                    ghostColliders.push(child); 
                }
            }
        });

    }, 
    (xhr) => { console.log("Map: " + ((xhr.loaded / xhr.total) * 100).toFixed(0) + "%"); },
    (error) => { console.error("MAP ERROR:", error); }
    );
}
// --- MENU INTERACTION & HUD BUTTONS ---

const hudButtons = document.querySelectorAll('.game-btn');
hudButtons.forEach(btn => {
    btn.style.pointerEvents = 'auto';
});

function setupMenuSelection(id, configKey) {
    const container = document.getElementById(id);
    if (!container) return;
    const buttons = container.getElementsByClassName('menu-btn');
    Array.from(buttons).forEach(btn => {
        btn.addEventListener('click', () => {
    
            Array.from(buttons).forEach(b => b.classList.remove('selected'));
 
            btn.classList.add('selected');
   
            GAME_STATE[configKey] = btn.getAttribute('data-value');
      
        });
    });
}

// Initialize Menu Listeners
setupMenuSelection('mode-select', 'mode');
setupMenuSelection('engine-select', 'engine');
setupMenuSelection('car-select', 'car');

// START BUTTON
const btnStart = document.getElementById('start-race-btn');
if (btnStart) {
    btnStart.addEventListener('click', () => {
        if (bgmMenu.isPlaying) bgmMenu.stop();
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('ui-container').classList.remove('hidden');
        initGameSession();
    });
}

// IN-GAME EXIT BUTTON
const btnExitIngame = document.getElementById('menu-btn-ingame');
if (btnExitIngame) {
    btnExitIngame.addEventListener('click', () => {
        returnToMainMenu();
    });
}

// RESULTS SCREEN EXIT BUTTON
const btnReturn = document.getElementById('return-menu-btn');
if (btnReturn) {
    btnReturn.addEventListener('click', () => {
        returnToMainMenu();
    });
}

// RESTART RACE BUTTON (Formerly Respawn)
const btnRestartRace = document.getElementById('reset-btn');
if (btnRestartRace) {
    btnRestartRace.addEventListener('click', () => {
    

        // 1. Reset Physics & Position
        if (carController) {
            carController.manualReset();
            carController.speed = 0; 
        }

        // 2. Reset Timer, Laps, and Array History
        if (typeof timeTrial !== 'undefined') {
            timeTrial.fullReset(); 
        }

        // 3. Focus window so you can drive immediately
        window.focus(); 
    });
}

// --- GAME SESSION LOADER ---
function initGameSession() {
    const selectedCarConfig = CAR_MODELS[GAME_STATE.car];
    const selectedEngineStats = ENGINE_CLASSES[GAME_STATE.engine];
    cameraMode = 0;

    createSponsorBillboard(new THREE.Vector3(330, 35, -470.8));

    if (carModel) {
        scene.remove(carModel);
        carModel = null;
    }

    const loader = new GLTFLoader();

    // DRACO Loader setup 
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(dracoLoader);
    
    loader.load(selectedCarConfig.path, (gltf) => {
        // 1. CREATE THE WRAPPER
        const physicsGroup = new THREE.Group();
        physicsGroup.position.set(0, 30, 180); 

        // 2. SETUP THE VISUALS
        const visualModel = gltf.scene;

        
        visualModel.traverse((child) => {
            if (child.isMesh) {
              
                const materials = Array.isArray(child.material) ? child.material : [child.material];

                materials.forEach(mat => {
                    const name = mat.name.toLowerCase();
         
                });
                
             
                child.castShadow = true;
            }
        });

        // only apply paint to the x5 
        if (selectedCarConfig.name === "BMW X5 (2019)") {
            applyBlackPaint(visualModel);
        }
        
   
        // Apply Scale to Visuals Only
        visualModel.scale.set(selectedCarConfig.scale, selectedCarConfig.scale, selectedCarConfig.scale);
        
        // Apply Rotation to Visuals Only (Fixes backwards BMW)
        if (selectedCarConfig.rotation) {
            visualModel.rotation.y = selectedCarConfig.rotation;
        }

        if (selectedCarConfig.yOffset) {
            visualModel.position.y = selectedCarConfig.yOffset;
        }

        if(selectedCarConfig.zOffset) {
            visualModel.position.z = selectedCarConfig.zOffset;
        }

        // Enable Shadows
        visualModel.traverse((node) => { if (node.isMesh) node.castShadow = true; });


        physicsGroup.add(visualModel);
        carModel = physicsGroup;
        scene.add(carModel);

        carModel.add(idleSound);
        carModel.add(accelerationSound);
        carModel.add(driftSound);

        
       // ADD LIGHTING
       setupCarLighting(carModel);

       carModel.updateMatrixWorld(true);

        // START PHYSICS
        carController = new CarControls(
            carModel, 
            idleSound, 
            accelerationSound, 
            driftSound, 
            selectedEngineStats,
            selectedCarConfig.wheelNames,
            selectedCarConfig.fixPivot,
            selectedCarConfig.spinAxis || 'x',
            selectedCarConfig.steeringWheelName,
            selectedCarConfig.steeringAxis,
            selectedCarConfig.fixSteeringPivot,
            selectedCarConfig.invertSteering,
            selectedCarConfig.disableWheelSpin,
            selectedCarConfig.wheelstoFlip

        );
        
        tryAttachAudio();
        
        if (typeof timeTrial !== 'undefined') timeTrial.fullReset(); 
        window.focus();

    }, undefined, (err) => console.error(err));
}

function unlockAudio() {
    if (listener.context.state === 'suspended') {
        listener.context.resume().then(() => {
            // If menu music loaded but was blocked, play it now
            if (bgmMenu.buffer && !bgmMenu.isPlaying) {
                bgmMenu.play();
            }
        });
    }
    // Remove listener after first click
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
}
document.addEventListener('click', unlockAudio);
document.addEventListener('keydown', unlockAudio);

// Reset Button
btnReset.addEventListener('click', () => {
    if (carController) {
        carController.manualReset();
        window.focus(); 
    }
});

const btnRestart = document.getElementById('restart-btn');

if (btnRestart) {
    btnRestart.addEventListener('click', () => {
        // 1. Reset all times and laps
        timeTrial.fullReset();
        
        // 2. Reset Car Position (Move to start line)
        if (carController) {
            carController.manualReset();
        }
        
        // 3. Refocus window so you can drive immediately
        window.focus();
    });
}


// Add a label to it so we don't get confused
const trackerLabelDiv = document.createElement('div');
trackerLabelDiv.className = 'label';
trackerLabelDiv.textContent = 'GHOST / UI';
trackerLabelDiv.style.marginTop = '-1em';
trackerLabelDiv.style.color = '#ff00ff';
trackerLabelDiv.style.fontSize = '12px';
trackerLabelDiv.style.position = 'absolute';
trackerLabelDiv.style.textShadow = '0 0 4px black';
trackerLabelDiv.style.display = 'none'; 
document.body.appendChild(trackerLabelDiv);


// --- THE INVINCIBLE LOOP ---
function animate() {
    const canvas = renderer.domElement;
    
    // Anti-Ghost System
    if (!canvas.dataset.loopId) canvas.dataset.loopId = Math.random().toString();
    const myLoopId = canvas.dataset.loopId;
    if (window.currentLoopId && window.currentLoopId !== myLoopId) return;
    window.currentLoopId = myLoopId;

    requestAnimationFrame(animate);


    const rawDelta = clock.getDelta();
    const deltaTime = Math.min(rawDelta, 0.05);

    // --- SPIN ANIMATED OBJECTS ---
    if (animatedObjects.length > 0) {
        animatedObjects.forEach(obj => {
  
            obj.rotation.y += 0.5 * deltaTime; 
        });
    }

    if (carController) {
        carController.update(deltaTime);
  
        if (typeof timeTrial !== 'undefined') timeTrial.update(carModel.position);
    }

    // Camera Logic
    if (carModel) {
        // 1. Get Car Info
        carModel.getWorldPosition(carWorldPosition);
        carModel.getWorldQuaternion(carWorldQuaternion);
        
        // 2. Handle Sector Culling (Keep this!)
        if (typeof updateSectorVisibility === 'function') updateSectorVisibility(carWorldPosition);

        if (cameraMode === 0) {
            // --- MODE 0: CHASE CAM (Smooth Elastic Follow) ---
            followSpherical.radius = THREE.MathUtils.clamp(followSpherical.radius, minCameraDistance, maxCameraDistance);
            
            relativeCameraOffset.setFromSpherical(followSpherical);
            relativeCameraOffset.applyQuaternion(carWorldQuaternion);
            desiredCameraPosition.copy(carWorldPosition).add(relativeCameraOffset);
            
            camera.position.lerp(desiredCameraPosition, chaseLerpFactor);
            lookAtTarget.copy(carWorldPosition).add(lookAtOffset);
            camera.lookAt(lookAtTarget);

        } else {
            // --- MODE 1 & 2: ATTACHED CAMS (Hard Snap) ---
            const offset = cameraOffsets[cameraMode].clone();
            if(GAME_STATE.car === "odyssey" && cameraMode === 1) {
                offset.y += 1; 
            }
            if(GAME_STATE.car === "odyssey" && cameraMode === 2) {
                offset.y += .4; 
                offset.z += -1.2;
            }
            if(GAME_STATE.car === "x5" && cameraMode === 1) {
                offset.y += 1; 
            }
            if(GAME_STATE.car === "x5" && cameraMode === 2) {
                offset.y += 1; 
            }
            
            
            
            
            // 2. Rotate it to match the car
            offset.applyQuaternion(carWorldQuaternion);
            
            // 3. Add to car position
            const camPos = carWorldPosition.clone().add(offset);
            
            // 4. SNAP camera there
            camera.position.copy(camPos);
            
            // 5. Look ahead
            const forward = new THREE.Vector3(0, 0, -20); // Look 20 units ahead
            forward.applyQuaternion(carWorldQuaternion);
            const target = carWorldPosition.clone().add(forward);
            
            camera.lookAt(target);
        }
    }
    
   

    renderer.render(scene, camera);
}
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}, false);


// Toggle Camera Mode (Press C)
window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyC') {
        // Check the config of the CURRENT car
        const currentCarConfig = CAR_MODELS[GAME_STATE.car];
        
        // Decide how many modes are allowed
        // If hasCockpit is explicitly false, we only have 2 modes (0 & 1).
        // Otherwise, we have 3 modes (0, 1, & 2).
        const maxModes = (currentCarConfig.hasCockpit === false) ? 2 : 3;

        // 3. Cycle through allowed modes
        cameraMode = (cameraMode + 1) % maxModes; 
        
        // Optional Log
        const modes = ["Chase", "Hood", "Cockpit"];
        console.log(`CAMERA: ${modes[cameraMode]} (Max: ${maxModes})`);
    }
});

// --- RETURN TO MENU LOGIC ---
function returnToMainMenu() {
    // 1. Hide Game UI & Results
    document.getElementById('ui-container').classList.add('hidden');
    document.getElementById('results-screen').classList.add('hidden');
    
    // 2. Show Main Menu
    document.getElementById('main-menu').classList.remove('hidden');
    
    // 3. Reset Audio
    if (bgmNormal.isPlaying) bgmNormal.stop();
    if (bgmFast.isPlaying) bgmFast.stop();
    if (sfxFanfare.isPlaying) sfxFanfare.stop();
    idleSound.setVolume(0);
    accelerationSound.setVolume(0);
    driftSound.setVolume(0);

    
    
    // Play Menu Music (Since audio is already unlocked, this works instantly)
    if (bgmMenu.buffer) {
        bgmMenu.play();
    }

    // 4. Cleanup Scene (Optional but good for performance)
    if (carModel) {
        scene.remove(carModel);
        carModel = null;
        carController = null;
    }
    
    // 5. Reset Camera to Default (Optional)
    camera.position.copy(defaultCameraPosition);
    camera.lookAt(defaultCameraTarget);
}

// --- INTRO SCREEN LOGIC ---
const introScreen = document.getElementById('intro-screen');

if (introScreen) {
    introScreen.addEventListener('click', () => {
        
        // 1. Initialize Audio Context (The "Unlock")
        if (listener.context.state === 'suspended') {
            listener.context.resume();
        }

        // 2. Play Menu Music
        if (bgmMenu.buffer) {
            bgmMenu.play();
        }

        // 3. Fade Out & Remove Overlay
        introScreen.style.transition = "opacity 0.5s";
        introScreen.style.opacity = "0";
        
        setTimeout(() => {
            introScreen.style.display = 'none';
        }, 500);
    });
}

levelOneBackground();
animate();
