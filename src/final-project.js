import * as THREE from 'three';
// Import the GLTFLoader
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Import orbit controls for testing
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Basic Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd1e5); // Light blue background

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const defaultCameraPosition = new THREE.Vector3(0, 7, 20);
const defaultCameraTarget = new THREE.Vector3(0, 2, -5);
camera.position.copy(defaultCameraPosition);
camera.lookAt(defaultCameraTarget);

// Camera follow helpers
const chaseOffset = new THREE.Vector3(0, 4, 10);
const lookOffset = new THREE.Vector3(0, 1.5, -4);
const chaseLerpFactor = 0.12;
const idleLerpFactor = 0.05;
const chaseCameraPosition = new THREE.Vector3();
const chaseLookAt = new THREE.Vector3();
const carWorldPosition = new THREE.Vector3();
const carWorldQuaternion = new THREE.Quaternion();
let carModel = null;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true; // Enable shadows
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

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

// --- Track + Environment Grouping (rough draft) ---
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

// --- City + Sky group placeholders ---
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

// --- Controls (for easy testing) ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
controls.target.copy(defaultCameraTarget);
controls.update();

// --- ✨ Model Loader Logic ✨ ---
const loader = new GLTFLoader();

// Set the path relative to index.html (which is in 'src')
// No '..' or '/' needed.
loader.setPath('cyberpunk_car/'); 

// Load the file by name
loader.load(
    'scene.gltf',
    
    // onLoad callback
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
    },
    
    // onProgress callback
    function (xhr) {
        console.log((xhr.loaded / xhr.total * 100) + '% loaded');
    },
    
    // onError callback
    function (error) {
        console.error('An error happened while loading the model:', error);
    }
);

// --- Render Loop ---
function animate() {
    requestAnimationFrame(animate);

    if (carModel) {
        carModel.getWorldPosition(carWorldPosition);
        carModel.getWorldQuaternion(carWorldQuaternion);

        chaseCameraPosition.copy(chaseOffset).applyQuaternion(carWorldQuaternion).add(carWorldPosition);
        camera.position.lerp(chaseCameraPosition, chaseLerpFactor);

        chaseLookAt.copy(lookOffset).applyQuaternion(carWorldQuaternion).add(carWorldPosition);
        camera.lookAt(chaseLookAt);
    } else {
        camera.position.lerp(defaultCameraPosition, idleLerpFactor);
        camera.lookAt(defaultCameraTarget);
    }

    renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}, false);

// Start the animation
animate();
