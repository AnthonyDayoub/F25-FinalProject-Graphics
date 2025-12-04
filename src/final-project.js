import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

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
    safetyFloor.position.set(0, -5, 0); 
    
    // IMPORTANT: Name it so we can detect it later
    safetyFloor.name = 'SafetyNet'; 
    
    scene.add(safetyFloor);
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
            { pos: new THREE.Vector3(315, 28, -121), rot: 0, radius: 20, passed: false }, 
            
            // Checkpoint 2
            { pos: new THREE.Vector3(75, 50, 434), rot: 1.5, radius: 35, passed: false },

            // FINISH LINE
            { pos: new THREE.Vector3(0, 18, 74), rot: 0, radius: 15, passed: false, isFinish: true } 
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
        
        // --- 1. DEFAULT STATS ---
        this.maxSpeed = 120; 
        this.acceleration = 45;
        this.brakeStrength = 50;
        this.maxSteer = 0.04;
        this.gravity = 80;
        this.drag = 0.5;

        // --- 2. STATES ---
        this.speed = 0;
        this.velocity = new THREE.Vector3();
        this.moveDirection = new THREE.Vector3(0, 0, -1);
        this.isGrounded = false;
        
        // --- 3. PHYSICS SETUP ---
        this.rideHeight = 0.5; 
        this.tiltSpeed = 0.08; 
        this.badObjects = ["Object_63", "Object_78", "SafetyNet", "Object_54"];
        
        this.groundRaycaster = new THREE.Raycaster();
        this.upRaycaster = new THREE.Raycaster();

        // --- 4. RESTORED ORIGINAL SPAWN ---
        this.lastSafePosition = new THREE.Vector3(0, 30, 90); 
        this.lastSafeQuaternion = new THREE.Quaternion();
        
        this.safePosTimer = 0;
        this.groundMemory = 0; 
        this.memoryDuration = 0.25;
        this.lastValidGroundY = -Infinity;

        // Audio
        this.idleSound = idleSoundRef || null;
        this.accelerationSound = accelerationSoundRef || null;
        this.engineSoundThreshold = 1;

        // Input
        this.keys = { forward: false, backward: false, left: false, right: false, space: false };
        this.canDrive = true; // Input Locked, but Physics will run

        // Debug
        this.debugMode = false;
        this.rayHelper = new THREE.ArrowHelper(new THREE.Vector3(0,-1,0), this.model.position, 10, 0xffff00);
        this.rayHelper.visible = false;
        scene.add(this.rayHelper);

        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
    }

    setEngineAudio(idleAudio, accelerationAudio) {
        this.idleSound = idleAudio;
        this.accelerationSound = accelerationAudio;
        this.updateEngineAudio(true);
    }

    // --- MENU HANDLER ---
    startGame(settings) {
        console.log("Stats Applied:", settings);
        this.maxSpeed = settings.speed;
        this.acceleration = settings.accel;
        this.maxSteer = settings.steer;
        
        this.canDrive = true; // Unlock Input
        // Note: We DO NOT reset position here anymore. 
        // The car has likely already dropped to the road by now.
    }

    manualReset() {
        this.speed = 0;
        this.velocity.set(0, 0, 0);
        
        // Restore spawn
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
        // We only block driving keys, not debug keys
        if (!this.canDrive && ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code)) return;

        if (event.key.toLowerCase() === 'v') {
            this.debugMode = !this.debugMode;
            this.rayHelper.visible = this.debugMode;
        }
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

    update(deltaTime) {
        // --- 1. INPUT LOGIC (Only runs if unlocked) ---
        if (this.canDrive) {
            if (this.keys.forward) this.speed += this.acceleration * deltaTime;
            else if (this.keys.backward) this.speed -= this.brakeStrength * deltaTime;
            else this.speed *= (1 - this.drag * deltaTime);
            
            // Steering
            const isDrifting = this.keys.space && Math.abs(this.speed) > 10;
            if (this.keys.left) this.steering = this.maxSteer * (isDrifting ? 1.5 : 1.0);
            else if (this.keys.right) this.steering = -this.maxSteer * (isDrifting ? 1.5 : 1.0);
            else this.steering = 0;
        } else {
            // If locked, just slow down naturally
            this.speed *= (1 - this.drag * deltaTime);
            this.steering = 0;
        }

        // Clamp Speed
        this.speed = THREE.MathUtils.clamp(this.speed, -this.maxSpeed / 2, this.maxSpeed);

        // Apply Rotation
        if (Math.abs(this.speed) > 0.1) this.model.rotateY(this.steering * (this.speed > 0 ? 1 : -1));

        // Calculate Velocity Vector
        const carFacingDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.model.quaternion);
        // Drift Factor
        const grip = (this.keys.space && Math.abs(this.speed) > 10) ? 0.05 : 0.8; 
        this.moveDirection.lerp(carFacingDir, grip).normalize();
        if (Math.abs(this.speed) < 5) this.moveDirection.copy(carFacingDir);

        this.velocity.x = this.moveDirection.x * this.speed;
        this.velocity.z = this.moveDirection.z * this.speed;
        this.velocity.y -= this.gravity * deltaTime; 

        // --- 2. PHYSICS (ALWAYS RUNS) ---
        // This ensures the car drops to the floor even if the menu is open
        
        let rayOrigin = this.model.position.clone();
        rayOrigin.y += 5.0; 
        this.groundRaycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
        this.groundRaycaster.far = 15.0; 
        let hits = this.groundRaycaster.intersectObjects(mapColliders);

        let isRayHittingSomething = false;
        let groundHit = null;

        if (hits.length > 0) groundHit = hits[0];

        // Submarine Check
        if (!groundHit) {
            this.upRaycaster.set(this.model.position, new THREE.Vector3(0, 1, 0));
            this.upRaycaster.far = 5.0; 
            const upHits = this.upRaycaster.intersectObjects(mapColliders);
            if (upHits.length > 0) {
                const roof = upHits[0];
                if (!this.badObjects.includes(roof.object.name)) groundHit = roof; 
            }
        }

        if (groundHit) {
            const name = groundHit.object.name;
            const isBadObject = this.badObjects.includes(name) || name.includes("SafetyNet");

            if (!isBadObject) {
                let groundNormal = groundHit.face.normal.clone().applyQuaternion(groundHit.object.quaternion);
                const up = new THREE.Vector3(0, 1, 0);
                const angle = groundNormal.angleTo(up); 

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
                            const currentLook = new THREE.Vector3(0, 0, -1).applyQuaternion(this.model.quaternion);
                            const project = currentLook.clone().sub(groundNormal.clone().multiplyScalar(currentLook.dot(groundNormal))).normalize();
                            const targetRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), project, groundNormal);
                            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(targetRot);
                            this.model.quaternion.slerp(targetQuat, this.tiltSpeed);
                        }

                        // Only save safe position if moving fast enough
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
                this.isGrounded = false;
                this.safePosTimer = 0;
            }
        }

        if (this.debugMode) {
            this.rayHelper.position.copy(rayOrigin);
            this.rayHelper.setColor(new THREE.Color(isRayHittingSomething ? 0x00ff00 : 0xff0000));
        }

        this.model.position.addScaledVector(this.velocity, deltaTime);
        if(this.model.position.y < -50) this.hardRespawn();

        // UI
        if (uiSpeed) uiSpeed.innerText = Math.abs(this.speed).toFixed(1);
        if (uiPosX) uiPosX.innerText = this.model.position.x.toFixed(1);
        if (uiPosY) uiPosY.innerText = this.model.position.y.toFixed(1);
        if (uiPosZ) uiPosZ.innerText = this.model.position.z.toFixed(1);
        
        this.updateEngineAudio();
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
}
// --- Loaders ---
export function levelOneBackground() {
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
    const trackLoader = new GLTFLoader();
    trackLoader.setDRACOLoader(draco);
    trackLoader.setPath('mario_kart_8_deluxe_-_wii_moonview_highway/');

    scene.background = new THREE.Color(0x05070f);

    trackLoader.load(
        'scene.gltf',
        (gltf) => {
            console.log('Map loaded - Filtering Invisible Walls');
            const model = gltf.scene;
            model.position.set(0, 0, 0); 
            scene.add(model);

            model.traverse((child) => {
                if (child.isLight) {
                    child.parent?.remove(child); 
                } else if (child.isMesh) {
                    child.geometry.scale(0.1, 0.1, 0.1);
                    child.material.side = THREE.DoubleSide;
                    
                    child.receiveShadow = true;
                    child.castShadow = true;
                    styleMeshForNeon(child);

                    // --- FILTERING LOGIC ---
                    bboxHelper.setFromObject(child);
                    bboxHelper.getSize(sizeHelper);

                    // Filter 1: Ignore extremely tall boxes that aren't wide (Likely buildings/signs)
                    // If height > 20 AND height > width * 2, it's a pole or building.
                    const isTallBuilding = sizeHelper.y > 20 && sizeHelper.y > Math.max(sizeHelper.x, sizeHelper.z) * 1.5;
                    
                    // Filter 2: Ignore specific "Object_63" type names if they are problematic
                    // (You can add specific names here if you find them with the clicker)
                    const isBadObject = child.name.includes("Object_X"); 

                    if (!isTallBuilding && !isBadObject) {
                        mapColliders.push(child);
                    }
             
                    else {
                         // Optional: Visualize what we removed (Red wireframe)
                         // const removed = new THREE.BoxHelper(child, 0xff0000);
                         // scene.add(removed);
                    }

                    addMeshToSector(child);
                }
            });

            if (trackSectors.length <= 1) {
                sectorCullingEnabled = false;
                forceAllSectorsVisible();
            }
        },
        null,
        (err) => console.error('Map GLTF load error:', err)
    );
}
// Load Car
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


