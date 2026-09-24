import * as THREE from 'three';
import gsap from 'gsap';

/**
 * Cinematic "car reveal" that plays when the model finishes loading.
 * A GSAP timeline sequences the shots, cuts and lighting; for each shot the
 * three.js camera position / look-at target / FOV are computed from the car's
 * own world position and bounding box, so the shots frame the car wherever it
 * sits and whatever its size.
 *
 * Timeline (mirrors the reference edit, ~29.6 s):
 *   0.0 – 9.8   back-lit silhouette → studio lights fade up, slow orbit
 *               from front-left 3/4 across the nose to front-right 3/4
 *   9.8 – 14.3  grille close-ups (angled track, then straight-on badge push-in)
 *  14.3 – 17.0  headlamp + fender detail
 *  17.0 – 19.2  wide front 3/4
 *  19.2 – 24.0  front-wheel close-up tracking back along the flank to the door
 *  24.0 – 26.6  side profile
 *  26.6 – end   hero front 3/4 → hands over to OrbitControls
 */
export const INTRO_DURATION = 29.6;
export const INTRO_FINAL_FOV = 45;

const CUT_FADE = 0.14; // dip-to-black either side of each hard cut
const HANDOFF_TIME = 0.6; // seconds to blend lights/fov back after a skip

const { lerp, degToRad } = THREE.MathUtils;
// Camera moves are slow, steady dollies with soft ends (like the reference)
const SHOT_EASE = 'power1.inOut';
// az 0 = straight at the nose, positive toward the car's right-hand side
const polar = (azDeg, dist, y) => [Math.cos(degToRad(azDeg)) * dist, Math.sin(degToRad(azDeg)) * dist, y];

// cam / look return [forward, side, up] offsets from the car's ground centre,
// in units of L (half length), W (half width) and H (height).
const SHOTS = [
  {
    name: 'reveal-orbit', start: 0, end: 9.8, fov: [34, 34],
    cam: (u, d) => polar(lerp(-38, 32, u), lerp(2.6, 2.3, u) * d.L, lerp(0.5, 0.42, u) * d.H),
    look: (u, d) => [0.08 * d.L, 0, 0.45 * d.H],
  },
  {
    name: 'grille-angle', start: 9.8, end: 12.2, fov: [28, 28],
    cam: (u, d) => [d.L + 1.0 * d.W, lerp(-0.45, -0.1, u) * d.W, 0.47 * d.H],
    look: (u, d) => [d.L, lerp(-0.2, 0.05, u) * d.W, 0.42 * d.H],
  },
  {
    name: 'grille-badge', start: 12.2, end: 14.3, fov: [28, 26],
    cam: (u, d) => [d.L + lerp(0.9, 0.72, u) * d.W, 0, 0.52 * d.H],
    look: (u, d) => [d.L, 0, 0.46 * d.H],
  },
  {
    name: 'headlamp-fender', start: 14.3, end: 17.0, fov: [30, 30],
    cam: (u, d) => [d.L + lerp(0.55, 0.35, u) * d.W, lerp(1.45, 1.7, u) * d.W, 0.66 * d.H],
    look: (u, d) => [lerp(0.8, 0.6, u) * d.L, 0.75 * d.W, 0.5 * d.H],
  },
  {
    name: 'wide-front', start: 17.0, end: 19.2, fov: [34, 34],
    cam: (u, d) => polar(lerp(40, 34, u), lerp(2.35, 2.2, u) * d.L, 0.46 * d.H),
    look: (u, d) => [0.05 * d.L, 0, 0.42 * d.H],
  },
  {
    name: 'front-wheel', start: 19.2, end: 21.8, fov: [30, 30],
    cam: (u, d) => [lerp(0.9, 0.6, u) * d.L, 2.6 * d.W, 0.24 * d.H],
    look: (u, d) => [lerp(0.72, 0.56, u) * d.L, d.W, 0.2 * d.H],
  },
  {
    name: 'wheel-to-door', start: 21.8, end: 24.0, fov: [30, 30],
    cam: (u, d) => [lerp(0.5, 0.2, u) * d.L, 2.9 * d.W, 0.3 * d.H],
    look: (u, d) => [lerp(0.6, 0.3, u) * d.L, d.W, 0.26 * d.H],
  },
  {
    name: 'side-profile', start: 24.0, end: 26.6, fov: [34, 34],
    cam: (u, d) => [lerp(0.08, -0.04, u) * d.L, lerp(2.7, 2.55, u) * d.L, 0.45 * d.H],
    look: (u, d) => [lerp(0.03, -0.03, u) * d.L, 0, 0.4 * d.H],
  },
  {
    name: 'hero', start: 26.6, end: INTRO_DURATION, fov: [42, INTRO_FINAL_FOV],
    cam: (u, d) => polar(lerp(-36, -30, u), lerp(2.25, 2.05, u) * d.L, lerp(0.5, 0.46, u) * d.H),
    look: (u, d) => [0.04 * d.L, 0, 0.4 * d.H],
  },
];

