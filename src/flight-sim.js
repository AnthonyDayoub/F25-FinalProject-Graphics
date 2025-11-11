import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generateTerrain, extractTop, extractBottom, extractLeft, extractRight } from './terrain-generation.js';

const WING_SPAN = 11; 
const MAX_SPEED = 55; 
const MAX_ALTITUDE = 4200; 
const GRAVITY = 9.81; 
const SQUARE_SIZE = 2000; 

const TERRAIN_DETAIL = 5; 
const TERRAIN_ROUGHNESS = 0.2;
const TERRAIN_GRID_RADIUS = 1; 
const TERRAIN_HEIGHT_SCALE = 70; 
const INITIAL_PLANE_POSITION = new THREE.Vector3(0, 200, 0);

const INITIAL_VELOCITY = new THREE.Vector3(-20, 0, 0);
const INITIAL_ANGULAR_VELOCITY = new THREE.Vector3(0, 0, 0);
const INITIAL_THRUST = 0.5;


const USE_ORBIT_CONTROLS = false; 
const DEBUG = false;


let scene, camera, renderer, clock;
let controls;


let planeModel, propeller;
let leftHeadlight, rightHeadlight;
let leftConeMesh, rightConeMesh;


let sky, sunLight, ambientLight;
const sunPosition = new THREE.Vector3();
const nightFog = new THREE.Color(0x000022);
const dayFog = new THREE.Color(0x87CEEB);


let shadowCamHelper;
let terrainManager;
let simulationStopped = false;


let planeState = {
    velocity: INITIAL_VELOCITY.clone(), 
    angularVelocity: INITIAL_ANGULAR_VELOCITY.clone(), 
    thrust: INITIAL_THRUST, 
};


let keyStates = {};
let sliderTime = null; 


const cameraOffset = new THREE.Vector3(100, 50, 0); 
const cameraLookAt = new THREE.Vector3(0,20, 0); 
const idealCamPos = new THREE.Vector3();
const idealCamLookAt = new THREE.Vector3();


const fwd = new THREE.Vector3(1, 0, 0);
const acceleration = new THREE.Vector3();
const quaternion = new THREE.Quaternion();


const LANDING_GRID_SIZE = 6;
const LANDING_POINT_COUNT = LANDING_GRID_SIZE * LANDING_GRID_SIZE;
const landingSampleOffsets = [];
const landingSampleWorld = [];
const landingRaycaster = new THREE.Raycaster();
const landingRayDirection = new THREE.Vector3(0, -1, 0);
const landingRaycastHits = [];
let landingSamplesConfigured = false;
let landingCollisionGroundHeight = 0;

for (let index = 0; index < LANDING_POINT_COUNT; index++) {
    landingSampleOffsets.push(new THREE.Vector3());
    landingSampleWorld.push(new THREE.Vector3());
}


function init() {
    
    clock = new THREE.Clock();

    
    scene = new THREE.Scene();

    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
    const planeStartPosition = INITIAL_PLANE_POSITION;
    const startCamPos = new THREE.Vector3().copy(cameraOffset);
    startCamPos.add(planeStartPosition);
    
    const startCamLookAt = new THREE.Vector3().copy(cameraLookAt);
    startCamLookAt.add(planeStartPosition);

    camera.position.copy(startCamPos);
    camera.lookAt(startCamLookAt);

    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
  
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    
    document.getElementById('container').prepend(renderer.domElement);

    
    initLighting();
    initGround(); 
    initControls();
    initAircraft(); 
    initInputListeners(); 
    initResetButton();

    
    window.addEventListener('resize', onWindowResize, false);

    
    animate();
}