// --- Render Loop ---
// --- Render Loop ---
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    // 1. PHYSICS (Move the Car Object)
    if (carController) {
        carController.update(deltaTime);
        
        // Update Time Trial Logic
        if (typeof timeTrial !== 'undefined') {
            timeTrial.update(carModel.position);
        }
    }

    // 2. CAMERA (Follow the Car Object)
    if (carModel) {
        // Get the new position after physics moved it
        carModel.getWorldPosition(carWorldPosition);
        carModel.getWorldQuaternion(carWorldQuaternion);

        // Optimization: Show/Hide map chunks
        updateSectorVisibility(carWorldPosition);

        // Calculate Camera Target Position
        followSpherical.radius = THREE.MathUtils.clamp(followSpherical.radius, minCameraDistance, maxCameraDistance);
        relativeCameraOffset.setFromSpherical(followSpherical);
        relativeCameraOffset.applyQuaternion(carWorldQuaternion); 
        desiredCameraPosition.copy(carWorldPosition).add(relativeCameraOffset);
        
        // Smoothly Move Camera (The "Lag" effect)
        camera.position.lerp(desiredCameraPosition, chaseLerpFactor);

        // Look at the Car
        lookAtTarget.copy(carWorldPosition).add(lookAtOffset);
        camera.lookAt(lookAtTarget);
    }

    // 3. RENDER
    composer.render();
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
// Press 'C' to toggle collision highlights
let debugGroup = null;

