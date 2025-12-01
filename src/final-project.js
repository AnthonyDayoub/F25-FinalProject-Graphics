import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const clock = new THREE.Clock();

// --- UI Elements ---
const uiSpeed = document.getElementById('speed-display');
const uiPosX = document.getElementById('pos-x');
const uiPosY = document.getElementById('pos-y');
const uiPosZ = document.getElementById('pos-z');
const btnReset = document.getElementById('reset-btn');

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
scene.environment = environmentTexture;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector3(1, 1, 1), 1.25, 0.4, 0.85);
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
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8); 
scene.add(hemiLight);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(50, 100, 50);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(4096, 4096);
keyLight.shadow.camera.left = -100;
keyLight.shadow.camera.right = 100;
keyLight.shadow.camera.top = 100;
keyLight.shadow.camera.bottom = -100;
scene.add(keyLight);

// --- CarControls Class ---
// --- CarControls Class ---
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
        
        // ✨ NEW: Vector to track the direction of MOMENTUM (separate from car rotation)
        this.moveDirection = new THREE.Vector3(0, 0, -1); 
        
        // Raycasters
        this.groundRaycaster = new THREE.Raycaster();
        this.wallRaycaster = new THREE.Raycaster();
        
        this.gravity = 60; 
        this.isGrounded = false;

        this.lastSafePosition = new THREE.Vector3(0, 30, 0);
        this.lastSafeQuaternion = new THREE.Quaternion();
        this.idleSound = idleSoundRef || null;
        this.accelerationSound = accelerationSoundRef || null;
        this.engineSoundThreshold = 1;

        // ✨ NEW: Added 'space' to keys
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
        this.model.position.set(0, 20, 0); 
        this.model.rotation.set(0, 0, 0);
        this.lastSafePosition.set(0, 20, 0);
        // ✨ Reset movement vector on respawn
        this.moveDirection.set(0, 0, -1);
        this.updateEngineAudio(true);
    }

    onKeyDown(event) {
        switch (event.code) {
        case 'KeyW': case 'ArrowUp': this.keys.forward = true; break;
        case 'KeyS': case 'ArrowDown': this.keys.backward = true; break;
        case 'KeyA': case 'ArrowLeft': this.keys.left = true; break;
        case 'KeyD': case 'ArrowRight': this.keys.right = true; break;
        case 'Space': this.keys.space = true; break; // ✨ Detect Space
        }
    }

    onKeyUp(event) {
        switch (event.code) {
        case 'KeyW': case 'ArrowUp': this.keys.forward = false; break;
        case 'KeyS': case 'ArrowDown': this.keys.backward = false; break;
        case 'KeyA': case 'ArrowLeft': this.keys.left = false; break;
        case 'KeyD': case 'ArrowRight': this.keys.right = false; break;
        case 'Space': this.keys.space = false; break; // ✨ Detect Space
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

        // ✨ NEW: Check Drift State
        // You can only drift if moving forward fast enough
        const isDrifting = this.keys.space && this.speed > 10;
        
        // 2. Steering
        // While drifting, we allow sharper steering to emphasize the slide
        const steerMultiplier = isDrifting ? 1.5 : 1.0;

        if (this.keys.left) this.steering = this.maxSteer * steerMultiplier;
        else if (this.keys.right) this.steering = -this.maxSteer * steerMultiplier;
        else this.steering = 0;

        if (Math.abs(this.speed) > 0.1) {
            this.model.rotation.y += this.steering * (this.speed > 0 ? 1 : -1);
        }

        // 3. Detect Wall Collisions
        if (Math.abs(this.speed) > 0.1) {
            // We check wall collisions based on where the MODEL is facing
            const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.model.quaternion);
            if (this.speed < 0) forwardDir.negate(); 

            const rayOrigin = this.model.position.clone();
            rayOrigin.y += 0.5; 
            
            this.wallRaycaster.set(rayOrigin, forwardDir);
            const wallIntersects = this.wallRaycaster.intersectObjects(mapColliders);
            
            if (wallIntersects.length > 0 && wallIntersects[0].distance < 2) {
                this.speed = 0;
            }
        }

        // 4. Apply Movement Vector (THE DRIFT LOGIC)
        // Get the direction the 3D model is currently facing
        const carFacingDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.model.quaternion);
        
        // "Grip" determines how strictly the car follows its rotation.
        // High grip (0.8) = Car goes where it looks (Normal driving).
        // Low grip (0.02) = Car slides on ice/drifts (Movement vector lags behind rotation).
        const gripFactor = isDrifting ? 0.1 : 0.8;

        // Linearly interpolate the MOVEMENT direction towards the FACING direction
        // This creates the "slide" effect.
        this.moveDirection.lerp(carFacingDir, gripFactor).normalize();

        // If reversing, we usually want inverted control, but for simplicity
        // we lock movement to facing direction when going slow/reverse to prevent bugs.
        if (this.speed < 5) {
            this.moveDirection.copy(carFacingDir);
        }

        // Apply speed to the Calculated Drift Direction, NOT the model's rotation
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
                
                if (this.speed > 1) {
                    this.lastSafePosition.copy(this.model.position);
                    this.lastSafePosition.y += 1.0; 
                    this.lastSafeQuaternion.copy(this.model.quaternion);
                }

            } else {
                this.isGrounded = false;
            }
        } else {
            this.isGrounded = false;
        }

        // 6. Apply Velocity
        this.model.position.addScaledVector(this.velocity, deltaTime);
        
        // 7. Void Respawn
        if(this.model.position.y < -50) {
            console.log("Fell into void! Respawning at safe spot...");
            this.model.position.copy(this.lastSafePosition);
            this.model.quaternion.copy(this.lastSafeQuaternion); // Restore rotation too
            this.moveDirection.set(0,0,-1).applyQuaternion(this.lastSafeQuaternion); // Restore vector
            this.speed = 0;
            this.velocity.set(0,0,0);
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

let carController;

// --- Loaders ---
export function levelOneBackground() {
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
    const trackLoader = new GLTFLoader();
    trackLoader.setDRACOLoader(draco);
    trackLoader.setPath('mario_kart_8_deluxe_-_wii_moonview_highway/');

    const rgbe = new RGBELoader();
    rgbe.load('/textures/sky.hdr', (hdr) => {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = hdr;
        scene.background = hdr;
    });

    trackLoader.load(
        'scene.gltf',
        (gltf) => {
            console.log('Mario Kart map loaded');
            const model = gltf.scene;
            
            model.scale.set(0.1, 0.1, 0.1); 
            model.position.set(0, 0, 0); 
            scene.add(model);

            model.traverse((child) => {
                if (child.isMesh) {
                    child.receiveShadow = true;
                    child.castShadow = true;
                    mapColliders.push(child);
                }
            });
        },
        undefined,
        (err) => console.error('Mario Kart GLTF load error:', err)
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
        model.position.set(0, 100, 0); 
        
        model.traverse(function (node) {
            if (node.isMesh) node.castShadow = true;
        });

        carModel = model;
        scene.add(model);

        carController = new CarControls(carModel, idleSound, accelerationSound);
        tryAttachAudio();
    },
    undefined,
    function (error) { console.error('Car load error:', error); }
);

// ✨ Hook up Reset Button
btnReset.addEventListener('click', () => {
    if (carController) {
        carController.manualReset();
        // Return focus to window so you can keep driving immediately
        window.focus(); 
    }
});


// --- Render Loop ---
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    if (carController) {
        carController.update(deltaTime);
    }

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
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}, false);

levelOneBackground();
animate();
