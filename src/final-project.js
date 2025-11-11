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

        model.scale.set(0.075, 0.075, 0.075);

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