import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// --- CONFIGURATION CONSTANTS ---
const ENGINE_CLASSES = {
    '50cc': { maxSpeed: 80, accel: 30, brake: 60, steer: 0.004, gravity: 150 },
    '100cc': { maxSpeed: 100, accel: 40, brake: 55, steer: 0.0045, gravity: 170 },
    '150cc': { maxSpeed: 120, accel: 45, brake: 50, steer: 0.005, gravity: 180 }, // Original
    '200cc': { maxSpeed: 180, accel: 80, brake: 50, steer: 0.005, gravity: 200 } // Hard mode
};

const CAR_MODELS = {
    'cyber': { 
        name: 'Cyber Interceptor', 
        path: 'cyberpunk_car/scene.gltf', // Your existing file
        scale: 0.01 
    },
    'drifter': { 
        name: 'Neon Drifter', 
        path: 'cyberpunk_car/scene.gltf', // PLACEHOLDER: Use same file for now, change path when you get a new model
        scale: 0.01 
    }
};

let GAME_STATE = {
    mode: 'traditional', // 'traditional' or 'endless'
    engine: '150cc',
    car: 'cyber',
    isPlaying: false
};

// --- ANTI-GHOST SYSTEM ---
window.gameLoopId = null;

const clock = new THREE.Clock();

// --- UI Elements ---
const uiSpeed = document.getElementById('speed-display');
const uiPosX = document.getElementById('pos-x');
const uiPosY = document.getElementById('pos-y');
const uiPosZ = document.getElementById('pos-z');
const btnReset = document.getElementById('reset-btn');

// --- Time Trial UI ---
const uiTimeCurrent = document.getElementById('time-current');
const uiTimeBest = document.getElementById('time-best');
const uiLapCount = document.getElementById('lap-count');

// --- Helper: Format Time ---
function formatTime(seconds) {
    if (seconds === Infinity) return "--:--.--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds * 100) % 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}



// --- Basic Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01030a); 
scene.fog = new THREE.FogExp2(0x040b16, 0.002);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
const defaultCameraPosition = new THREE.Vector3(0, 10, 20);
const defaultCameraTarget = new THREE.Vector3(0, 0, 0);
camera.position.copy(defaultCameraPosition);
camera.lookAt(defaultCameraTarget);

// --- AUDIO SETUP (With Ghost Killer) ---
// 1. Kill old audio engine if it exists from previous reload
if (window.globalAudioContext) {
    window.globalAudioContext.close();
}
// --- AUDIO SETUP ---
const listener = new THREE.AudioListener();
camera.add(listener);

let carController = null;
const audioLoader = new THREE.AudioLoader();

const idleSound = new THREE.Audio(listener);
const accelerationSound = new THREE.Audio(listener);
const driftSound = new THREE.Audio(listener); 

const tryAttachAudio = () => {
    // Wait for ALL 3 sounds to load
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
    // Start Silent (We fade it in when driving)
    accelerationSound.setVolume(0); 
    tryAttachAudio();
});

audioLoader.load('drift.mp3', (buffer) => {
    
    driftSound.setBuffer(buffer);
    driftSound.setLoop(true);
    // Start Silent (We fade it in when drifting)
    driftSound.setVolume(0);  
    tryAttachAudio();
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
const ghostColliders = [];

const renderer = new THREE.WebGLRenderer({ antialias: true });
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

function addCarHeadlights(model) {
    carBoundsHelper.setFromObject(model);
    carBoundsHelper.getSize(carSizeHelper);
    carBoundsHelper.getCenter(carCenterHelper);

    const frontZ = carBoundsHelper.min.z - carSizeHelper.z * 0.05;
    const xOffset = carSizeHelper.x * 0.25 || 0.2;
    const yPos = carCenterHelper.y + carSizeHelper.y * 0.15;
    const reach = Math.max(200, carSizeHelper.z * 20);
    const markerGeom = new THREE.SphereGeometry(0.4, 12, 12);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });

    const makeLight = (xSign) => {
        const light = new THREE.SpotLight(0xffffff, 250, reach, Math.PI / 3, 0.2, 1.2);
        light.castShadow = false;
        light.position.set(carCenterHelper.x + xSign * xOffset, yPos, frontZ);

        const target = new THREE.Object3D();
        target.position.set(carCenterHelper.x + xSign * xOffset * 0.6, yPos - carSizeHelper.y * 0.05, frontZ - carSizeHelper.z * 0.6);
        model.add(target);
        light.target = target;

        model.add(light);

        const marker = new THREE.Mesh(markerGeom, markerMat);
        marker.position.copy(light.position);
        marker.renderOrder = 10;
        marker.scale.set(
            model.scale.x === 0 ? 1 : 1 / model.scale.x,
            model.scale.y === 0 ? 1 : 1 / model.scale.y,
            model.scale.z === 0 ? 1 : 1 / model.scale.z
        );
        model.add(marker);
        return light;
    };

    makeLight(1);
    makeLight(-1);
}

