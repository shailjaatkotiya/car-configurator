import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import modelUrl from '../2022_toyota_vellfire.glb?url';

const COLORS = [
  { name: 'Red', value: '#e94560' },
  { name: 'Blue', value: '#0f3460' },
  { name: 'Dark Blue', value: '#16213e' },
  { name: 'White', value: '#f5f5f5' },
  { name: 'Black', value: '#2d2d2d' },
  { name: 'Gold', value: '#e9b44c' },
  { name: 'Green', value: '#4ecca3' },
];

const VIEWS = {
  front: { pos: [0, 1.0, -4.4], target: [0, 0.6, 0] },
  side: { pos: [4.6, 1.1, 0], target: [0, 0.6, 0] },
  rear: { pos: [0, 1.2, 4.4], target: [0, 0.7, 0] },
  dashboard: { pos: [0.25, 0.95, 0.4], target: [0, 0.7, -1.1] },
  wheel: { pos: [2.0, 0.5, -1.7], target: [0.55, 0.35, -1.25] },
  top: { pos: [0, 5.5, 0.01], target: [0, 0, 0] },
};

const MOVE_STEP = 0.3;
const CLICK_MOVE_THRESHOLD = 6;
const CLICK_TIME_THRESHOLD = 350;
const EXPLODE_SCALE = 0.02;
const ZERO_EXPLODE = { radial: 0, x: 0, y: 0, z: 0 };
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const getDefaultCameraPosition = () => (window.innerWidth <= 720 ? [4.8, 2.4, 8.5] : [4, 2, 5]);
const getDefaultCameraTarget = () => (window.innerWidth <= 720 ? [0, -0.35, 0] : [0, 0.5, 0]);

const TRANSFORM_MODES = [
  { mode: 'translate', title: 'Move', desc: 'Move objects in 3D space' },
  { mode: 'rotate', title: 'Rotate', desc: 'Rotate objects around their center' },
  { mode: 'scale', title: 'Scale', desc: 'Scale objects uniformly or non-uniformly' },
];

const EXPLODE_SLIDERS = [
  { key: 'radial', label: 'Explode Radially' },
  { key: 'x', label: 'Explode on X axis' },
  { key: 'y', label: 'Explode on Y axis' },
  { key: 'z', label: 'Explode on Z axis' },
];

const SIDEBAR_BUTTONS = [
  { key: 'tree', icon: '🌲', label: 'Model Tree' },
  { key: 'transform', icon: '✥', label: 'Transform' },
  { key: 'colors', icon: '🎨', label: 'Colors' },
  { key: 'explode', icon: '💥', label: 'Explode' },
  { key: 'views', icon: '🎥', label: 'Views' },
];