export class CinematicIntro {
  /**
   * @param {object} opts
   * @param {THREE.PerspectiveCamera} opts.camera
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Object3D} opts.model      the car
   * @param {THREE.Light[]} opts.lights      studio lights to fade up from 0
   * @param {THREE.Vector3} [opts.front]     unit vector the car's nose points to
   * @param {{fade?:HTMLElement, progress?:HTMLElement}} [opts.overlay]
   * @param {(reason:'complete'|'skipped', look:THREE.Vector3)=>void} [opts.onFinish]
   */
  constructor({ camera, scene, model, lights = [], front = new THREE.Vector3(0, 0, -1), overlay = {}, onFinish }) {
    this.camera = camera;
    this.scene = scene;
    this.overlay = overlay;
    this.onFinish = onFinish;
    this.phase = 'playing'; // playing → (handoff) → done
    this.look = new THREE.Vector3();

    // --- Car frame from its world transform + bounds ---------------------
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const F = front.clone().setY(0).normalize();
    const UP = new THREE.Vector3(0, 1, 0);
    const S = new THREE.Vector3().crossVectors(F, UP).normalize();
    const alongF = Math.abs(F.x) > Math.abs(F.z) ? 'x' : 'z';
    const across = alongF === 'x' ? 'z' : 'x';
    this.d = { L: size[alongF] / 2, W: size[across] / 2, H: size.y };
    this.origin = new THREE.Vector3(center.x, box.min.y, center.z);
    this.F = F;
    this.S = S;
    this.UP = UP;

    // --- Scene state we borrow and later restore ---------------------------
    // (the scene background is left untouched)
    this.lights = lights.map((light) => ({ light, base: light.intensity }));

    // Cool back-lights that carve the silhouette, then stay as rim light
    this.rimA = new THREE.DirectionalLight(0xdfe8ff, 0);
    this.rimB = new THREE.DirectionalLight(0xdfe8ff, 0);
    this.toWorld(polar(150, this.d.L * 3, this.d.H * 2.2), this.rimA.position);
    this.toWorld(polar(-155, this.d.L * 3, this.d.H * 1.8), this.rimB.position);
    this.rimA.target.position.copy(center);
    this.rimB.target.position.copy(center);
    scene.add(this.rimA, this.rimA.target, this.rimB, this.rimB.target);

    // Everything GSAP animates lives on these two plain objects
    this.shot = { index: 0, u: 0 };
    this.fx = { light: 0, rim: 3.2, fade: 1 };

    this.timeline = this.buildTimeline();
    this.applyShot();
    this.applyFx();
  }

  get playing() {
    return this.phase === 'playing';
  }

  get finished() {
    return this.phase === 'done';
  }

  toWorld([f, s, y], out = new THREE.Vector3()) {
    return out.copy(this.origin).addScaledVector(this.F, f).addScaledVector(this.S, s).addScaledVector(this.UP, y);
  }

