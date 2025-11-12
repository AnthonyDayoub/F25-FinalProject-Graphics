import * as THREE from 'three';
// Import the GLTFLoader
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Import orbit controls for testing
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // ✨ Removed, you have a custom camera

// ✨ 1. Added Clock for physics
const clock = new THREE.Clock();

// --- Basic Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd1e5); // Light blue background

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const defaultCameraPosition = new THREE.Vector3(0, 7, 20);
const defaultCameraTarget = new THREE.Vector3(0, 2, -5);
camera.position.copy(defaultCameraPosition);
camera.lookAt(defaultCameraTarget);

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

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true; // Enable shadows
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.domElement.style.cursor = 'grab';
renderer.domElement.style.touchAction = 'none';

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
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 7.5);
directionalLight.castShadow = true; // Enable shadows on the light
scene.add(directionalLight);

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

// --- Track + Environment (unchanged) ---
const trackGroup = new THREE.Group();
trackGroup.name = 'trackGroup';

const guardRailMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x5ec8ff,
    emissiveIntensity: 0.3,
    metalness: 0.4,
    roughness: 0.2
});

const trackMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    metalness: 0.1,
    roughness: 0.7
});

const createTrackSegment = (length, width = 4) => {
    const geometry = new THREE.BoxGeometry(width, 0.25, length);
    const mesh = new THREE.Mesh(geometry, trackMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
};

const createGuardRail = (length, offsetX) => {
    const railGeometry = new THREE.BoxGeometry(0.3, 1, length);
    const rail = new THREE.Mesh(railGeometry, guardRailMaterial);
    rail.position.set(offsetX, 0.6, -length / 2);
    rail.castShadow = true;
    rail.receiveShadow = true;
    return rail;
};

const buildTrackSection = (length) => {
    const section = new THREE.Group();
    const trackSurface = createTrackSegment(length);
    trackSurface.position.z = -length / 2;
    section.add(trackSurface);
    section.add(createGuardRail(length, 2.4));
    section.add(createGuardRail(length, -2.4));
    return section;
};

const trackSectionsConfig = [
    { length: 20, turn: 0, tilt: 0 },
    { length: 12, turn: THREE.MathUtils.degToRad(-30), tilt: THREE.MathUtils.degToRad(8) },
    { length: 18, turn: THREE.MathUtils.degToRad(-45), tilt: THREE.MathUtils.degToRad(12) },
    { length: 22, turn: 0, tilt: 0 }
];

const headingAxis = new THREE.Vector3(0, 1, 0);
const trackAdvance = new THREE.Vector3();
let currentHeading = 0;
const currentPosition = new THREE.Vector3(0, 0, 0);

trackSectionsConfig.forEach((sectionConfig, index) => {
    const section = buildTrackSection(sectionConfig.length);
    section.name = `trackSection_${index}`;
    section.position.copy(currentPosition);
    section.rotation.y = currentHeading;
    section.rotation.z = sectionConfig.tilt;
    trackGroup.add(section);

    trackAdvance.set(0, 0, -sectionConfig.length);
    trackAdvance.applyAxisAngle(headingAxis, currentHeading);
    currentPosition.add(trackAdvance);
    currentHeading += sectionConfig.turn;
});

scene.add(trackGroup);

// --- City + Sky (unchanged) ---
const cityBlocks = new THREE.Group();
cityBlocks.name = 'cityBlocks';
const skyStuff = new THREE.Group();
skyStuff.name = 'skyStuff';

const createBuilding = ({ width, height, depth, color }) => {
    const buildingGroup = new THREE.Group();
    const building = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({
            color,
            metalness: 0.2,
            roughness: 0.6
        })
    );
    building.position.y = height / 2;
    building.castShadow = true;
    building.receiveShadow = true;

    const windowMaterial = new THREE.MeshStandardMaterial({
        color: 0x2dd6ff,
        emissive: 0x2dd6ff,
        emissiveIntensity: 0.8
    });

    for (let y = 1; y < height; y += 1.5) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(width * 0.85, 0.12, 0.1), windowMaterial);
        window.position.set(0, y, depth / 2 + 0.01);
        buildingGroup.add(window);
    }

    const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.8, height * 0.2),
        new THREE.MeshStandardMaterial({
            color: 0xff00ff,
            emissive: 0xff00ff,
            emissiveIntensity: 0.4,
            side: THREE.DoubleSide
        })
    );
    sign.position.set(0, height * 0.6, depth / 2 + 0.2);
    buildingGroup.add(building, sign);
    return buildingGroup;
};

const blockOffsets = [-20, -10, 10, 20];
blockOffsets.forEach((xOffset, index) => {
    const building = createBuilding({
        width: 5 + Math.random() * 2,
        height: 12 + Math.random() * 6,
        depth: 5 + Math.random() * 2,
        color: index % 2 === 0 ? 0x38304c : 0x2b203a
    });
    building.position.set(xOffset, 0, -12 - Math.random() * 8);
    cityBlocks.add(building);

    const tower = createBuilding({ width: 4, height: 16 + Math.random() * 6, depth: 4, color: 0x1f142c });
    tower.position.set(xOffset + (Math.random() > 0.5 ? 4 : -4), 0, -18 - Math.random() * 6);
    cityBlocks.add(tower);
});

cityBlocks.scale.set(2.2, 2.2, 2.2);
cityBlocks.position.z = -6;

const flyingBillboard = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2),
    new THREE.MeshStandardMaterial({
        color: 0x00a8ff,
        emissive: 0x00a8ff,
        emissiveIntensity: 0.6,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
    })
);
flyingBillboard.position.set(-3, 6, -8);
flyingBillboard.rotation.y = Math.PI / 6;
skyStuff.add(flyingBillboard);

const drone = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.2 })
);
drone.position.set(2, 5, -5);

const droneProp = new THREE.Mesh(
    new THREE.TorusGeometry(0.6, 0.05, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xffd200 })
);
droneProp.rotation.x = Math.PI / 2;
drone.add(droneProp);
skyStuff.add(drone);

const distantTraffic = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 6, 8),
    new THREE.MeshStandardMaterial({
        color: 0xff3300,
        emissive: 0xff3300,
        emissiveIntensity: 0.7
    })
);
distantTraffic.position.set(0, 7, -20);
skyStuff.add(distantTraffic);

skyStuff.scale.set(1.5, 1.5, 1.5);
skyStuff.position.set(0, 1, -5);

scene.add(cityBlocks, skyStuff);

// --- ✨ 2. Removed the old OrbitControls section ---
// const controls = new OrbitControls(camera, renderer.domElement);
// controls.enabled = true; 
// controls.target.set(0, 2, -5);
// controls.update();

// --- CarControls Class (unchanged) ---
class CarControls {
    constructor(model) {
        this.model = model;
        this.speed = 0;
        this.maxSpeed = 1.0;
        this.acceleration = 0.5;
        this.brakeStrength = 2.0;
        this.drag = 0.3;
        this.steering = 0;
        this.maxSteer = 0.8;
        this.steerSpeed = 1.5;
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
        
        // This is still correct (model's forward is -Z)
        this.model.translateZ(-this.speed * deltaTime);
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
        
        // Initialize the CarControls (no change here)
        carController = new CarControls(carModel);
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