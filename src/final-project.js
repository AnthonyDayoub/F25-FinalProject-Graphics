import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

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

const listener = new THREE.AudioListener();
camera.add(listener);
let carController = null;
const audioLoader = new THREE.AudioLoader();
const idleSound = new THREE.Audio(listener);
const accelerationSound = new THREE.Audio(listener);

const tryAttachAudio = () => {
    if (carController && idleSound.buffer && accelerationSound.buffer) {
        carController.setEngineAudio(idleSound, accelerationSound);
    }
};

audioLoader.load('idle.mp3', (buffer) => {
    idleSound.setBuffer(buffer);
    idleSound.setLoop(true);
    idleSound.setVolume(0.35);
    tryAttachAudio();
});
audioLoader.load('acceleration.mp3', (buffer) => {
    accelerationSound.setBuffer(buffer);
    accelerationSound.setLoop(true);
    accelerationSound.setVolume(0.35);
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


// --- CLASS: Time Trial Manager (Doorframe Logic) ---
class TimeTrialManager {
    constructor(uiCurrent, uiBest, uiLap) {
        this.uiCurrent = uiCurrent;
        this.uiBest = uiBest;
        this.uiLap = uiLap;
        
        this.lap = 1;
        this.startTime = 0;
        this.bestTime = Infinity;
        this.isRunning = false;

        // --- CHECKPOINT CONFIGURATION ---
        this.checkpoints = [
            // Checkpoint 1
            { pos: new THREE.Vector3(370, 25, -130), rot: 0, radius: 20, passed: false }, 
            
            // Checkpoint 2
            { pos: new THREE.Vector3(80, 47, 615), rot: 1.5, radius: 35, passed: false },

            // FINISH LINE
            { pos: new THREE.Vector3(4, 10, 80), rot: 0, radius: 15, passed: false, isFinish: true } 
        ];
        
        this.nextCheckpointIndex = 0;
        this.debugMeshes = [];

        // --- CREATE WALL VISUALS ---
        this.checkpoints.forEach((cp) => {
            // Visual Width is Radius * 3
            const geometry = new THREE.BoxGeometry(cp.radius * 3.0, 25, 1);
            
            const material = new THREE.MeshBasicMaterial({ 
                color: cp.isFinish ? 0x00ff00 : 0x00ffff, 
                transparent: true,
                opacity: 0.25,      
                side: THREE.DoubleSide,
                depthWrite: false,  
                blending: THREE.AdditiveBlending 
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
        this.isRunning = true;
        this.startTime = clock.getElapsedTime();
        this.lap = 1;
        this.resetCheckpoints();
    }
    
    // Helper to completely reset the game state
    fullReset() {
        this.lap = 1;
        this.bestTime = Infinity;
        this.startTime = clock.getElapsedTime();
        this.uiBest.innerText = "--:--.--";
        this.uiLap.innerText = this.lap;
        this.uiCurrent.style.color = '#00ffcc';
        this.resetCheckpoints();
    }

    resetCheckpoints() {
        this.checkpoints.forEach(cp => cp.passed = false);
        this.nextCheckpointIndex = 0;
        
        this.debugMeshes.forEach((m, idx) => {
            const isFin = this.checkpoints[idx].isFinish;
            m.material.color.setHex(isFin ? 0x00ff00 : 0x00ffff);
            m.material.opacity = 0.25;
        });
    }

    update(carPosition) {
        if (!this.isRunning) return;

        const currentTime = clock.getElapsedTime() - this.startTime;
        this.uiCurrent.innerText = formatTime(currentTime);

        const targetCP = this.checkpoints[this.nextCheckpointIndex];
        const targetMesh = this.debugMeshes[this.nextCheckpointIndex];

        if(targetMesh) {
            targetMesh.material.color.setHex(0xffff00);
            targetMesh.material.opacity = 0.5;
        }

        // --- NEW DETECTION LOGIC: "The Doorframe" ---
        
        // 1. Calculate vector from Checkpoint -> Car
        const carLocal = carPosition.clone().sub(targetCP.pos);
        
        // 2. Rotate this vector to match the gate's rotation
        // This gives us:
        // x = Distance left/right from center of gate
        // z = Distance forward/back from face of gate
        const rotation = new THREE.Quaternion();
        rotation.setFromAxisAngle(new THREE.Vector3(0,1,0), -targetCP.rot); 
        carLocal.applyQuaternion(rotation);

        // 3. Define the Trigger Zone
        // Width: Must be within the visual box (radius * 3 / 2)
        const gateHalfWidth = (targetCP.radius * 3.0) / 2.0; 
        
        // Depth: Must be within 6 units of the wall face (Front or Back)
        // Note: 6.0 is thick enough to catch high speed cars, thin enough to not trigger early
        const gateThickness = 6.0; 

        // 4. Check if inside the box
        if (Math.abs(carLocal.x) < gateHalfWidth && Math.abs(carLocal.z) < gateThickness) {
            console.log(`Checkpoint ${this.nextCheckpointIndex + 1} passed!`);
            
            // Visual feedback
            targetMesh.material.color.setHex(0x333333);
            targetMesh.material.opacity = 0.1;

            if (targetCP.isFinish) {
                this.completeLap(currentTime);
            } else {
                this.nextCheckpointIndex++;
            }
        }
    }

    completeLap(finalTime) {
        if (finalTime < this.bestTime) {
            this.bestTime = finalTime;
            this.uiBest.innerText = formatTime(this.bestTime);
            this.uiCurrent.style.color = '#00ff00';
            setTimeout(() => this.uiCurrent.style.color = '#00ffcc', 1000);
        }

        this.lap++;
        this.uiLap.innerText = this.lap;
        this.startTime = clock.getElapsedTime();
        this.resetCheckpoints();
    }
}
const timeTrial = new TimeTrialManager(uiTimeCurrent, uiTimeBest, uiLapCount);
class CarControls {
    constructor(model, idleSoundRef, accelerationSoundRef) {
        this.model = model;
        
        // --- SETUP ---
        this.maxSpeed = 120; 
        this.acceleration = 45;
        this.brakeStrength = 50;
        this.maxSteer = 0.04;
        this.gravity = 80;
        this.drag = 0.5;
        this.rideHeight = 0.5; 
        this.tiltSpeed = 0.08; 
        this.carLength = 4.0; 
        this.wallBounce = 0.5; 

        this.speed = 0;
        this.velocity = new THREE.Vector3();
        this.moveDirection = new THREE.Vector3(0, 0, -1);
        this.isGrounded = false;
        
        this.badObjects = ["Object_63", "Object_78", "SafetyNet", "Object_54"];
        this.lastSafePosition = new THREE.Vector3(0, 30, 90); 
        this.lastSafeQuaternion = new THREE.Quaternion();
        this.safePosTimer = 0;
        this.groundMemory = 0; 
        this.memoryDuration = 0.25;
        this.lastValidGroundY = -Infinity;

        this.groundRaycaster = new THREE.Raycaster();
        this.upRaycaster = new THREE.Raycaster();
        this.wallRaycaster = new THREE.Raycaster();

        this.idleSound = idleSoundRef || null;
        this.accelerationSound = accelerationSoundRef || null;
        this.engineSoundThreshold = 1;
        this.keys = { forward: false, backward: false, left: false, right: false, space: false };
        this.canDrive = true; 

        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));

        // --- VISUAL DEBUGGERS ---
        this.debugMode = false;
        
        // 1. Suspension Ray
        this.arrowSuspension = new THREE.ArrowHelper(new THREE.Vector3(0,-1,0), new THREE.Vector3(), 15, 0x00ff00);
        
        // 2. Wall Ray
        this.arrowWall = new THREE.ArrowHelper(new THREE.Vector3(0,0,-1), new THREE.Vector3(), 6, 0xff0000);
        
        // 3. THE MIND SPHERE (Shows where physics "Thinks" the car is)
        const sphereGeo = new THREE.SphereGeometry(2, 8, 8);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.5 });
        this.mindSphere = new THREE.Mesh(sphereGeo, sphereMat);

        scene.add(this.arrowSuspension);
        scene.add(this.arrowWall);
        scene.add(this.mindSphere); // Add to scene, NOT car

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
    }

    setEngineAudio(idleAudio, accelerationAudio) {
        this.idleSound = idleAudio;
        this.accelerationSound = accelerationAudio;
        this.updateEngineAudio(true);
    }

    updateEngineAudio(forceIdle = false) {
        if (!this.idleSound || !this.accelerationSound) return;
        if (!this.idleSound.buffer || !this.accelerationSound.buffer) return;
        const moving = Math.abs(this.speed) > this.engineSoundThreshold;
        if (forceIdle || !moving) {
            if (this.accelerationSound.isPlaying) this.accelerationSound.stop();
            if (!this.idleSound.isPlaying) this.idleSound.play();
        } else {
            if (this.idleSound.isPlaying) this.idleSound.stop();
            if (!this.accelerationSound.isPlaying) this.accelerationSound.play();
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
        this.updateEngineAudio(true);
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

    // --- VISUAL DEBUG SYNC ---
    updateDebugVisuals(suspensionOrigin, wallOrigin, wallDir) {
        if (!this.debugMode) return;
        if (!this.arrowSuspension || !this.arrowWall || !this.mindSphere) return;

        this.arrowSuspension.position.copy(suspensionOrigin);
        this.arrowSuspension.setDirection(new THREE.Vector3(0, -1, 0));

        this.arrowWall.position.copy(wallOrigin);
        this.arrowWall.setDirection(wallDir);

        // Snap Mind Sphere to the origin of the wall ray
        // This shows exactly where the physics engine is "Standing"
        this.mindSphere.position.copy(wallOrigin);
    }

    // --- THE FIX: PURE WORLD SPACE COLLISION ---
    checkWallCollisions() {
        if (Math.abs(this.speed) < 1.0) return; 

        // 1. Get ABSOLUTE WORLD Position & Rotation
        // We do not trust '.position' or '.quaternion' (Local)
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        this.model.getWorldPosition(worldPos);
        this.model.getWorldQuaternion(worldQuat);

        // 2. Calculate Forward Direction using WORLD Rotation
        const forwardDir = new THREE.Vector3(0, 0, (this.speed > 0 ? -1 : 1));
        forwardDir.applyQuaternion(worldQuat).normalize();
        
        // 3. Ray Origin
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
                "Object_34_1": 0.2,
                "Object_35_1": 0.2,
            };
            let activeTolerance = 0.5; 
            if (specialTolerances[hit.object.name] !== undefined) {
                activeTolerance = specialTolerances[hit.object.name];
            }

            if (Math.abs(normal.y) > activeTolerance) return; 

            // --- CRASH ---
            if (hit.distance < this.carLength) {
                console.log(`💥 Hit Wall: ${hit.object.name}`);
                this.speed = -this.speed * this.wallBounce;
                
                // Push car out
                const pushOut = forwardDir.clone().multiplyScalar(-1.5);
                this.model.position.add(pushOut);

                // *** CRITICAL FIX ***
                // Force the visual model to update its math instantly
                // so the next frame's physics sees the new position
                this.model.updateMatrixWorld(true);
            }
        }
    }

    update(deltaTime) {
        if (this.canDrive) {
            if (this.keys.forward) this.speed += this.acceleration * deltaTime;
            else if (this.keys.backward) this.speed -= this.brakeStrength * deltaTime;
            else this.speed *= (1 - this.drag * deltaTime);
            
            const isDrifting = this.keys.space && Math.abs(this.speed) > 10;
            if (this.keys.left) this.steering = this.maxSteer * (isDrifting ? 1.5 : 1.0);
            else if (this.keys.right) this.steering = -this.maxSteer * (isDrifting ? 1.5 : 1.0);
            else this.steering = 0;
        } else {
            this.speed *= (1 - this.drag * deltaTime);
            this.steering = 0;
        }

        this.speed = THREE.MathUtils.clamp(this.speed, -this.maxSpeed, this.maxSpeed);

        if (Math.abs(this.speed) > 0.1) {
            this.model.rotateY(this.steering * (this.speed > 0 ? 1 : -1));
        }
        
        // Update Matrix BEFORE reading it for vectors
        this.model.updateMatrixWorld(true);

        // --- PREPARE DATA (WORLD SPACE) ---
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

        // Physics Checks
        this.checkWallCollisions();

        // Movement
        const carFacingDir = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat); // Changed to worldQuat
        const grip = (this.keys.space && Math.abs(this.speed) > 10) ? 0.05 : 0.8; 
        this.moveDirection.lerp(carFacingDir, grip).normalize();
        if (Math.abs(this.speed) < 5) this.moveDirection.copy(carFacingDir);

        this.velocity.x = this.moveDirection.x * this.speed;
        this.velocity.z = this.moveDirection.z * this.speed;
        
        // Ground Physics
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
                    
                    if (distToTarget < 15.0) {
                        isRayHittingSomething = true;
                        this.isGrounded = true;
                        this.groundMemory = this.memoryDuration;
                        this.lastValidGroundY = groundHit.point.y; 
                        
                        this.velocity.y = Math.max(0, this.velocity.y);
                        this.model.position.y = THREE.MathUtils.lerp(this.model.position.y, targetY, 0.5);

                        if (angle < 1.0) {
                            // Alignment Logic
                            const currentLook = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat); // World Quat
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

        // Stabilizer
        if (this.isGrounded) {
             const euler = new THREE.Euler().setFromQuaternion(this.model.quaternion, 'YXZ');
             euler.x *= 0.9; 
             euler.z *= 0.9; 
             this.model.quaternion.setFromEuler(euler);
        }

        this.updateEngineAudio();
        this.updateDebugVisuals(suspRayOrigin, wallRayOrigin, forwardDir);

        if (typeof uiSpeed !== 'undefined') uiSpeed.innerText = Math.abs(this.speed).toFixed(1);
        if (typeof uiPosX !== 'undefined') uiPosX.innerText = worldPos.x.toFixed(1);
        if (typeof uiPosY !== 'undefined') uiPosY.innerText = worldPos.y.toFixed(1);
        if (typeof uiPosZ !== 'undefined') uiPosZ.innerText = worldPos.z.toFixed(1);
    }

    
    updateEngineAudio(forceIdle = false) {
        if (!this.idleSound || !this.accelerationSound) return;
        if (!this.idleSound.buffer || !this.accelerationSound.buffer) return;
        const moving = Math.abs(this.speed) > this.engineSoundThreshold;
        if (forceIdle || !moving) {
            if (this.accelerationSound.isPlaying) this.accelerationSound.stop();
            if (!this.idleSound.isPlaying) this.idleSound.play();
        } else {
            if (this.idleSound.isPlaying) this.idleSound.stop();
            if (!this.accelerationSound.isPlaying) this.accelerationSound.play();
        }
    }

  // --- SAFE DEBUG UPDATE ---
  updateDebugVisuals(suspensionOrigin, wallOrigin, wallDir) {
    // 1. If debug is off, do nothing
    if (!this.debugMode) return;

    // 2. Safe Checks: Only update things if they actually exist
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

    // 3. THE CRASH FIX: Check if boxHelper exists before updating
    if (this.boxHelper) {
        this.boxHelper.update();
    }
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
// Load Car
const loader = new GLTFLoader();
loader.setPath('cyberpunk_car/');

loader.load(
    'scene.gltf',
    function (gltf) {
        console.log("Car model loaded");
        const model = gltf.scene;
        model.scale.set(0.01, 0.01, 0.01); 
        model.position.set(0, 30, 90); 
        
        model.traverse(function (node) {
            if (node.isMesh) node.castShadow = true;
        });

        carModel = model;
        scene.add(model); // Add car to scene
        
        // IMPORTANT: DO NOT ADD CAMERA TO MODEL HERE. 
        // We leave the camera separate so animate() can move it smoothly.
        
        addCarHeadlights(model);

        carController = new CarControls(carModel, idleSound, accelerationSound);
        tryAttachAudio();

        // Start Clock immediately (No Menu blocking)
        timeTrial.start();
    },
    null,
    function (error) { console.error('Car load error:', error); }
);
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
const uiTrackerSphere = new THREE.Mesh(trackerGeo, trackerMat);


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
function animate() {
    const canvas = renderer.domElement;
    
    // 1. Tag the Canvas with our new Loop ID
    // If we haven't assigned an ID yet, generate a random one (like a fingerprint)
    if (!canvas.dataset.loopId) {
        canvas.dataset.loopId = Math.random().toString();
    }
    const myLoopId = canvas.dataset.loopId;

    // 2. The Check
    // If the canvas has a DIFFERENT ID than mine, it means a NEW loop has started.
    // I am the old ghost. I must stop.
    if (window.currentLoopId && window.currentLoopId !== myLoopId) {
        // console.log("👻 Ghost Loop detected and stopped.");
        return; // STOP! Do not request new frame.
    }
    
    // Set the global "Current" ID to mine, so older loops know to quit
    window.currentLoopId = myLoopId;

    requestAnimationFrame(animate);

    // --- GAME LOGIC ---
    const deltaTime = clock.getDelta();

    if (carController) {
        carController.update(deltaTime);
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
    
    // UI Tracker (The Pink Sphere Logic)
    if (typeof uiTrackerSphere !== 'undefined') {
        const ghostX = parseFloat(document.getElementById('pos-x').innerText);
        const ghostY = parseFloat(document.getElementById('pos-y').innerText);
        const ghostZ = parseFloat(document.getElementById('pos-z').innerText);
        if (!isNaN(ghostX)) uiTrackerSphere.position.set(ghostX, ghostY, ghostZ);
    }

    renderer.render(scene, camera);
}
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}, false);

levelOneBackground();
animate();

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