function initLighting() {
    
    sky = new Sky();
    sky.scale.setScalar(450000);
    scene.add(sky);

    
    ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
    scene.add(ambientLight);

    
    sunLight = new THREE.DirectionalLight(0xffffff, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = SQUARE_SIZE * 1.5; 
    sunLight.shadow.camera.left = -SQUARE_SIZE;
    sunLight.shadow.camera.right = SQUARE_SIZE;
    sunLight.shadow.camera.top = SQUARE_SIZE;
    sunLight.shadow.camera.bottom = -SQUARE_SIZE;
    sunLight.shadow.bias = -0.001; 
    scene.add(sunLight);
    scene.add(sunLight.target); 

    
    scene.fog = new THREE.Fog(nightFog, 1, 5000); 

    
    if (DEBUG) {
        shadowCamHelper = new THREE.CameraHelper(sunLight.shadow.camera);
        scene.add(shadowCamHelper);
    }
}

class TerrainManager {
    constructor(sceneRef, {
        tileSize = SQUARE_SIZE,
        detail = TERRAIN_DETAIL,
        roughness = TERRAIN_ROUGHNESS,
        gridRadius = TERRAIN_GRID_RADIUS,
        heightScale = TERRAIN_HEIGHT_SCALE,
        material = null,
    } = {}) {
        this.scene = sceneRef;
        this.tileSize = tileSize;
        this.detail = detail;
        this.roughness = roughness;
        this.gridRadius = gridRadius;
        this.heightScale = heightScale;
        this.tiles = new Map();
        this.material = material ?? new THREE.MeshStandardMaterial({
            color: 0x3a5f0b,
            roughness: 0.95,
            metalness: 0.05,
        });
        this.currentTile = null;
        this.raycastTargets = [];
    }

    init(center = new THREE.Vector3(0, 0, 0)) {
        this.currentTile = this.worldToTile(center.x, center.z);
        this.ensureTilesAround(this.currentTile);
    }

    update(position) {
        if (!position) { return; }
        const tileCoord = this.worldToTile(position.x, position.z);
        if (!this.currentTile ||
            tileCoord.i !== this.currentTile.i ||
            tileCoord.j !== this.currentTile.j) {
            this.currentTile = tileCoord;
            this.ensureTilesAround(tileCoord);
            this.cleanup(tileCoord);
        }
    }

    ensureTilesAround(center) {
        for (let dz = -this.gridRadius; dz <= this.gridRadius; dz++) {
            for (let dx = -this.gridRadius; dx <= this.gridRadius; dx++) {
                this.ensureTile(center.i + dx, center.j + dz);
            }
        }
    }

    ensureTile(i, j) {
        const key = this.tileKey(i, j);
        if (this.tiles.has(key)) { return; }
        const constraints = this.collectEdgeConstraints(i, j);
        const heightMap = generateTerrain(this.detail, this.roughness, constraints);
        const mesh = buildTerrainMesh(heightMap, this.tileSize, this.material, this.heightScale);
        mesh.position.set(i * this.tileSize, 0, j * this.tileSize);
        this.scene.add(mesh);
        this.tiles.set(key, { i, j, mesh, heights: heightMap });
        this.raycastTargets.push(mesh);
    }

    collectEdgeConstraints(i, j) {
        const constraints = {};
        const north = this.tiles.get(this.tileKey(i, j - 1));
        const south = this.tiles.get(this.tileKey(i, j + 1));
        const west = this.tiles.get(this.tileKey(i - 1, j));
        const east = this.tiles.get(this.tileKey(i + 1, j));

        if (north) { constraints.top = Float32Array.from(extractBottom(north.heights)); }
        if (south) { constraints.bottom = Float32Array.from(extractTop(south.heights)); }
        if (west) { constraints.right = Float32Array.from(extractLeft(west.heights)); }
        if (east) { constraints.left = Float32Array.from(extractRight(east.heights)); }

        this.ensureCornerContinuity(constraints, {
            northWest: this.tiles.get(this.tileKey(i - 1, j - 1)),
            northEast: this.tiles.get(this.tileKey(i + 1, j - 1)),
            southWest: this.tiles.get(this.tileKey(i - 1, j + 1)),
            southEast: this.tiles.get(this.tileKey(i + 1, j + 1)),
        });

        return constraints;
    }

    ensureCornerContinuity(constraints, diagonals) {
        const { top, bottom, left, right } = constraints;
        const edgeLength = top?.length ?? bottom?.length ?? left?.length ?? right?.length;
        if (!edgeLength) { return; }

        const last = edgeLength - 1;

        const cornerValue = (tile, corner) => {
            if (!tile) { return null; }
            const heights = tile.heights;
            const max = heights.length - 1;
            switch (corner) {
            case 'NW': return heights[0][0];
            case 'NE': return heights[0][max];
            case 'SW': return heights[max][0];
            case 'SE': return heights[max][max];
            default: return null;
            }
        };

        const hasValue = (value) => value !== null && value !== void 0;

        const sync = (edgeA, indexA, edgeB, indexB, fallback) => {
            let value = edgeA ? edgeA[indexA] : null;
            if (!hasValue(value) && edgeB) { value = edgeB[indexB]; }
            if (!hasValue(value) && hasValue(fallback)) { value = fallback; }
            if (!hasValue(value)) { return; }
            if (edgeA) { edgeA[indexA] = value; }
            if (edgeB) { edgeB[indexB] = value; }
        };

        sync(top, 0, right, 0, cornerValue(diagonals.northWest, 'SE'));
        sync(top, last, left, 0, cornerValue(diagonals.northEast, 'SW'));
        sync(bottom, 0, right, right ? right.length - 1 : void 0, cornerValue(diagonals.southWest, 'NE'));
        sync(bottom, last, left, left ? left.length - 1 : void 0, cornerValue(diagonals.southEast, 'NW'));
    }

    getHeightAt(x, z) {
        const { i, j } = this.worldToTile(x, z);
        const tile = this.tiles.get(this.tileKey(i, j));
        if (!tile) { return 0; }

        const heightMap = tile.heights;
        const size = heightMap.length;
        if (!size) { return 0; }

        const half = this.tileSize / 2;
        const normalizedX = ((x - tile.mesh.position.x) + half) / this.tileSize;
        const normalizedZ = ((z - tile.mesh.position.z) + half) / this.tileSize;

        const clampedX = Math.min(Math.max(normalizedX, 0), 1);
        const clampedZ = Math.min(Math.max(normalizedZ, 0), 1);

        const scaledX = clampedX * (size - 1);
        const scaledZ = clampedZ * (size - 1);

        const x0 = Math.floor(scaledX);
        const z0 = Math.floor(scaledZ);
        const x1 = Math.min(x0 + 1, size - 1);
        const z1 = Math.min(z0 + 1, size - 1);

        const tx = scaledX - x0;
        const tz = scaledZ - z0;

        const h00 = heightMap[z0][x0];
        const h10 = heightMap[z0][x1];
        const h01 = heightMap[z1][x0];
        const h11 = heightMap[z1][x1];

        const hx0 = h00 * (1 - tx) + h10 * tx;
        const hx1 = h01 * (1 - tx) + h11 * tx;

        return (hx0 * (1 - tz) + hx1 * tz) * this.heightScale;
    }

    cleanup(center) {
        for (const [key, tile] of this.tiles) {
            if (Math.abs(tile.i - center.i) > this.gridRadius ||
                Math.abs(tile.j - center.j) > this.gridRadius) {
                this.removeTile(key);
            }
        }
    }

    removeTile(key) {
        const tile = this.tiles.get(key);
        if (!tile) { return; }
        this.scene.remove(tile.mesh);
        tile.mesh.geometry.dispose();
        const { mesh } = tile;
        const meshIndex = this.raycastTargets.indexOf(mesh);
        if (meshIndex !== -1) {
            const lastIndex = this.raycastTargets.length - 1;
            this.raycastTargets[meshIndex] = this.raycastTargets[lastIndex];
            this.raycastTargets.pop();
        }
        this.tiles.delete(key);
    }

    worldToTile(x, z) {
        const i = Math.floor((x + this.tileSize / 2) / this.tileSize);
        const j = Math.floor((z + this.tileSize / 2) / this.tileSize);
        return { i, j };
    }

    tileKey(i, j) {
        return `${i},${j}`;
    }
}


function initGround() {
    terrainManager = new TerrainManager(scene, {
        tileSize: SQUARE_SIZE,
        detail: TERRAIN_DETAIL,
        roughness: TERRAIN_ROUGHNESS,
        gridRadius: TERRAIN_GRID_RADIUS,
        heightScale: TERRAIN_HEIGHT_SCALE,
    });
    terrainManager.init(new THREE.Vector3(0, 0, 0));
}

function buildTerrainMesh(heightMap, tileSize, material, heightScale) {
    const size = heightMap.length;
    const geometry = new THREE.PlaneGeometry(tileSize, tileSize, size - 1, size - 1);
    const positions = geometry.attributes.position;

    let index = 0;
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            positions.setZ(index, heightMap[row][col] * heightScale);
            index++;
        }
    }

    positions.needsUpdate = true;
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    return mesh;
}


