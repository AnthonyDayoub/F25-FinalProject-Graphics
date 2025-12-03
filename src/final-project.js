import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
const chaseLerpFactor = 1.2;
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

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const environmentTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
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

    // Assume forward -Z; use minZ as the front and place lights slightly in front and low.
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

// --- CLASS: Time Trial Manager (Updated with Visual Debuggers) ---
class TimeTrialManager {
    constructor(uiCurrent, uiBest, uiLap) {
        this.uiCurrent = uiCurrent;
        this.uiBest = uiBest;
        this.uiLap = uiLap;
        
        this.lap = 1;
        this.startTime = 0;
        this.bestTime = Infinity;
        this.isRunning = false;

        // --- UPDATE THESE COORDINATES ---
        this.checkpoints = [
            // Checkpoint 1: Halfway point (Make sure this matches your map!)
            { pos: new THREE.Vector3(315, 28, -121), radius: 15, passed: false }, 
            
            // Checkpoint 2: Another point (optional)
            { pos: new THREE.Vector3(75, 50, 434), radius: 15, passed: false },

            // FINISH LINE: radius reduced to 15 (was 40)
            { pos: new THREE.Vector3(0, 18, 76), radius: 15, passed: false, isFinish: true } 
        ];
        
        this.nextCheckpointIndex = 0;

        // ✨ VISUAL DEBUGGER: This draws red spheres so you can SEE the checkpoints
        this.debugMeshes = [];
        this.checkpoints.forEach((cp, index) => {
            const geometry = new THREE.SphereGeometry(cp.radius, 16, 16);
            const material = new THREE.MeshBasicMaterial({ 
                color: cp.isFinish ? 0x00ff00 : 0xff0000, // Green for finish, Red for others
                wireframe: true,
                transparent: true,
                opacity: 0.3
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(cp.pos);
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

    resetCheckpoints() {
        this.checkpoints.forEach(cp => cp.passed = false);
        this.nextCheckpointIndex = 0;
        
        // Reset debug colors
        this.debugMeshes.forEach(m => m.material.color.setHex(0xff0000));
        // Set finish line to green
        this.debugMeshes[this.debugMeshes.length - 1].material.color.setHex(0x00ff00);
    }

    update(carPosition) {
        if (!this.isRunning) return;

        // 1. Update Timer UI
        const currentTime = clock.getElapsedTime() - this.startTime;
        this.uiCurrent.innerText = formatTime(currentTime);

        // 2. Check collisions with the NEXT checkpoint only
        const targetCP = this.checkpoints[this.nextCheckpointIndex];
        const targetMesh = this.debugMeshes[this.nextCheckpointIndex];

        // Highlight the next target in Yellow so you know where to drive
        if(targetMesh) targetMesh.material.color.setHex(0xffff00);
        
        const dist = Math.sqrt(
            Math.pow(carPosition.x - targetCP.pos.x, 2) + 
            Math.pow(carPosition.z - targetCP.pos.z, 2)
        );

        if (dist < targetCP.radius) {
            // eslint-disable-next-line no-console
            console.log(`Checkpoint ${this.nextCheckpointIndex + 1} reached!`);
            
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

// --- CarControls Class (Physics: Wall Collision REMOVED, Respawn Fixed) ---
class CarControls {
    constructor(model, idleSoundRef, accelerationSoundRef) {
        this.model = model;
        this.speed = 0;
        this.maxSpeed = 60; 
        this.acceleration = 30;
        this.brakeStrength = 40;
        this.drag = 0.5;
        this.steering = 0;
        this.maxSteer = 0.04;
        
        this.velocity = new THREE.Vector3();
        this.moveDirection = new THREE.Vector3(0, 0, -1); 
        
        this.groundRaycaster = new THREE.Raycaster();
        this.wallRaycaster = new THREE.Raycaster();
        
        this.gravity = 60; 
        this.isGrounded = false;

        this.lastSafePosition = new THREE.Vector3(0, 30, 90);
        this.lastSafeQuaternion = new THREE.Quaternion();
        
        // ✨ NEW: Timer to prevent saving unsafe positions at the edge
        this.safePosTimer = 0;

        this.idleSound = idleSoundRef || null;
        this.accelerationSound = accelerationSoundRef || null;
        this.engineSoundThreshold = 1;

        this.keys = { forward: false, backward: false, left: false, right: false, space: false };
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
    }

    setEngineAudio(idleAudio, accelerationAudio) {
        this.idleSound = idleAudio;
        this.accelerationSound = accelerationAudio;
        this.updateEngineAudio(true);
    }

    manualReset() {
        this.speed = 0;
        this.velocity.set(0, 0, 0);
        this.model.position.set(0, 30, 90); 
        this.model.rotation.set(0, 0, 0);
        this.lastSafePosition.set(0, 30, 90);
        this.moveDirection.set(0, 0, -1);
        this.updateEngineAudio(true);
        // Reset Time Trial too
        timeTrial.start();
    }

    onKeyDown(event) {
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
        // 1. Calculate Input Speed
        if (this.keys.forward) {
            this.speed += this.acceleration * deltaTime;
        } else if (this.keys.backward) {
            this.speed -= this.brakeStrength * deltaTime;
        } else {
            this.speed *= (1 - this.drag * deltaTime);
        }
        this.speed = THREE.MathUtils.clamp(this.speed, -this.maxSpeed / 2, this.maxSpeed);

        const isDrifting = this.keys.space && Math.abs(this.speed) > 10;
        const steerMultiplier = isDrifting ? 1.5 : 1.0;

        if (this.keys.left) this.steering = this.maxSteer * steerMultiplier;
        else if (this.keys.right) this.steering = -this.maxSteer * steerMultiplier;
        else this.steering = 0;

        if (Math.abs(this.speed) > 0.1) {
            this.model.rotation.y += this.steering * (this.speed > 0 ? 1 : -1);
        }

        // --- 4. Apply Movement (Drift logic) ---
        const carFacingDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.model.quaternion);
        const gripFactor = isDrifting ? 0.1 : 0.8;
        this.moveDirection.lerp(carFacingDir, gripFactor).normalize();

        if (Math.abs(this.speed) < 5) {
            this.moveDirection.copy(carFacingDir);
        }

        this.velocity.x = this.moveDirection.x * this.speed;
        this.velocity.z = this.moveDirection.z * this.speed;
        this.velocity.y -= this.gravity * deltaTime; 

        // 5. Ground Collision
        const groundRayOrigin = this.model.position.clone();
        groundRayOrigin.y += 2.0; 
        
        this.groundRaycaster.set(groundRayOrigin, new THREE.Vector3(0, -1, 0));
        const groundIntersects = this.groundRaycaster.intersectObjects(mapColliders);

        if (groundIntersects.length > 0) {
            const dist = groundIntersects[0].distance;
            
            if (dist < 2.5) {
                this.isGrounded = true;
                this.velocity.y = Math.max(0, this.velocity.y);
                this.model.position.y = groundIntersects[0].point.y + 0.05;
                
                // ✨ FIX: Only save safe position if grounded for > 1 second
                this.safePosTimer += deltaTime;
                if (this.safePosTimer > 1.0 && Math.abs(this.speed) > 2) {
                    this.lastSafePosition.copy(this.model.position);
                    this.lastSafePosition.y += 1.0; // Lift slightly to ensure raycast hits on respawn
                    this.lastSafeQuaternion.copy(this.model.quaternion);
                    this.safePosTimer = 0;
                }

            } else {
                this.isGrounded = false;
                this.safePosTimer = 0; // Reset timer if airborn
            }
        } else {
            this.isGrounded = false;
            this.safePosTimer = 0;
        }

        // 6. Apply Velocity
        this.model.position.addScaledVector(this.velocity, deltaTime);
        
        // 7. Void Respawn
        if(this.model.position.y < -50) {
            // eslint-disable-next-line no-console
            console.log("Fell into void! Respawning...");
            
            this.model.position.copy(this.lastSafePosition);
            this.model.position.y += 2.0; // Drop from slightly higher
            
            this.model.quaternion.copy(this.lastSafeQuaternion); 
            this.moveDirection.set(0,0,-1).applyQuaternion(this.lastSafeQuaternion); 
            
            // Kill all momentum
            this.speed = 0;
            this.velocity.set(0,0,0);
            this.safePosTimer = 0;
        }

        // 8. UPDATE UI
        uiSpeed.innerText = Math.abs(this.speed).toFixed(1);
        uiPosX.innerText = this.model.position.x.toFixed(1);
        uiPosY.innerText = this.model.position.y.toFixed(1);
        uiPosZ.innerText = this.model.position.z.toFixed(1);

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
    // Ensure this path is correct relative to your HTML file!
    trackLoader.setPath('mario_kart_8_deluxe_-_wii_moonview_highway/');

    scene.background = new THREE.Color(0x05070f);

    trackLoader.load(
        'scene.gltf',
        (gltf) => {
            // eslint-disable-next-line no-console
            console.log('Map loaded');
            const model = gltf.scene;
            model.scale.set(0.1, 0.1, 0.1); 
            model.position.set(0, 0, 0); 
            scene.add(model);

            model.traverse((child) => {
                if (child.isLight) {
                    child.parent?.remove(child); 
                } else if (child.isMesh) {
                    child.receiveShadow = true;
                    child.castShadow = true;
                    styleMeshForNeon(child);
                    mapColliders.push(child);
                    addMeshToSector(child);
                }
            });

            if (trackSectors.length <= 1) {
                sectorCullingEnabled = false;
                forceAllSectorsVisible();
            }
        },
        null,
        // eslint-disable-next-line no-console
        (err) => console.error('Map GLTF load error:', err)
    );
}

// Load Car
const loader = new GLTFLoader();
loader.setPath('cyberpunk_car/');

loader.load(
    'scene.gltf',
    function (gltf) {
        // eslint-disable-next-line no-console
        console.log("Car model loaded");
        const model = gltf.scene;
        model.scale.set(0.01, 0.01, 0.01); 
        model.position.set(0, 60, 90); 
        
        model.traverse(function (node) {
            if (node.isMesh) node.castShadow = true;
        });

        carModel = model;
        scene.add(model);
        
        addCarHeadlights(model);

        carController = new CarControls(carModel, idleSound, accelerationSound);
        tryAttachAudio();

        // START THE CLOCK
        timeTrial.start();
    },
    null,
    // eslint-disable-next-line no-console
    function (error) { console.error('Car load error:', error); }
);

// Reset Button
btnReset.addEventListener('click', () => {
    if (carController) {
        carController.manualReset();
        window.focus(); 
    }
});


// --- Render Loop ---
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    if (carController) {
        carController.update(deltaTime);
        // UPDATE TIMER based on car position
        timeTrial.update(carModel.position);
    }

    if (carModel) {
        carModel.getWorldPosition(carWorldPosition);
        carModel.getWorldQuaternion(carWorldQuaternion);

        updateSectorVisibility(carWorldPosition);

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
    }

    // Effect Composer rendering
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