  buildTimeline() {
    const { fx } = this;
    const tl = gsap.timeline({
      onUpdate: () => {
        this.applyFx();
        if (this.overlay.progress) {
          this.overlay.progress.style.transform = `scaleX(${tl.progress().toFixed(4)})`;
        }
      },
      onComplete: () => this.complete(),
    });

    // --- Camera: one tween per shot; a new shot starting is a hard cut ---
    SHOTS.forEach((shot, index) => {
      tl.fromTo(
        this.shot,
        { u: 0 },
        {
          u: 1,
          duration: shot.end - shot.start,
          ease: SHOT_EASE,
          immediateRender: false,
          onStart: () => {
            this.shot.index = index;
          },
          onUpdate: () => {
            this.shot.index = index;
            this.applyShot();
          },
        },
        shot.start,
      );

      // Quick dip to black around each cut
      if (index > 0) {
        tl.to(fx, { fade: 1, duration: CUT_FADE, ease: 'power1.in' }, shot.start - CUT_FADE);
        tl.to(fx, { fade: 0, duration: CUT_FADE, ease: 'power1.out' }, shot.start);
      }
    });

    // --- Lighting: back-lit silhouette → studio lights up → rim eases out ---
    tl.to(fx, { fade: 0, duration: 0.7, ease: 'sine.inOut' }, 0)
      .to(fx, { light: 1, rim: 1.2, duration: 1.9, ease: 'sine.inOut' }, 0.5)
      .to(fx, { rim: 0, duration: 1.2, ease: 'sine.inOut' }, INTRO_DURATION - 1.2);

    return tl;
  }

  /** Camera pose for the current shot / progress. */
  applyShot() {
    const shot = SHOTS[this.shot.index];
    const u = this.shot.u;
    const { camera, d } = this;

    camera.position.copy(this.toWorld(shot.cam(u, d)));
    this.toWorld(shot.look(u, d), this.look);
    camera.lookAt(this.look);
    const fov = lerp(shot.fov[0], shot.fov[1], u);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  applyFx() {
    const { fx } = this;
    this.lights.forEach(({ light, base }) => {
      light.intensity = base * fx.light;
    });
    this.rimA.intensity = fx.rim;
    this.rimB.intensity = fx.rim * 0.7;
    if (this.overlay.fade) this.overlay.fade.style.opacity = fx.fade.toFixed(3);
  }

  /** Final hero pose — where the orbit camera starts after the intro. */
  finalLook() {
    const last = SHOTS[SHOTS.length - 1];
    return this.toWorld(last.look(1, this.d));
  }

  complete() {
    if (this.phase !== 'playing') return;
    this.camera.fov = INTRO_FINAL_FOV;
    this.camera.updateProjectionMatrix();
    this.dispose();
    this.onFinish?.('complete', this.finalLook());
  }

  /**
   * User grabbed control: stop driving the camera right where it is and blend
   * lights / background / FOV back to normal over a short handoff.
   */
  skip() {
    if (this.phase !== 'playing') return;
    this.phase = 'handoff';
    this.timeline.kill();
    const { camera } = this;
    this.handoff = gsap
      .timeline({ onUpdate: () => this.applyFx(), onComplete: () => this.dispose() })
      .to(this.fx, { light: 1, rim: 0, fade: 0, duration: HANDOFF_TIME, ease: 'power2.out' }, 0)
      .to(camera, {
        fov: INTRO_FINAL_FOV,
        duration: HANDOFF_TIME,
        ease: 'power2.out',
        onUpdate: () => camera.updateProjectionMatrix(),
      }, 0);
    if (this.overlay.progress) this.overlay.progress.style.transform = 'scaleX(0)';
    this.onFinish?.('skipped', this.look.clone());
  }

  dispose() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.timeline?.kill();
    this.handoff?.kill();
    this.lights.forEach(({ light, base }) => {
      light.intensity = base;
    });
    this.scene.remove(this.rimA, this.rimA.target, this.rimB, this.rimB.target);
    this.rimA.dispose();
    this.rimB.dispose();
    if (this.overlay.fade) this.overlay.fade.style.opacity = '0';
    if (this.overlay.progress) this.overlay.progress.style.transform = 'scaleX(0)';
  }
}