function addMeshToSector(mesh) {
    const pos = mesh.position;
    const keyX = Math.floor(pos.x / trackSectorSize);
    const keyZ = Math.floor(pos.z / trackSectorSize);
    const key = `${keyX}:${keyZ}`;

    let sector = trackSectorMap.get(key);
    if (!sector) {
        sector = { key, meshes: [], anchor: null };
        trackSectorMap.set(key, sector);
        trackSectors.push(sector);
    }
    sector.meshes.push(mesh);
    if (!sector.anchor) sector.anchor = mesh;
    mesh.frustumCulled = true;
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

function forceAllSectorsVisible() {
    trackSectors.forEach((sector) => sector.meshes.forEach(m => m.visible = true));
}

// --- Safety Net (Fix for falling through map) ---
function addSafetyNet() {
    const geometry = new THREE.BoxGeometry(5000, 1, 5000);
    const material = new THREE.MeshBasicMaterial({ color: 0x0000ff, visible: false });
    const safetyFloor = new THREE.Mesh(geometry, material);
    
    // Position below the lowest road
    safetyFloor.position.set(0, -20, 0); 
    safetyFloor.name = 'SafetyNet'; 
    
    scene.add(safetyFloor);
    
    // --- REMOVE THE "//" BELOW THIS LINE ---
    mapColliders.push(safetyFloor); 
}
addSafetyNet();



// --- CLASS: Time Trial Manager (High-Precision Timestamp Version) ---
// --- CLASS: Time Trial Manager (Debounced & Safe) ---
class TimeTrialManager {
    constructor(uiCurrent, uiBest, uiLap) {
        this.uiCurrent = uiCurrent;
        this.uiBest = uiBest;
        this.uiLap = uiLap;
        this.lapTimes = [];
        
        this.lap = 1;
        this.bestTime = Infinity;
        
        // TIMING VARIABLES
        this.lapStartTime = 0; 
        this.totalStartTime = 0; 
        this.currentLapDuration = 0;
        
        this.isRunning = false;
        this.isWarmup = true; 

        // SAFETY: Minimum time (seconds) a lap must take to count.
        // This prevents the "Double Trigger" bug.
        this.minLapTime = 5.0; 

        // Performance & Checkpoints
        this.lastUITime = 0;   
        this.uiUpdateRate = 65; // ms
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
        
        if (this.uiCurrent) {
            this.uiCurrent.innerText = "WARMUP";
            this.uiCurrent.style.color = '#ffaa00'; 
        }

        if (GAME_STATE.mode === 'traditional') {
            document.getElementById('max-laps').innerText = "/ 3";
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

        // Update UI Timer
        if (this.isRunning) {
            this.currentLapDuration = (now - this.lapStartTime) / 1000.0;
            
            if (now - this.lastUITime > this.uiUpdateRate) {
                if (this.uiCurrent) this.uiCurrent.innerText = formatTime(this.currentLapDuration);
                this.lastUITime = now;
            }
        }

        const targetCP = this.checkpoints[this.nextCheckpointIndex];
        const targetMesh = this.debugMeshes[this.nextCheckpointIndex];

        // Collision Logic
        this.workVec.copy(carPosition).sub(targetCP.pos);
        this.workQuat.setFromAxisAngle(this.yAxis, -targetCP.rot); 
        this.workVec.applyQuaternion(this.workQuat);

        const gateHalfWidth = (targetCP.radius * 3.0) / 2.0; 
        const gateThickness = 6.0; 

        if (Math.abs(this.workVec.x) < gateHalfWidth && Math.abs(this.workVec.z) < gateThickness) {
            
            // Visual feedback
            if (targetMesh.material.opacity < 0.05) {
                targetMesh.material.color.setHex(0x333333);
                targetMesh.material.opacity = 0.1;
            }

            if (targetCP.isFinish) {
                if (this.isWarmup) {
                    // --- WARMUP END ---
                    console.log("WARMUP COMPLETE");
                    this.isWarmup = false;
                    this.isRunning = true;
                    
                    this.lapTimes = [];
                    const startT = performance.now();
                    this.totalStartTime = startT;
                    this.lapStartTime = startT; // Start Lap 1 Timer
                    
                    if(this.uiCurrent) this.uiCurrent.style.color = '#00ffcc';
                    
                    this.nextCheckpointIndex = 0;
                    this.resetCheckpointsVisuals();
                } else {
                    // --- LAP FINISH ---
                    // CHECK: Has it been at least 5 seconds?
                    const potentialDuration = (performance.now() - this.lapStartTime) / 1000.0;

                    if (potentialDuration > this.minLapTime) {
                        const lapEndT = performance.now();
                        const duration = (lapEndT - this.lapStartTime) / 1000.0;
                        
                        // Reset timer for NEXT lap
                        this.lapStartTime = lapEndT;
                        this.completeLap(duration);
                    }
                }
            } else {
                // Normal Checkpoint
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
        console.log(`Lap ${this.lap} Finished: ${duration.toFixed(2)}s`);

        if (duration < this.bestTime) {
            this.bestTime = duration;
            if (this.uiBest) this.uiBest.innerText = formatTime(this.bestTime);
            if (this.uiCurrent) {
                this.uiCurrent.style.color = '#00ff00';
                setTimeout(() => { if(this.uiCurrent) this.uiCurrent.style.color = '#00ffcc'; }, 1000);
            }
        }

        // Check for Race Finish (Traditional Mode)
        if (GAME_STATE.mode === 'traditional' && this.lap >= 3) {
            this.endGame();
            return;
        }

        this.lap++;
        if (this.uiLap) this.uiLap.innerText = this.lap;
        
        this.nextCheckpointIndex = 0;
        this.resetCheckpointsVisuals();
    }

    endGame() {
        if (carController) carController.canDrive = false;
        this.isRunning = false;

        let lapsToCount = this.lapTimes;
        if (GAME_STATE.mode === 'traditional') {
             // Ensure we only show the last 3 valid laps
             lapsToCount = this.lapTimes.slice(-3);
        }

        const totalTime = lapsToCount.reduce((a, b) => a + b, 0);

        const uiContainer = document.getElementById('ui-container');
        const resultsScreen = document.getElementById('results-screen');
        
        if (uiContainer) uiContainer.classList.add('hidden');
        if (resultsScreen) resultsScreen.classList.remove('hidden');
        
        const l1 = document.getElementById('res-lap1');
        const l2 = document.getElementById('res-lap2');
        const l3 = document.getElementById('res-lap3');
        const lTotal = document.getElementById('res-total');

        if (l1) l1.innerText = formatTime(lapsToCount[0] || 0);
        if (l2) l2.innerText = formatTime(lapsToCount[1] || 0);
        if (l3) l3.innerText = formatTime(lapsToCount[2] || 0);
        if (lTotal) lTotal.innerText = formatTime(totalTime);
    }
}
    const timeTrial = new TimeTrialManager(uiTimeCurrent, uiTimeBest, uiLapCount);function createSmokeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // REDUCED RADIUS: 32 -> 28
    // This leaves a 4px buffer of empty space so the corners are invisible
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 28);
    
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');     // White center
    grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)'); // Fluffy body
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');     // Transparent edge
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

class CarControls {
    // UPDATED: Added 'physicsStats' to the arguments
    constructor(model, idleSoundRef, accelerationSoundRef, driftSoundRef, physicsStats) {
        this.model = model;
        
        // --- 1. DYNAMIC CAR STATS ---
        // We now use the stats passed from the Menu (physicsStats)
        // If physicsStats is missing (safety check), we fall back to 150cc values
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
        
        this.badObjects = ["Object_63", "Object_78", "SafetyNet", "Object_54"];
        this.lastSafePosition = new THREE.Vector3(0, 30, 90); 
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
        this.mindSphere = new THREE.Mesh(
            new THREE.SphereGeometry(2, 8, 8), 
            new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.5 })
        );
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
        const smokeMat = new THREE.SpriteMaterial({ 
            map: smokeTex, 
            color: 0xffffff, 
            transparent: true, 
            opacity: 0.9,    
            depthWrite: false 
        });

        for (let i = 0; i < 40; i++) {
            const p = new THREE.Sprite(smokeMat);
            p.visible = false;
            p.scale.set(4, 4, 4); 
            scene.add(p);
            this.smokeParticles.push({ mesh: p, life: 0 });
        }
        
        this.smokeTimer = 0; 
    }

    // --- AUDIO SYSTEM (THE FIX: Play Everything, Adjust Volume) ---
    setEngineAudio(idle, accel, drift) {
        this.idleSound = idle;
        this.accelerationSound = accel;
        this.driftSound = drift;
        
        // 1. Play ALL sounds immediately (Looping)
        if(this.idleSound && !this.idleSound.isPlaying) this.idleSound.play();
        if(this.accelerationSound && !this.accelerationSound.isPlaying) this.accelerationSound.play();
        if(this.driftSound && !this.driftSound.isPlaying) this.driftSound.play();

        // 2. Set initial volumes
        if(this.idleSound) this.idleSound.setVolume(0);
        if(this.accelerationSound) this.accelerationSound.setVolume(0); // Start Silent
        if(this.driftSound) this.driftSound.setVolume(0);             // Start Silent
    }

    updateEngineAudio() {
        if (!this.idleSound || !this.accelerationSound || !this.driftSound) return;
        
        // 1. Browser Autoplay Fix: Resume context if locked
        if (this.idleSound.context && this.idleSound.context.state === 'suspended') {
            this.idleSound.context.resume();
        }

        const isMoving = Math.abs(this.speed) > 1.0; 

        if (isMoving) {
            // --- DRIVE MODE ---
            
            // ACCEL: Ensure playing & Loud
            if (!this.accelerationSound.isPlaying) this.accelerationSound.play();
            this.accelerationSound.setVolume(0.5);
            
            // Pitch Shift
            const speedRatio = Math.min(Math.abs(this.speed) / this.maxSpeed, 1.0);
            this.accelerationSound.setPlaybackRate(0.8 + (speedRatio * 0.7));

            // IDLE: Mute (Don't stop, just mute)
            this.idleSound.setVolume(0);

        } else {
            // --- IDLE MODE ---
            
            // IDLE: Ensure playing & Loud
            if (!this.idleSound.isPlaying) this.idleSound.play();
            this.idleSound.setVolume(0.5);

            // ACCEL: Mute
            this.accelerationSound.setVolume(0);
        }

        // --- DRIFT AUDIO ---
        if (this.isDriftingState && this.isGrounded && Math.abs(this.speed) > 20) {
            // Force play if it stopped
            if (!this.driftSound.isPlaying) this.driftSound.play();
            
            // Fade In
            const currentVol = this.driftSound.getVolume();
            this.driftSound.setVolume(THREE.MathUtils.lerp(currentVol, 0.6, 0.2));
        } else {
            // Fade Out
            const currentVol = this.driftSound.getVolume();
            this.driftSound.setVolume(THREE.MathUtils.lerp(currentVol, 0, 0.2));
            
            // Optional: Stop if silent to be clean
            if(currentVol < 0.01 && this.driftSound.isPlaying) this.driftSound.stop();
        }
    }

    manualReset() {
        this.speed = 0;
        this.velocity.set(0, 0, 0);
        this.model.position.set(0, 30, 90); 
        this.model.rotation.set(0, 0, 0);
        this.lastSafePosition.set(0, 30, 90);
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

    // --- INPUTS ---
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

    // --- PARTICLE LOGIC ---
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
        if (this.boxHelper) {
            this.boxHelper.update();
        }
    }

    // --- WALL CHECK ---
    checkWallCollisions() {
        if (Math.abs(this.speed) < 1.0) return; 

        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        this.model.getWorldPosition(worldPos);
        this.model.getWorldQuaternion(worldQuat);

        const forwardDir = new THREE.Vector3(0, 0, (this.speed > 0 ? -1 : 1));
        forwardDir.applyQuaternion(worldQuat).normalize();
        
        const rayOrigin = worldPos.clone();
        rayOrigin.y += 2.0; 

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

            const specialTolerances = {
                "Object_40_1": 0.1, 
                "Object_22": 1.0,
                "Object_34_1": 1.0,
                "Object_35_1": 1.0,
            };
            let activeTolerance = 0.5; 
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
            
            // Drift Logic
            this.isDriftingState = this.keys.space && Math.abs(this.speed) > 10;
            
            if (this.keys.left) this.steering = this.maxSteer * (this.isDriftingState ? 3.0 : 1.0);
            else if (this.keys.right) this.steering = -this.maxSteer * (this.isDriftingState ? 3.0 : 1.0);
            else this.steering = 0;

            // Smoke
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
        
        const grip = (this.keys.space && Math.abs(this.speed) > 10) ? 0.05 : 0.8; 
        this.moveDirection.lerp(carFacingDir, grip).normalize();
        if (Math.abs(this.speed) < 5) this.moveDirection.copy(carFacingDir);

        this.velocity.x = this.moveDirection.x * this.speed;
        this.velocity.z = this.moveDirection.z * this.speed;
        
        // --- GROUND PHYSICS ---
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
        
        // KEEPING DEATH PLANE AT -10 AS REQUESTED
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
  
    }
}
// --- Loaders ---
export function levelOneBackground() {
    console.log("LOADING MAP: moonview_highway.glb");

    const loader = new GLTFLoader();
    
    loader.load('moonview_highway.glb', (gltf) => {
        console.log("MAP LOADED!");
        const model = gltf.scene;

        model.scale.set(600.0, 600.0, 600.0); 
        model.position.set(0, -10, 0); 
        
        scene.add(model);

        // --- THE BAN LIST ---
        // Any object name containing these words becomes a GHOST (Blue Grid)
        const noCollisionKeywords = [
            
            "Object_0",
            "Object_23_1",
            "Object_22",
            //"Object_35_1",
           "Object_57_1",
            "Object_17_1",
            //"Object_7_1"
            //"Object_34_1",
            "Object_16_1",
            "Object_41",
           
        
        ];

        model.traverse((child) => {
            if (child.isMesh) {
                // 1. Visuals
                child.castShadow = true;
                child.receiveShadow = true;
                styleMeshForNeon(child); 

                // 2. Physics Sorting
                // check if the name matches any banned word
                const isBanned = noCollisionKeywords.some(keyword => child.name.includes(keyword));

                if (!isBanned) {
                    // SOLID WALL (Magenta)
                    mapColliders.push(child);
                } else {
                    // GHOST OBJECT (Blue)
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

// 1. Force HUD Buttons to be Clickable
// (Fixes the issue where the transparent UI layer blocked clicks)
const hudButtons = document.querySelectorAll('.game-btn');
hudButtons.forEach(btn => {
    btn.style.pointerEvents = 'auto';
});

// Helper to handle button selection
function setupMenuSelection(id, configKey) {
    const container = document.getElementById(id);
    if (!container) return;
    const buttons = container.getElementsByClassName('menu-btn');
    Array.from(buttons).forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove 'selected' class from siblings
            Array.from(buttons).forEach(b => b.classList.remove('selected'));
            // Add to clicked
            btn.classList.add('selected');
            // Update Config
            GAME_STATE[configKey] = btn.getAttribute('data-value');
            console.log(`Updated ${configKey}:`, GAME_STATE[configKey]);
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
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('ui-container').classList.remove('hidden');
        initGameSession();
    });
}

// IN-GAME EXIT BUTTON
const btnExitIngame = document.getElementById('menu-btn-ingame');
if (btnExitIngame) {
    btnExitIngame.addEventListener('click', () => {
        location.reload(); 
    });
}

// RESULTS SCREEN EXIT BUTTON
const btnReturn = document.getElementById('return-menu-btn');
if (btnReturn) {
    btnReturn.addEventListener('click', () => {
        location.reload(); 
    });
}

// RESTART RACE BUTTON (Formerly Respawn)
const btnRestartRace = document.getElementById('reset-btn');
if (btnRestartRace) {
    btnRestartRace.addEventListener('click', () => {
        console.log("RESTARTING RACE...");

        // 1. Reset Physics & Position
        if (carController) {
            carController.manualReset();
            carController.speed = 0; // Stop dead so you don't fly off
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

    console.log(`STARTING RACE: ${GAME_STATE.mode} | ${GAME_STATE.engine} | ${selectedCarConfig.name}`);

    // Clean up old car if exists (though usually we reload page for clean reset)
    if (carModel) {
        scene.remove(carModel);
    }

    const loader = new GLTFLoader();
    
    // Load Selected Car
    loader.load(selectedCarConfig.path, (gltf) => {
        const model = gltf.scene;
        model.scale.set(selectedCarConfig.scale, selectedCarConfig.scale, selectedCarConfig.scale);
        model.position.set(0, 30, 90);
        
        model.traverse((node) => { if (node.isMesh) node.castShadow = true; });

        carModel = model;
        scene.add(model);
        addCarHeadlights(model);

        // PASS STATS TO CONTROLLER
        carController = new CarControls(
            carModel, 
            idleSound, 
            accelerationSound, 
            driftSound, 
            selectedEngineStats // <--- PASSING PHYSICS HERE
        );
        
        tryAttachAudio();
        timeTrial.fullReset(); // Start the timer logic
        window.focus();

    }, undefined, (err) => console.error(err));
}


// Reset Button
btnReset.addEventListener('click', () => {
    if (carController) {
        carController.manualReset();
        window.focus(); 
    }
});

// --- NEW RESTART BUTTON LOGIC ---
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

// Coordinate Logger Tool (Press P to log position)
window.addEventListener('keydown', (event) => {
    if (event.key === 'p' || event.key === 'P') {
        if (!carModel) return;
        const p = carModel.position;
        console.log(`{ pos: new THREE.Vector3(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}), radius: 15, passed: false },`);
    }
});

// ww--- THE UI TRACKER (The "Ghost Hunter") ---
const trackerGeo = new THREE.SphereGeometry(3, 16, 16);
const trackerMat = new THREE.MeshBasicMaterial({ 
    color: 0xFF00FF, // MAGENTA = "Where the UI thinks you are"
    wireframe: false,
    transparent: true,
    opacity: 0.8
});



// Add a label to it so we don't get confused
const trackerLabelDiv = document.createElement('div');
trackerLabelDiv.className = 'label';
trackerLabelDiv.textContent = 'GHOST / UI';
trackerLabelDiv.style.marginTop = '-1em';
trackerLabelDiv.style.color = '#ff00ff';
trackerLabelDiv.style.fontSize = '12px';
trackerLabelDiv.style.position = 'absolute';
trackerLabelDiv.style.textShadow = '0 0 4px black';
trackerLabelDiv.style.display = 'none'; // Hidden for now unless you want to add CSS2DObject
document.body.appendChild(trackerLabelDiv);


// --- THE INVINCIBLE LOOP ---
// --- THE INVINCIBLE LOOP (UPDATED) ---
function animate() {
    const canvas = renderer.domElement;
    
    // Anti-Ghost System
    if (!canvas.dataset.loopId) canvas.dataset.loopId = Math.random().toString();
    const myLoopId = canvas.dataset.loopId;
    if (window.currentLoopId && window.currentLoopId !== myLoopId) return;
    window.currentLoopId = myLoopId;

    requestAnimationFrame(animate);

    // --- LAG FIX: CLAMP DELTA TIME ---
    // We cap the frame time at 0.05s. If the computer freezes for 1 second,
    // the physics only calculates 0.05s of movement, preventing 'teleporting' or heavy friction spikes.
    const rawDelta = clock.getDelta();
    const deltaTime = Math.min(rawDelta, 0.05);

    if (carController) {
        carController.update(deltaTime);
        // UPDATED: No 'deltaTime' needed for time trial anymore
        if (typeof timeTrial !== 'undefined') timeTrial.update(carModel.position);
    }

    // Camera Logic
    if (carModel) {
        carModel.getWorldPosition(carWorldPosition);
        carModel.getWorldQuaternion(carWorldQuaternion);
        if (typeof updateSectorVisibility === 'function') updateSectorVisibility(carWorldPosition);

        followSpherical.radius = THREE.MathUtils.clamp(followSpherical.radius, minCameraDistance, maxCameraDistance);
        relativeCameraOffset.setFromSpherical(followSpherical);
        relativeCameraOffset.applyQuaternion(carWorldQuaternion); 
        desiredCameraPosition.copy(carWorldPosition).add(relativeCameraOffset);
        
        camera.position.lerp(desiredCameraPosition, chaseLerpFactor);
        lookAtTarget.copy(carWorldPosition).add(lookAtOffset);
        camera.lookAt(lookAtTarget);
    }
    
   

    renderer.render(scene, camera);
}
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}, false);



// --- DEBUG TOOL: Collision Vision ---
let debugGroup = null;

// Material 1: HARD WALLS (Magenta)
const debugMaterial = new THREE.MeshBasicMaterial({
    color: 0xff00ff, 
    wireframe: true,
    depthTest: false,
    transparent: true,
    opacity: 0.5
});

// Material 2: GHOST OBJECTS (Electric Blue)
const debugGhostMaterial = new THREE.MeshBasicMaterial({
    color: 0x00aaff, 
    wireframe: true,
    depthTest: false,
    transparent: true,
    opacity: 0.3 // Slightly more transparent than walls
});

function toggleCollisionDebug() {
    console.log("👉 Toggling Debug..."); 

    // 1. Turn OFF
    if (debugGroup) {
        scene.remove(debugGroup);
        // Dispose geometries to free memory
        debugGroup.traverse(child => { if(child.isMesh) child.geometry.dispose(); });
        debugGroup = null;
        
        // Hide Safety Net
        const net = mapColliders.find(obj => obj.name === 'SafetyNet');
        if (net) { net.visible = false; net.material.wireframe = false; }
        
        console.log("❌ Debug: OFF");
        return;
    }

    // 2. Turn ON
    if (mapColliders.length === 0) {
        console.warn("⚠️ Map not loaded yet.");
        return;
    }

    console.log(`✅ Debug: ON (Walls: ${mapColliders.length}, Ghosts: ${ghostColliders.length})`);
    debugGroup = new THREE.Group();
    scene.add(debugGroup);

    // Helper Function to draw a list
    const addDebugMeshes = (list, material) => {
        list.forEach(obj => {
            if (obj.name === 'SafetyNet') {
                obj.visible = true;
                obj.material.color.setHex(0xff0000); 
                obj.material.wireframe = true;
                return; 
            }

            if (obj.geometry) {
                const clone = new THREE.Mesh(obj.geometry, material);
                obj.updateWorldMatrix(true, false);
                clone.applyMatrix4(obj.matrixWorld);
                debugGroup.add(clone);
            }
        });
    };

    // Draw Both Lists
    addDebugMeshes(mapColliders, debugMaterial);      // Magenta
    addDebugMeshes(ghostColliders, debugGhostMaterial); // Blue
}

// Bind Key
window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyC') toggleCollisionDebug();
});

levelOneBackground();
animate();