function configureLandingSamples(halfLength, halfWidth, halfHeight) {
    const stepX = (halfLength * 2) / (LANDING_GRID_SIZE - 1);
    const stepZ = (halfWidth * 2) / (LANDING_GRID_SIZE - 1);
    let index = 0;

    for (let row = 0; row < LANDING_GRID_SIZE; row++) {
        const offsetZ = -halfWidth + row * stepZ;
        for (let col = 0; col < LANDING_GRID_SIZE; col++) {
            const offsetX = -halfLength + col * stepX;
            landingSampleOffsets[index].set(offsetX, -halfHeight, offsetZ);
            landingSampleWorld[index].set(0, 0, 0);
            index++;
        }
    }

    landingSamplesConfigured = true;
}

function initAircraft() {
    const loader = new GLTFLoader();

    
    loader.load('fortnite_plane/scene.gltf', (gltf) => {
        
        
        
        
        planeModel = new THREE.Group();
        planeModel.position.copy(INITIAL_PLANE_POSITION); 

        
        const visualModel = gltf.scene;

        
        
        
        visualModel.rotation.y = Math.PI;

        
        const box = new THREE.Box3().setFromObject(visualModel);
        const size = new THREE.Vector3();
        box.getSize(size);
        const scaleFactor = WING_SPAN / (10 * size.x);
        visualModel.scale.set(scaleFactor, scaleFactor, scaleFactor);
        box.makeEmpty();
        box.expandByObject(visualModel);
        box.getSize(size);
        configureLandingSamples(size.x * 0.5, size.z * 0.5, size.y * 0.5);

        
        visualModel.traverse((child) => {
            if (child.isMesh) {
                if (child.name === "prop_11") {
                    child.castShadow = false;
                    child.receiveShadow = false;
                } else {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            }
        });

        
        planeModel.add(visualModel);
        
        
        scene.add(planeModel);

        
        
        propeller = planeModel.getObjectByName("prop_11");
        
        if (DEBUG && propeller) {
            console.log("Propeller object found:", propeller);
        } else if (DEBUG) {
            console.warn("Could not find propeller object named 'prop_11'");
        }
        
        
        const lightColor = 0xFFFEE8; 
        const lightIntensity = 0.0;   
        const lightDistance = 800;    
        const lightAngle = Math.PI / 9; 
        const lightPenumbra = 0.2;    
        const lightDecay = 2;         

        
        leftHeadlight = new THREE.SpotLight(lightColor, lightIntensity, lightDistance, lightAngle, lightPenumbra, lightDecay);
        rightHeadlight = new THREE.SpotLight(lightColor, lightIntensity, lightDistance, lightAngle, lightPenumbra, lightDecay);

        
        
        leftHeadlight.position.set(-1, 0.5, 50); 
        rightHeadlight.position.set(-1, 0.5, -50);
        
        
        const leftTarget = new THREE.Object3D();
        const rightTarget = new THREE.Object3D();
        
        
        
        
        leftTarget.position.set(-200, -50, 50);
        rightTarget.position.set(-200, -50, -50);

        
        planeModel.add(leftHeadlight, rightHeadlight);
        planeModel.add(leftTarget, rightTarget);

        
        leftHeadlight.target = leftTarget;
        rightHeadlight.target = rightTarget;

        
        leftHeadlight.castShadow = true;
        leftHeadlight.shadow.mapSize.width = 512;
        leftHeadlight.shadow.mapSize.height = 512;
        
        rightHeadlight.castShadow = true;
        rightHeadlight.shadow.mapSize.width = 512;
        rightHeadlight.shadow.mapSize.height = 512;

        if (DEBUG) {
            console.log("Headlights added to plane.");
            scene.add(new THREE.SpotLightHelper(leftHeadlight));
            scene.add(new THREE.SpotLightHelper(rightHeadlight));
        }
        

        

        
        
        const coneHeight = lightDistance * 0.8; 
        const coneRadius = Math.tan(lightAngle) * coneHeight;
        
        
        const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 32, 1, true); 

        const coneMaterial = new THREE.MeshBasicMaterial({
            color: 0xFFFEE8,
            transparent: true,
            opacity: 0.0, 
            blending: THREE.AdditiveBlending, 
            depthWrite: false 
        });
        
        
        leftConeMesh = new THREE.Mesh(coneGeo, coneMaterial.clone());
        rightConeMesh = new THREE.Mesh(coneGeo, coneMaterial.clone());

        
        
        
        leftConeMesh.rotation.z = -Math.PI / 2;
        rightConeMesh.rotation.z = -Math.PI / 2;

        
        leftConeMesh.position.x = -coneHeight / 2;
        rightConeMesh.position.x = -coneHeight / 2;

        
        
        const leftConeGroup = new THREE.Group();
        const rightConeGroup = new THREE.Group();

        leftConeGroup.position.copy(leftHeadlight.position);
        rightConeGroup.position.copy(rightHeadlight.position);
        
        leftConeGroup.add(leftConeMesh);
        rightConeGroup.add(rightConeMesh);

        
        planeModel.add(leftConeGroup, rightConeGroup);

        if (DEBUG) {
            console.log("Fake light beam cones added.");
        }
        

    },
    void 0, 
    (error) => {
        console.error('An error happened while loading the model:', error);
    });
}