function App() {
  const canvasRef = useRef(null);
  const sceneRef = useRef({
    bodyMaterials: [],
    allMaterials: [],
    carModel: null,
    camera: null,
    controls: null,
    transformControls: null,
    grid: null,
    nodeMap: new Map(),
    origTransforms: new Map(),
    highlighted: [],
    selected: null,
    initial: {
      pos: new THREE.Vector3(),
      scale: 1,
      rotY: 0,
    },
    tween: null,
  });

  const [activeColor, setActiveColor] = useState(COLORS[0].value);
  const [colorMode, setColorMode] = useState('default');
  const [materialFinish, setMaterialFinish] = useState('original');
  const [transparency, setTransparency] = useState(100);
  const [loadingText, setLoadingText] = useState('Loading 3D Model...');
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [gridVisible, setGridVisible] = useState(false);
  const [activeView, setActiveView] = useState('');
  const [modelTree, setModelTree] = useState(null);
  const [selectedUuid, setSelectedUuid] = useState(null);
  const [gizmoMode, setGizmoMode] = useState('translate');
  const [explode, setExplode] = useState(ZERO_EXPLODE);
  const [hiddenUuids, setHiddenUuids] = useState(() => new Set());
  const [panels, setPanels] = useState(() => ({
    tree: window.innerWidth > 720,
    transform: false,
    colors: false,
    explode: false,
    views: false,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const sceneState = sceneRef.current;
    let disposed = false;
    sceneState.bodyMaterials = [];
    sceneState.allMaterials = [];
    sceneState.carModel = null;
    sceneState.tween = null;
    sceneState.nodeMap = new Map();
    sceneState.origTransforms = new Map();
    sceneState.highlighted = [];
    sceneState.selected = null;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(...getDefaultCameraPosition());
    sceneState.camera = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 2;
    controls.maxDistance = 15;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.target.set(...getDefaultCameraTarget());
    sceneState.controls = controls;

    const transformControls = new TransformControls(camera, canvas);
    transformControls.setMode('translate');
    transformControls.setSize(0.85);
    transformControls.addEventListener('dragging-changed', (event) => {
      controls.enabled = !event.value;
    });
    scene.add(transformControls.getHelper());
    sceneState.transformControls = transformControls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 8, 5);
    scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight2.position.set(-5, 3, -5);
    scene.add(dirLight2);

    const rimLight = new THREE.DirectionalLight(0x4466ff, 0.3);
    rimLight.position.set(0, 2, -8);
    scene.add(rimLight);

    const grid = new THREE.GridHelper(24, 48, 0x6a6a9a, 0x33334f);
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    grid.visible = false;
    scene.add(grid);
    sceneState.grid = grid;

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/libs/draco/');

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      modelUrl,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }

        const carModel = gltf.scene;

        const box = new THREE.Box3().setFromObject(carModel);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 3 / maxDim;

        carModel.scale.setScalar(scale);
        carModel.position.sub(center.multiplyScalar(scale));
        carModel.position.y = -box.min.y * scale;

        const bodyRe = /primary|_body|_door|_boot|_roof|_mb\d|fender|bumper|hood/i;
        const excludeRe = /wheel|glass|steer|seat|light|indicator|fog|tv_display|tire/i;

        carModel.traverse((child) => {
          if (!child.isMesh) return;

          child.castShadow = true;
          child.receiveShadow = true;

          const mat = child.material;
          if (!mat?.isMeshStandardMaterial) return;
          if (mat.transparent && mat.opacity < 0.9) return;

          const name = mat.name || child.name;
          if (excludeRe.test(name) || !bodyRe.test(name)) return;

          const newMat = mat.clone();
          child.material = newMat;
          sceneState.bodyMaterials.push({
            mat: newMat,
            origColor: newMat.color.clone(),
            origMetalness: newMat.metalness,
            origRoughness: newMat.roughness,
          });
        });

        const seenMats = new Set();
        carModel.traverse((child) => {
          if (!child.isMesh) return;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat) => {
            if (!mat || seenMats.has(mat.uuid)) return;
            seenMats.add(mat.uuid);
            sceneState.allMaterials.push({
              mat,
              origOpacity: mat.opacity,
              origTransparent: mat.transparent,
            });
          });
        });

        scene.add(carModel);
        carModel.updateMatrixWorld(true);

        const modelBox = new THREE.Box3().setFromObject(carModel);
        const modelCenter = modelBox.getCenter(new THREE.Vector3());

        carModel.traverse((child) => {
          sceneState.origTransforms.set(child.uuid, {
            pos: child.position.clone(),
            quat: child.quaternion.clone(),
            scale: child.scale.clone(),
          });

          if (!child.isMesh) return;
          const meshBox = new THREE.Box3().setFromObject(child);
          if (meshBox.isEmpty()) return;

          const dirWorld = meshBox.getCenter(new THREE.Vector3()).sub(modelCenter);
          const parentQuat = child.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
          const parentScale = child.parent.getWorldScale(new THREE.Vector3());
          const dir = dirWorld.applyQuaternion(parentQuat);
          dir.set(
            parentScale.x ? dir.x / parentScale.x : 0,
            parentScale.y ? dir.y / parentScale.y : 0,
            parentScale.z ? dir.z / parentScale.z : 0,
          );
          child.userData.explode = { orig: child.position.clone(), dir };
        });

        sceneState.carModel = carModel;
        sceneState.initial.pos.copy(carModel.position);
        sceneState.initial.scale = carModel.scale.x;
        sceneState.initial.rotY = carModel.rotation.y;

        const nodeMap = new Map();
        const tree = buildTreeNode(carModel, nodeMap, 'Whole Vehicle');
        sceneState.nodeMap = nodeMap;
        setModelTree(tree);

        setIsLoaded(true);
      },
      (progress) => {
        if (!progress.total) return;
        const pct = Math.round((progress.loaded / progress.total) * 100);
        setLoadingText(`Loading... ${pct}%`);
      },
      (error) => {
        console.error('Model load error:', error);
        setHasLoadError(true);
        setLoadingText('Failed to load model. Check console for details.');
      },
    );

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = null;
    let pointerDownTime = 0;

    const handlePointerDown = (event) => {
      pointerDownPos = { x: event.clientX, y: event.clientY };
      pointerDownTime = performance.now();
    };

    const handlePointerUp = (event) => {
      if (!pointerDownPos) return;
      const dx = event.clientX - pointerDownPos.x;
      const dy = event.clientY - pointerDownPos.y;
      const moved = Math.sqrt(dx * dx + dy * dy);
      const elapsed = performance.now() - pointerDownTime;
      pointerDownPos = null;
      if (moved > CLICK_MOVE_THRESHOLD || elapsed > CLICK_TIME_THRESHOLD) return;
      if (transformControls.dragging || transformControls.axis) return;
      if (!sceneState.carModel) return;

      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(sceneState.carModel, true);

      const visibleHit = hits.find((hit) => isChainVisible(hit.object));
      if (visibleHit) {
        selectByObject(visibleHit.object, sceneState, setSelectedUuid);
      } else {
        clearSelection(sceneState, setSelectedUuid);
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);

    const clock = new THREE.Clock();
    let animationFrame = 0;

    const animate = () => {
      animationFrame = window.requestAnimationFrame(animate);
      const dt = clock.getDelta();

      if (sceneState.tween) {
        sceneState.tween.t = Math.min(1, sceneState.tween.t + dt / sceneState.tween.dur);
        const k = easeInOutQuad(sceneState.tween.t);
        camera.position.lerpVectors(sceneState.tween.fromPos, sceneState.tween.toPos, k);
        controls.target.lerpVectors(sceneState.tween.fromTarget, sceneState.tween.toTarget, k);
        if (sceneState.tween.t >= 1) sceneState.tween = null;
      }

      controls.update();
      if (sceneState.carModel && sceneState.autoRotate) {
        sceneState.carModel.rotation.y += 0.004;
      }
      renderer.render(scene, camera);
    };

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    sceneState.autoRotate = false;
    window.addEventListener('resize', handleResize);
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      controls.dispose();
      transformControls.dispose();
      dracoLoader.dispose();
      renderer.dispose();
      disposeObject(scene);
    };
  }, []);

  useEffect(() => {
    sceneRef.current.bodyMaterials.forEach(({ mat, origColor, origMetalness, origRoughness }) => {
      if (colorMode === 'custom') {
        mat.color.set(activeColor);
      } else {
        mat.color.copy(origColor);
      }

      if (materialFinish === 'glossy') {
        mat.metalness = 0.85;
        mat.roughness = 0.15;
      } else if (materialFinish === 'matte') {
        mat.metalness = 0.1;
        mat.roughness = 0.8;
      } else {
        mat.metalness = origMetalness;
        mat.roughness = origRoughness;
      }
    });
  }, [activeColor, colorMode, materialFinish, isLoaded]);

  useEffect(() => {
    sceneRef.current.allMaterials.forEach(({ mat, origOpacity, origTransparent }) => {
      const wantTransparent = transparency < 100 ? true : origTransparent;
      if (mat.transparent !== wantTransparent) {
        mat.transparent = wantTransparent;
        mat.needsUpdate = true;
      }
      mat.opacity = transparency < 100 ? origOpacity * (transparency / 100) : origOpacity;
    });
  }, [transparency, isLoaded]);

  useEffect(() => {
    sceneRef.current.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    if (sceneRef.current.grid) sceneRef.current.grid.visible = gridVisible;
  }, [gridVisible]);

  useEffect(() => {
    sceneRef.current.transformControls?.setMode(gizmoMode);
  }, [gizmoMode]);

  useEffect(() => {
    const { carModel } = sceneRef.current;
    if (!carModel) return;

    carModel.traverse((child) => {
      const data = child.userData.explode;
      if (!data) return;
      child.position
        .copy(data.orig)
        .addScaledVector(data.dir, explode.radial * EXPLODE_SCALE)
        .add(new THREE.Vector3(
          data.dir.x * explode.x * EXPLODE_SCALE,
          data.dir.y * explode.y * EXPLODE_SCALE,
          data.dir.z * explode.z * EXPLODE_SCALE,
        ));
    });
  }, [explode, isLoaded]);

  const togglePanel = (key) => {
    setPanels((current) => ({ ...current, [key]: !current[key] }));
  };

  const closePanel = (key) => {
    setPanels((current) => ({ ...current, [key]: false }));
  };

  const setExplodeValue = (key, rawValue) => {
    const value = THREE.MathUtils.clamp(Number(rawValue) || 0, 0, 100);
    setExplode((current) => ({ ...current, [key]: value }));
  };

  const selectWholeCar = () => {
    const { carModel } = sceneRef.current;
    if (!carModel) return;
    selectByObject(carModel, sceneRef.current, setSelectedUuid);
  };

  const selectByUuid = (uuid) => {
    if (uuid === selectedUuid) {
      clearSelection(sceneRef.current, setSelectedUuid);
      return;
    }
    const object = sceneRef.current.nodeMap.get(uuid);
    if (!object) return;
    selectByObject(object, sceneRef.current, setSelectedUuid);
  };

  const toggleVisibility = (uuid) => {
    const object = sceneRef.current.nodeMap.get(uuid);
    if (!object) return;

    object.visible = !object.visible;
    if (!object.visible && uuid === selectedUuid) {
      clearSelection(sceneRef.current, setSelectedUuid);
    }
    setHiddenUuids((current) => {
      const next = new Set(current);
      if (object.visible) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  };

  const deselect = () => {
    clearSelection(sceneRef.current, setSelectedUuid);
  };

  const resetTransforms = () => {
    const { carModel, origTransforms } = sceneRef.current;
    if (!carModel) return;

    carModel.traverse((object) => {
      const orig = origTransforms.get(object.uuid);
      if (!orig) return;
      object.position.copy(orig.pos);
      object.quaternion.copy(orig.quat);
      object.scale.copy(orig.scale);
    });
    setExplode(ZERO_EXPLODE);
  };

  const moveCar = (direction) => {
    const { carModel, selected } = sceneRef.current;
    const target = selected || carModel;
    if (!target) return;

    switch (direction) {
      case 'up':
        target.position.y += MOVE_STEP;
        break;
      case 'down':
        target.position.y -= MOVE_STEP;
        break;
      case 'left':
        target.position.x -= MOVE_STEP;
        break;
      case 'right':
        target.position.x += MOVE_STEP;
        break;
      default:
        break;
    }
  };

  const rotateCar = (direction) => {
    const { carModel, selected } = sceneRef.current;
    const target = selected || carModel;
    if (!target) return;
    target.rotation.y += direction * (Math.PI / 12);
  };

  const scaleCar = (factor) => {
    const { carModel, selected, initial } = sceneRef.current;
    const target = selected || carModel;
    if (!target) return;
    const baseScale = target === carModel ? initial.scale : target.scale.x || 1;
    const next = THREE.MathUtils.clamp(target.scale.x * factor, baseScale * 0.3, baseScale * 3);
    target.scale.setScalar(next);
  };

  const resetView = () => {
    const { carModel, camera, controls, initial } = sceneRef.current;
    if (!carModel || !camera || !controls) return;

    carModel.position.copy(initial.pos);
    carModel.scale.setScalar(initial.scale);
    carModel.rotation.y = initial.rotY;
    camera.position.set(...getDefaultCameraPosition());
    controls.target.set(...getDefaultCameraTarget());
    sceneRef.current.tween = null;
    setActiveView('');
    deselect();
  };

  const goToView = (name) => {
    const view = VIEWS[name];
    const { carModel, camera, controls, initial } = sceneRef.current;
    if (!view || !carModel || !camera || !controls) return;

    setAutoRotate(false);
    setActiveView(name);
    carModel.rotation.y = initial.rotY;
    sceneRef.current.tween = {
      fromPos: camera.position.clone(),
      toPos: new THREE.Vector3(...view.pos),
      fromTarget: controls.target.clone(),
      toTarget: new THREE.Vector3(...view.target),
      t: 0,
      dur: 0.9,
    };
  };

  const selectedLabel = sceneRef.current.nodeMap.get(selectedUuid)?.userData?.treeLabel;

  return (
    <>
      <div className={`loading ${isLoaded ? 'hidden' : ''} ${hasLoadError ? 'error' : ''}`}>
        <div className="spinner" />
        <p>{loadingText}</p>
      </div>

      <header className="info">
        <h1>3D CAR CONFIGURATOR</h1>
        <p>Drag to rotate &bull; Scroll to zoom &bull; Click a part to select it</p>
      </header>

      <nav className="sidebar" aria-label="Tool panels">
        {SIDEBAR_BUTTONS.map(({ key, icon, label }) => (
          <button
            className={`side-btn ${panels[key] ? 'active' : ''}`}
            key={key}
            onClick={() => togglePanel(key)}
            type="button"
          >
            <span className="side-icon">{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      <div className="right-stack">
        {panels.tree && (
          <section className="settings-card" aria-label="Model tree">
            <div className="settings-head">
              <span>Model Tree</span>
              <button className="close-btn light" onClick={() => closePanel('tree')} type="button">✕</button>
            </div>
            <div className="settings-body tree-panel-body">
              {selectedUuid && (
                <button className="ctl-btn wide" onClick={deselect} type="button">
                  Deselect: {selectedLabel || 'current object'}
                </button>
              )}
              {modelTree ? (
                <TreeNode
                  node={modelTree}
                  depth={0}
                  selectedUuid={selectedUuid}
                  onSelect={selectByUuid}
                  hiddenUuids={hiddenUuids}
                  onToggleVisible={toggleVisibility}
                  defaultOpen
                />
              ) : (
                <p className="tree-empty">Loading hierarchy...</p>
              )}
            </div>
          </section>
        )}

        {panels.transform && (
          <section className="settings-card" aria-label="Transform controls">
            <div className="settings-head">
              <span>Transform Controls</span>
              <button className="close-btn light" onClick={() => closePanel('transform')} type="button">✕</button>
            </div>
            <div className="settings-body">
              <span className="section-label">Selection</span>
              <span className="selection-label">
                {selectedUuid ? (selectedLabel || 'Part selected') : 'Whole Vehicle (default)'}
              </span>
              <div className="btn-row">
                <button className="ctl-btn wide" onClick={selectWholeCar} type="button">Select Whole Car</button>
                {selectedUuid && (
                  <button className="ctl-btn wide" onClick={deselect} type="button">Deselect / Hide Gizmo</button>
                )}
              </div>

              <span className="section-label">Transform Mode</span>
              {TRANSFORM_MODES.map(({ mode, title, desc }) => (
                <button
                  className={`mode-row ${gizmoMode === mode ? 'active' : ''}`}
                  key={mode}
                  onClick={() => setGizmoMode(mode)}
                  type="button"
                >
                  <span className="mode-title">{title}</span>
                  <span className="mode-desc">{desc}</span>
                </button>
              ))}

              <span className="section-label">Nudge</span>
              <div className="btn-row">
                <button className="ctl-btn" onClick={() => moveCar('up')} type="button">↑</button>
                <button className="ctl-btn" onClick={() => moveCar('down')} type="button">↓</button>
                <button className="ctl-btn" onClick={() => moveCar('left')} type="button">←</button>
                <button className="ctl-btn" onClick={() => moveCar('right')} type="button">→</button>
              </div>
              <div className="btn-row">
                <button className="ctl-btn" onClick={() => rotateCar(-1)} type="button">↺ Left</button>
                <button className="ctl-btn" onClick={() => rotateCar(1)} type="button">Right ↻</button>
              </div>
              <div className="btn-row">
                <button className="ctl-btn" onClick={() => scaleCar(1.1)} type="button">+ Bigger</button>
                <button className="ctl-btn" onClick={() => scaleCar(0.9)} type="button">- Smaller</button>
              </div>

              <button className="ctl-btn wide" onClick={resetTransforms} type="button">
                ⟳ Reset Transform
              </button>
              <p className="hint-text">
                Resets all transformed objects to their original position, rotation, and scale
              </p>

              <div className="instructions">
                <strong>Instructions:</strong> Select an object first (click it in the viewport or in
                the Model Tree), then choose a transform mode and drag the gizmo to start transforming.
              </div>
            </div>
          </section>
        )}

        {panels.colors && (
          <section className="settings-card" aria-label="Color settings">
            <div className="settings-head">
              <span>Color Settings</span>
              <button className="close-btn light" onClick={() => closePanel('colors')} type="button">✕</button>
            </div>
            <div className="settings-body">
              <div className="select-row">
                <label htmlFor="color-mode">Color Mode</label>
                <select
                  id="color-mode"
                  onChange={(event) => setColorMode(event.target.value)}
                  value={colorMode}
                >
                  <option value="default">Default</option>
                  <option value="custom">Custom Paint</option>
                </select>
              </div>

              <div className="select-row">
                <label htmlFor="material-finish">Material</label>
                <select
                  id="material-finish"
                  onChange={(event) => setMaterialFinish(event.target.value)}
                  value={materialFinish}
                >
                  <option value="original">Original Material</option>
                  <option value="glossy">Glossy</option>
                  <option value="matte">Matte</option>
                </select>
              </div>

              <span className="section-label">Paint Color</span>
              <div className="swatch-row" aria-label="Car paint color">
                {COLORS.map((color) => (
                  <button
                    aria-label={color.name}
                    className={`color-btn ${colorMode === 'custom' && activeColor === color.value ? 'active' : ''}`}
                    key={color.value}
                    onClick={() => {
                      setActiveColor(color.value);
                      setColorMode('custom');
                    }}
                    style={{ background: color.value }}
                    title={color.name}
                    type="button"
                  />
                ))}
              </div>

              <div className="slider-row">
                <label htmlFor="material-transparency">Material Transparency</label>
                <div className="slider-line">
                  <input
                    id="material-transparency"
                    max="100"
                    min="0"
                    onChange={(event) => setTransparency(THREE.MathUtils.clamp(Number(event.target.value) || 0, 0, 100))}
                    type="range"
                    value={transparency}
                  />
                  <input
                    aria-label="Material transparency value"
                    className="num-input"
                    max="100"
                    min="0"
                    onChange={(event) => setTransparency(THREE.MathUtils.clamp(Number(event.target.value) || 0, 0, 100))}
                    type="number"
                    value={transparency}
                  />
                </div>
                <p className="hint-text">100 = fully opaque, 0 = invisible. Applies to all materials.</p>
              </div>
            </div>
          </section>
        )}

        {panels.explode && (
          <section className="settings-card" aria-label="Explosion settings">
            <div className="settings-head">
              <span>Explosion Settings</span>
              <button className="close-btn light" onClick={() => closePanel('explode')} type="button">✕</button>
            </div>
            <div className="settings-body">
              <span className="section-label">Explosion Extent</span>
              {EXPLODE_SLIDERS.map(({ key, label }) => (
                <div className="slider-row" key={key}>
                  <label htmlFor={`explode-${key}`}>{label}</label>
                  <div className="slider-line">
                    <input
                      id={`explode-${key}`}
                      max="100"
                      min="0"
                      onChange={(event) => setExplodeValue(key, event.target.value)}
                      type="range"
                      value={explode[key]}
                    />
                    <input
                      aria-label={`${label} value`}
                      className="num-input"
                      max="100"
                      min="0"
                      onChange={(event) => setExplodeValue(key, event.target.value)}
                      type="number"
                      value={explode[key]}
                    />
                  </div>
                </div>
              ))}
              <button className="ctl-btn wide" onClick={() => setExplode(ZERO_EXPLODE)} type="button">
                Reset
              </button>
            </div>
          </section>
        )}

        {panels.views && (
          <section className="settings-card" aria-label="View settings">
            <div className="settings-head">
              <span>View Settings</span>
              <button className="close-btn light" onClick={() => closePanel('views')} type="button">✕</button>
            </div>
            <div className="settings-body">
              <span className="section-label">Scene</span>
              <div className="btn-row">
                <button
                  className={`ctl-btn ${gridVisible ? 'on' : ''}`}
                  onClick={() => setGridVisible((current) => !current)}
                  type="button"
                >
                  {gridVisible ? 'Grid: On' : 'Grid: Off'}
                </button>
                <button
                  className={`ctl-btn ${autoRotate ? 'on' : ''}`}
                  onClick={() => setAutoRotate((current) => !current)}
                  type="button"
                >
                  {autoRotate ? 'Spin: On' : 'Spin: Off'}
                </button>
              </div>

              <span className="section-label">Camera Views</span>
              <div className="btn-row">
                {Object.keys(VIEWS).map((viewName) => (
                  <button
                    className={`ctl-btn view-btn ${activeView === viewName ? 'active' : ''}`}
                    key={viewName}
                    onClick={() => goToView(viewName)}
                    type="button"
                  >
                    {viewName}
                  </button>
                ))}
              </div>

              <button className="ctl-btn wide" onClick={resetView} type="button">↻ Reset View</button>
            </div>
          </section>
        )}
      </div>

      <canvas ref={canvasRef} />
    </>
  );
}

function TreeNode({ node, depth, selectedUuid, onSelect, hiddenUuids, onToggleVisible, defaultOpen }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const hasChildren = node.children.length > 0;
  const isSelected = node.uuid === selectedUuid;
  const isHidden = hiddenUuids.has(node.uuid);

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${isSelected ? 'selected' : ''} ${isHidden ? 'hidden-node' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        onClick={() => onSelect(node.uuid)}
        title={isSelected ? 'Click again to deselect' : 'Click to select'}
      >
        {hasChildren ? (
          <span
            className="tree-caret"
            onClick={(event) => {
              event.stopPropagation();
              setOpen((current) => !current);
            }}
          >
            {open ? '▾' : '▸'}
          </span>
        ) : (
          <span className="tree-caret tree-caret-leaf">•</span>
        )}
        <span className="tree-name">{node.label}</span>
        <button
          aria-label={isHidden ? `Show ${node.label}` : `Hide ${node.label}`}
          className={`tree-eye ${isHidden ? 'off' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleVisible(node.uuid);
          }}
          title={isHidden ? 'Show' : 'Hide'}
          type="button"
        >
          {isHidden ? '🚫' : '👁'}
        </button>
      </div>
      {hasChildren && open && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.uuid}
              node={child}
              depth={depth + 1}
              selectedUuid={selectedUuid}
              onSelect={onSelect}
              hiddenUuids={hiddenUuids}
              onToggleVisible={onToggleVisible}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function buildTreeNode(object, nodeMap, overrideLabel) {
  const label = overrideLabel || object.name || (object.isMesh ? 'Mesh' : 'Group');
  object.userData.treeLabel = label;
  nodeMap.set(object.uuid, object);

  const children = object.children
    .filter((child) => child.isMesh || child.isGroup || child.isObject3D)
    .filter((child) => !child.isLight && !child.isCamera)
    .map((child) => buildTreeNode(child, nodeMap));

  return {
    uuid: object.uuid,
    label,
    children,
  };
}

function isChainVisible(object) {
  let current = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function collectMeshes(object) {
  const meshes = [];
  object.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  return meshes;
}

function selectByObject(object, sceneState, setSelectedUuid) {
  clearHighlight(sceneState);

  sceneState.selected = object;
  sceneState.transformControls.attach(object);
  setSelectedUuid(object.uuid);

  const meshes = collectMeshes(object);
  const seenMats = new Set();
  meshes.forEach((mesh) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      // Dedupe shared materials: a second entry would snapshot the
      // already-highlighted emissive and restore the wrong value on deselect.
      if (!mat || seenMats.has(mat.uuid)) return;
      seenMats.add(mat.uuid);
      sceneState.highlighted.push({
        mat,
        emissive: mat.emissive ? mat.emissive.clone() : null,
        emissiveIntensity: mat.emissiveIntensity,
      });
      if (mat.emissive) {
        mat.emissive.set(0xffaa00);
        mat.emissiveIntensity = 0.6;
      }
    });
  });
}

function clearHighlight(sceneState) {
  sceneState.highlighted.forEach(({ mat, emissive, emissiveIntensity }) => {
    if (mat.emissive && emissive) mat.emissive.copy(emissive);
    if (emissiveIntensity !== undefined) mat.emissiveIntensity = emissiveIntensity;
  });
  sceneState.highlighted = [];
}

function clearSelection(sceneState, setSelectedUuid) {
  clearHighlight(sceneState);
  sceneState.selected = null;
  sceneState.transformControls.detach();
  setSelectedUuid(null);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach(disposeMaterial);
    } else {
      disposeMaterial(child.material);
    }
  });
}

function disposeMaterial(material) {
  if (!material) return;
  Object.values(material).forEach((value) => {
    if (value?.isTexture) value.dispose();
  });
  material.dispose();
}

export default App;