function toggleCollisionDebug() {
    // 1. If debug is currently ON, turn it OFF
    if (debugGroup) {
        scene.remove(debugGroup);
        debugGroup = null;
        
        // Hide the Safety Net again
        const net = mapColliders.find(obj => obj.name === 'SafetyNet');
        if (net) {
            net.visible = false;
            // Restore original material properties if needed
            net.material.wireframe = false;
        }
        
        console.log("Collision Debug: OFF");
        return;
    }

    // 2. If debug is OFF, turn it ON
    console.log("Collision Debug: ON (Magenta = Road, Red = SafetyNet)");
    debugGroup = new THREE.Group();
    
    scene.add(debugGroup);

    // Create a shared material for the overlay
    const wireframeMat = new THREE.MeshBasicMaterial({
        color: 0xff00ff, // Hot Pink/Magenta
        wireframe: true,
        transparent: true,
        opacity: 0.3,
        depthTest: false // Draw ON TOP of everything (X-ray view)
    });

    mapColliders.forEach(obj => {
        // Special Case: The Safety Net
        if (obj.name === 'SafetyNet') {
            obj.visible = true;
            obj.material.color.setHex(0xff0000); // Red
            obj.material.wireframe = true;
            obj.material.transparent = true;
            obj.material.opacity = 0.5;
            return; // Don't add a clone, just show the real mesh
        }

        // Standard Case: Roads & Buildings
        // We create a clone mesh so we don't ruin the original textures
        if (obj.geometry) {
            const clone = new THREE.Mesh(obj.geometry, wireframeMat);
            
            // Copy transform exactly
            clone.position.copy(obj.position);
            clone.rotation.copy(obj.rotation);
            clone.scale.copy(obj.scale);
            
            // Add to the debug group
            debugGroup.add(clone);
        }
    });
}

// Bind to Key 'C'
window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'c') {
        toggleCollisionDebug();
    }
});