function initControls() {
    if (USE_ORBIT_CONTROLS) {
        controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 200, 0); 
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.update();
    }
}


function initInputListeners() {
    window.addEventListener('keydown', (event) => {
        keyStates[event.code] = true;
    });
    window.addEventListener('keyup', (event) => {
        keyStates[event.code] = false;
    });

    
    const timeSlider = document.getElementById('timeSlider');
    if (timeSlider) {
        timeSlider.addEventListener('input', (event) => {
            sliderTime = parseFloat(event.target.value);
        });
        timeSlider.addEventListener('change', () => {
            sliderTime = null;
        });
    } else if (DEBUG) {
        console.warn('Time slider #timeSlider not found in HTML.');
    }
}

function initResetButton() {
    const resetButton = document.getElementById('reset');
    if (!resetButton) { return; }
    resetButton.addEventListener('click', resetSimulation);
}

function resetSimulation() {
    planeState.velocity.copy(INITIAL_VELOCITY);
    planeState.angularVelocity.copy(INITIAL_ANGULAR_VELOCITY);
    planeState.thrust = INITIAL_THRUST;
    simulationStopped = false;

    if (planeModel) {
        planeModel.position.copy(INITIAL_PLANE_POSITION);
        planeModel.quaternion.set(0, 0, 0, 1);
        planeModel.updateMatrixWorld(true);
    }

    if (propeller) {
        propeller.rotation.x = 0;
    }

    if (!USE_ORBIT_CONTROLS && camera) {
        idealCamPos.copy(cameraOffset);
        idealCamLookAt.copy(cameraLookAt);
        const referenceQuat = planeModel ? planeModel.quaternion : new THREE.Quaternion();
        const referencePos = planeModel ? planeModel.position : INITIAL_PLANE_POSITION;
        idealCamPos.applyQuaternion(referenceQuat);
        idealCamPos.add(referencePos);
        idealCamLookAt.applyQuaternion(referenceQuat);
        idealCamLookAt.add(referencePos);
        camera.position.copy(idealCamPos);
        camera.lookAt(idealCamLookAt);
    }

    keyStates = {};
}


