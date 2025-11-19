import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

// ✨ 1. Added Clock for physics
const clock = new THREE.Clock();

// --- Basic Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01030a); 
scene.fog = new THREE.FogExp2(0x040b16, 0.002); // Reduced fog density for large maps

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000); // Increased Far clip for big maps
const defaultCameraPosition = new THREE.Vector3(0, 10, 20);
const defaultCameraTarget = new THREE.Vector3(0, 0, 0);
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
const followSpherical = new THREE.Spherical(15, THREE.MathUtils.degToRad(60), 0); // Adjusted camera default
let minCameraDistance = 5;
let maxCameraDistance = 30;
const minPolarAngle = THREE.MathUtils.degToRad(20);
const maxPolarAngle = THREE.MathUtils.degToRad(85);
const pointerRotationSpeed = 0.0055;
const scrollZoomFactor = 0.05; // Faster zoom
const relativeCameraOffset = new THREE.Vector3();
const desiredCameraPosition = new THREE.Vector3();
const lookAtOffset = new THREE.Vector3(0, 2, 0);
const lookAtTarget = new THREE.Vector3();
const pointerState = { dragging: false, pointerId: null, lastX: 0, lastY: 0 };

// --- COLLISION GLOBAL ---
// We will store the map meshes here to check against
const mapColliders = []; 

// --- Texture + Audio Helpers (Kept in case you need them later) ---
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

// Reduced effects slightly for clarity while debugging map
// const afterimagePass = new AfterimagePass(0.78);
// composer.addPass(afterimagePass);
// const filmPass = new FilmPass(0.45, 0.025, 648, false);
// composer.addPass(filmPass);

// --- Pointer / camera events (Standard Logic) ---
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
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8); // Brighter for map visibility
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(50, 100, 50);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(4096, 4096); // Higher res shadow
keyLight.shadow.camera.left = -100;
keyLight.shadow.camera.right = 100;
keyLight.shadow.camera.top = 100;
keyLight.shadow.camera.bottom = -100;
scene.add(keyLight);

// ======================================================
// 🔴 DISABLED CITY & PROCEDURAL TRACK 🔴
// ======================================================
/* // ... (City generation code commented out) ...
// If you want the city back, just uncomment this block and the related variables above
// but make sure to remove the Mario Kart map logic or position them far apart.
*/

// --- CarControls Class (Updated for Collision) ---
class CarControls {
    constructor(model) {
        this.model = model;
        this.speed = 0;
        this.maxSpeed = 60; // Adjusted for map scale
        this.acceleration = 30;
        this.brakeStrength = 40;
        this.drag = 0.5;
        this.steering = 0;
        this.maxSteer = 0.04; // Direct rotation value
        
        // Physics variables
        this.velocity = new THREE.Vector3();
        this.raycaster = new THREE.Raycaster();
        this.gravity = 40;
        this.isGrounded = false;

        this.keys = { forward: false, backward: false, left: false, right: false };
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
    }

    onKeyDown(event) {
        switch (event.code) {
            case 'KeyW': case 'ArrowUp': this.keys.forward = true; break;
            case 'KeyS': case 'ArrowDown': this.keys.backward = true; break;
            case 'KeyA': case 'ArrowLeft': this.keys.left = true; break;
            case 'KeyD': case 'ArrowRight': this.keys.right = true; break;
        }
    }

    onKeyUp(event) {
        switch (event.code) {
            case 'KeyW': case 'ArrowUp': this.keys.forward = false; break;
            case 'KeyS': case 'ArrowDown': this.keys.backward = false; break;
            case 'KeyA': case 'ArrowLeft': this.keys.left = false; break;
            case 'KeyD': case 'ArrowRight': this.keys.right = false; break;
        }
    }

