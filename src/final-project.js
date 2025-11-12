import * as THREE from 'three';
// Import the GLTFLoader
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Import orbit controls for testing
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Basic Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd1e5); // Light blue background

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 15); // Adjust camera position as needed

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

const neonArrowMaterial = new THREE.MeshStandardMaterial({
    color: 0x00fff4,
    emissive: 0x00fff4,
    emissiveIntensity: 1.5,
    transparent: true,
    opacity: 0.9
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
    const railGeometry = new THREE.BoxGeometry(0.2, 1, length);
    const rail = new THREE.Mesh(railGeometry, guardRailMaterial);
    rail.position.set(offsetX, 0.6, 0);
    rail.castShadow = true;
    return rail;
};

const createNeonArrow = () => {
    const arrowGeometry = new THREE.ConeGeometry(0.4, 1.2, 16);
    const arrow = new THREE.Mesh(arrowGeometry, neonArrowMaterial);
    arrow.rotation.x = Math.PI;
    arrow.position.y = 0.8;
    return arrow;
};

const straightSection = new THREE.Group();
straightSection.name = 'straightSection';
const straightTrack = createTrackSegment(20);
straightSection.add(straightTrack);
straightSection.add(createGuardRail(20, 2.3));
straightSection.add(createGuardRail(20, -2.3));

for (let i = -2; i <= 2; i++) {
    const arrow = createNeonArrow();
    arrow.position.z = i * 2.5;
    straightSection.add(arrow);
}

trackGroup.add(straightSection);

const bankedTurn = new THREE.Group();
bankedTurn.name = 'bankedTurn';
const bankedPiece = createTrackSegment(15);
bankedPiece.rotation.y = Math.PI / 4;
bankedTurn.add(bankedPiece);
bankedTurn.add(createGuardRail(15, 2.3));
bankedTurn.add(createGuardRail(15, -2.3));
bankedTurn.position.set(0, 0, -15);
bankedTurn.rotation.z = THREE.MathUtils.degToRad(18);

const arrowCluster = new THREE.Group();
for (let i = 0; i < 3; i++) {
    const arrow = createNeonArrow();
    arrow.position.set(0, 0.8 + i * 0.2, -3 + i);
    arrow.rotation.x = Math.PI * 0.9;
    arrowCluster.add(arrow);
}
arrowCluster.position.set(0, 0, -4);
bankedTurn.add(arrowCluster);

trackGroup.add(bankedTurn);
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

    for (let y = 1; y < height; y += 2) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(width * 0.8, 0.1, 0.1), windowMaterial);
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

const blockOffsets = [-10, 10];
blockOffsets.forEach((xOffset) => {
    const building = createBuilding({ width: 4, height: 8 + Math.random() * 4, depth: 4, color: 0x38304c });
    building.position.x = xOffset;
    building.position.z = -10;
    cityBlocks.add(building);

    const lowRise = createBuilding({ width: 6, height: 4, depth: 4, color: 0x241b2f });
    lowRise.position.set(xOffset + 5, -0.5, -5);
    cityBlocks.add(lowRise);
});

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

scene.add(cityBlocks, skyStuff);

// --- Controls (for easy testing) ---
const controls = new OrbitControls(camera, renderer.domElement);
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
    controls.update(); // Update controls
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