function handleInputs(deltaTime) {
    const angVelChange = 2.0 * deltaTime; 
    const thrustChange = 1.0 * deltaTime;
    const brakeChange = 3.0 * deltaTime;

    
    if (keyStates['KeyW']) {
        planeState.angularVelocity.z -= angVelChange; 
    }
    if (keyStates['KeyS']) {
        planeState.angularVelocity.z += angVelChange; 
    }

    
    if (keyStates['KeyA']) {
        planeState.angularVelocity.x -= angVelChange; 
    }
    if (keyStates['KeyD']) {
        planeState.angularVelocity.x += angVelChange; 
    }

    
    if (keyStates['KeyQ']) {
        planeState.angularVelocity.y += angVelChange; 
    }
    if (keyStates['KeyE']) {
        planeState.angularVelocity.y -= angVelChange; 
    }

    
    if (keyStates['ShiftLeft'] || keyStates['ShiftRight']) {
        planeState.thrust += thrustChange;
    }
    if (keyStates['ControlLeft'] || keyStates['ControlRight']) {
        planeState.thrust -= thrustChange;
    }

    
    if (keyStates['Space']) {
        planeState.thrust -= brakeChange;
    }

    
    planeState.thrust = Math.max(0.0, Math.min(1.0, planeState.thrust));
}