    update(deltaTime) {
        // 1. Handle Input (Steering)
        if (this.keys.left) this.steering = this.maxSteer;
        else if (this.keys.right) this.steering = -this.maxSteer;
        else this.steering = 0;

        // Apply steering (rotate the car model)
        // Only steer if moving (simple mechanic)
        if (Math.abs(this.speed) > 0.1) {
             this.model.rotation.y += this.steering * (this.speed > 0 ? 1 : -1);
        }

        // 2. Handle Speed
        if (this.keys.forward) {
            this.speed += this.acceleration * deltaTime;
        } else if (this.keys.backward) {
            this.speed -= this.brakeStrength * deltaTime;
        } else {
            // Drag
            this.speed *= (1 - this.drag * deltaTime);
        }
        this.speed = THREE.MathUtils.clamp(this.speed, -this.maxSpeed / 2, this.maxSpeed);

        // 3. Calculate Velocity Vector based on car rotation
        const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.model.quaternion);
        
        // Horizontal Movement
        this.velocity.x = forwardDir.x * this.speed;
        this.velocity.z = forwardDir.z * this.speed;

        // 4. Apply Gravity
        this.velocity.y -= this.gravity * deltaTime;

        // 5. Collision Detection (Raycast Down)
        // We cast a ray from the center of the car slightly UP, downwards.
        const rayOrigin = this.model.position.clone();
        rayOrigin.y += 2; // Start ray 2 units above car
        
        this.raycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
        
        // Check intersection with map colliders
        const intersects = this.raycaster.intersectObjects(mapColliders);

        if (intersects.length > 0) {
            const distanceToGround = intersects[0].distance;
            // distanceToGround includes the 2 units offset.
            // If distance is approx 2, we are on ground.
            
            if (distanceToGround < 2.5) {
                this.isGrounded = true;
                this.velocity.y = Math.max(0, this.velocity.y); // Stop falling
                // Snap to ground (add slight offset so wheels sit on top)
                this.model.position.y = intersects[0].point.y + 0.05; 
            } else {
                this.isGrounded = false;
            }
        } else {
            this.isGrounded = false;
        }

        // 6. Apply Movement
        this.model.position.addScaledVector(this.velocity, deltaTime);
        
        // Floor limit (failsafe)
        if(this.model.position.y < -50) {
            this.model.position.set(0, 5, 0); // Respawn if fell off world
            this.speed = 0;
            this.velocity.set(0,0,0);
        }
    }
}

let carController;

// --- Loaders ---

// 1. Load Map (Mario Kart)
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
            
            // 🔴 Scale adjusted to be more realistic for physics
            model.scale.set(0.1, 0.1, 0.1); 
            
            model.position.set(0, 0, 0); // Ensure map is at center
            
            scene.add(model);

            // 🔴 Collect Colliders
            // We traverse the map to find all meshes to drive on
            model.traverse((child) => {
                if (child.isMesh) {
                    child.receiveShadow = true;
                    child.castShadow = true;
                    mapColliders.push(child);
                    
                    // Optional: Optimize collision by making invisible barriers visible or simplifing materials
                    // child.material.side = THREE.DoubleSide; 
                }
            });
        },
        undefined,
        (err) => console.error('Mario Kart GLTF load error:', err)
    );
}

// 2. Load Car
const loader = new GLTFLoader();
loader.setPath('cyberpunk_car/');

loader.load(
    'scene.gltf',
    function (gltf) {
        console.log("Car model loaded");
        const model = gltf.scene;
        
        // 🔴 Adjust Car Scale relative to new Map Scale
        model.scale.set(0.01, 0.01, 0.01); 
        // 🔴 Spawn Position (Drop it from the sky onto the track)
        model.position.set(0, 100, 0); 
        
        model.traverse(function (node) {
            if (node.isMesh) node.castShadow = true;
        });

        carModel = model;
        scene.add(model);

        carController = new CarControls(carModel);
    },
    undefined,
    function (error) { console.error('Car load error:', error); }
);


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
        // Optional: Rotate camera with car (chase mode) or keep absolute
        relativeCameraOffset.applyQuaternion(carWorldQuaternion); 

        desiredCameraPosition.copy(carWorldPosition).add(relativeCameraOffset);
        camera.position.lerp(desiredCameraPosition, chaseLerpFactor);

        lookAtTarget.copy(carWorldPosition).add(lookAtOffset);
        camera.lookAt(lookAtTarget);
    }

    renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}, false);

// Start
levelOneBackground();
animate();