function checkLandingState() {
    if (!terrainManager || !planeModel) { return false; }
    if (!landingSamplesConfigured) {
        landingCollisionGroundHeight = terrainManager.getHeightAt(planeModel.position.x, planeModel.position.z);
        return planeModel.position.y <= landingCollisionGroundHeight;
    }
    const planePosition = planeModel.position;
    const planeQuaternion = planeModel.quaternion;
    let contactHeight = terrainManager.getHeightAt(planePosition.x, planePosition.z);
    const hasRayTargets = terrainManager.raycastTargets.length > 0;

    for (let index = 0; index < LANDING_POINT_COUNT; index++) {
        const localOffset = landingSampleOffsets[index];
        const worldPoint = landingSampleWorld[index];

        worldPoint.copy(localOffset);
        worldPoint.applyQuaternion(planeQuaternion);
        worldPoint.add(planePosition);

        const groundHeight = terrainManager.getHeightAt(worldPoint.x, worldPoint.z);
        if (groundHeight > contactHeight) {
            contactHeight = groundHeight;
        }

        const belowGround = worldPoint.y <= groundHeight;

        if (!hasRayTargets) {
            if (belowGround) {
                landingCollisionGroundHeight = groundHeight;
                return true;
            }
            continue;
        }

        landingRaycaster.ray.origin.copy(worldPoint);
        landingRaycaster.ray.direction.copy(landingRayDirection);
        landingRaycaster.near = 0;
        const maxDistance = Math.max(worldPoint.y - groundHeight + 2, 0.75);
        landingRaycaster.far = maxDistance;

        landingRaycastHits.length = 0;
        landingRaycaster.intersectObjects(terrainManager.raycastTargets, false, landingRaycastHits);
        if (landingRaycastHits.length > 0) {
            const nearestHit = landingRaycastHits[0];
            if (nearestHit.distance <= 0.75) {
                landingCollisionGroundHeight = nearestHit.point.y;
                return true;
            }
        }
    }

    landingCollisionGroundHeight = contactHeight;
    return false;
}



function updatePhysics(deltaTime) {
    if (!planeModel || simulationStopped) { return; }

    
    handleInputs(deltaTime);

    
    const damping = Math.max(0, 1.0 - 3.0 * deltaTime);
    planeState.angularVelocity.multiplyScalar(damping);

    
    
    fwd.set(-1, 0, 0).applyQuaternion(planeModel.quaternion);
    acceleration.copy(fwd).multiplyScalar(planeState.thrust * 30.0);

    

    
    acceleration.y -= GRAVITY;

    
    
    
    const xzSpeed = Math.sqrt(
        planeState.velocity.x * planeState.velocity.x + 
        planeState.velocity.z * planeState.velocity.z
    );

    
    const liftAcceleration = xzSpeed *  0.003; 

    
    acceleration.y += liftAcceleration;

    


    
    
    planeState.velocity.add(acceleration.clone().multiplyScalar(deltaTime));
    
    
    
    
    const maxThrust = 10.0;
    const dragCoefficient = maxThrust / MAX_SPEED; 
    const dragDelta = planeState.velocity.clone().multiplyScalar(dragCoefficient * deltaTime);
    planeState.velocity.sub(dragDelta);

    
    if (planeState.velocity.lengthSq() > MAX_SPEED * MAX_SPEED) {
        planeState.velocity.normalize().multiplyScalar(MAX_SPEED);
    }

    
    planeModel.position.add(planeState.velocity.clone().multiplyScalar(deltaTime));

    
    planeModel.position.y = Math.min(planeModel.position.y, MAX_ALTITUDE);

    
    if (terrainManager && checkLandingState()) {
        planeModel.position.y = landingCollisionGroundHeight;
        planeState.velocity.set(0, 0, 0);
        planeState.angularVelocity.set(0, 0, 0);
        planeState.thrust = 0;
        simulationStopped = true;
        return;
    }

    
    const deltaRotation = new THREE.Vector3().copy(planeState.angularVelocity).multiplyScalar(deltaTime);
    quaternion.setFromEuler(new THREE.Euler(deltaRotation.x, deltaRotation.y, deltaRotation.z, 'YXZ'));
    planeModel.quaternion.multiplyQuaternions(planeModel.quaternion, quaternion);
    planeModel.quaternion.normalize();
}


function updateCamera(deltaTime) {
    if (USE_ORBIT_CONTROLS || !planeModel) return;

    
    idealCamPos.copy(cameraOffset);
    idealCamPos.applyQuaternion(planeModel.quaternion);
    idealCamPos.add(planeModel.position);

    
    idealCamLookAt.copy(cameraLookAt); 
    idealCamLookAt.applyQuaternion(planeModel.quaternion);
    idealCamLookAt.add(planeModel.position);

    
    const lerpFactor = Math.min(1.0, deltaTime * 5.0); 
    camera.position.lerp(idealCamPos, lerpFactor);
    
    
    camera.lookAt(idealCamLookAt);
}


function updateGUI() {
    
    const speedElement = document.getElementById('speed-value');
    const altitudeElement = document.getElementById('altitude-value');
    
    
    const xElement = document.getElementById('coord-x');
    const yElement = document.getElementById('coord-y');
    const zElement = document.getElementById('coord-z');

    
    if (!speedElement || !altitudeElement || !xElement || !yElement || !zElement) {
        return; 
    }

    const speed = planeState.velocity.length();
    

    
    const posX = planeModel ? planeModel.position.x : 0;
    const posY = planeModel ? planeModel.position.y : 0;
    const posZ = planeModel ? planeModel.position.z : 0;

    
    speedElement.innerText = speed.toFixed(1); 
    altitudeElement.innerText = posY.toFixed(1); 

    
    xElement.innerText = posX.toFixed(1);
    yElement.innerText = posY.toFixed(1);
    zElement.innerText = posZ.toFixed(1);
}


function updateDayNightCycle(deltaTime) {
    const elapsedTime = clock.getElapsedTime(); 
    
    const baseCycleTime = (elapsedTime % 60) / 60; 
    const cycleTime = sliderTime ?? baseCycleTime;
    
    const phi = cycleTime * 2 * Math.PI - Math.PI / 2;
    sunPosition.set(0, Math.sin(phi), Math.cos(phi)); 

    
    sky.material.uniforms['sunPosition'].value.copy(sunPosition);

    
    const targetPosition = planeModel ? planeModel.position : scene.position;

    sunLight.target.position.copy(targetPosition);
    sunLight.target.updateMatrixWorld();
    
    
    sunLight.position.copy(targetPosition).add(sunPosition.clone().multiplyScalar(1000));

    const intensityFactor = Math.max(0, sunPosition.y); 
    sunLight.intensity = intensityFactor * 1.5; 

    
    ambientLight.intensity = 0.1 + intensityFactor * 0.4; 

    
    scene.fog.color.lerpColors(nightFog, dayFog, intensityFactor);

    
    renderer.toneMappingExposure = 0.3 + intensityFactor * 0.7;

    
    if (DEBUG && shadowCamHelper) {
        shadowCamHelper.update();
    }

    
    if (leftHeadlight && rightHeadlight) {
        
        
        const isNight = intensityFactor < 0.25; 
        
        
        
        const targetIntensity = isNight ? 80000.0 : 0.0; 

        
        
        const lerpFactor = Math.min(1.0, deltaTime * 1.5); 
        leftHeadlight.intensity = THREE.MathUtils.lerp(leftHeadlight.intensity, targetIntensity, lerpFactor);
        rightHeadlight.intensity = THREE.MathUtils.lerp(rightHeadlight.intensity, targetIntensity, lerpFactor);
        
        if (leftConeMesh && rightConeMesh) {
            
            const targetOpacity = isNight ? 0.15 : 0.0;
            
            
            leftConeMesh.material.opacity = THREE.MathUtils.lerp(leftConeMesh.material.opacity, targetOpacity, lerpFactor);
            rightConeMesh.material.opacity = THREE.MathUtils.lerp(rightConeMesh.material.opacity, targetOpacity, lerpFactor);
        }
    }


}


function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}


function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    
    if (!simulationStopped && propeller) {
        const spinSpeed = 5.0 + planeState.thrust * 30.0; 
        propeller.rotation.x += deltaTime * spinSpeed; 
    }

    
    updateDayNightCycle(deltaTime);
    
    
    if (!USE_ORBIT_CONTROLS && !simulationStopped) {
        updatePhysics(deltaTime); 
    }

    
    if (terrainManager) {
        const focusObject = planeModel ?? camera;
        terrainManager.update(focusObject.position);
    }
    
    
    if (USE_ORBIT_CONTROLS) {
        controls.update();
    } else {
        if (!simulationStopped) {
            updateCamera(deltaTime);
        }
    }

    
    updateGUI();

    
    renderer.render(scene, camera);
}


window.addEventListener('DOMContentLoaded', init);
