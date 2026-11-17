// Laptop camera → body landmarks, using MediaPipe Pose Landmarker (lite
// model) in the browser. Nothing leaves the computer: the video frames are
// processed locally and never stored or uploaded.
//
// The WebAssembly runtime and the model file are served by this site
// (public/mediapipe/wasm, copied from node_modules at build time, and
// public/models/pose_landmarker_lite.task), so no CDN is needed in class.
// The library itself is loaded only when the camera is first enabled.

const BASE = import.meta.env.BASE_URL;

export class PoseTracker {
  constructor({ onResult = () => {}, onStatus = () => {} } = {}) {
    this.onResult = onResult;
    this.onStatus = onStatus;
    this.stream = null;
    this.video = null;
    this.landmarker = null;
    this.raf = 0;
    this.lastVideoTime = -1;
    this.running = false;
    this.delegate = null;
    this.fps = 0;
    this._frames = [];
  }

  async start(video) {
    if (this.running) return true;
    this.video = video;
    this.onStatus('starting', 'Asking for the camera…');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.onStatus('error', 'This browser cannot open the camera. Use a current Chrome, Edge, Firefox or Safari on an https page.');
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
    } catch (e) {
      const name = e && e.name;
      this.onStatus('error', name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera for this site in the browser’s address bar, then press Enable camera again.'
        : name === 'NotFoundError' ? 'No camera was found.' : name === 'NotReadableError' ? 'The camera is in use by another app (Zoom, FaceTime…). Close it and try again.'
          : `The camera could not start (${(e && e.message) || name}).`);
      return false;
    }
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    try { await video.play(); } catch { /* autoplay of a muted stream normally works */ }
    if (!this.landmarker) {
      this.onStatus('starting', 'Loading the pose model (about 6 MB, first time only)…');
      try {
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
        const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${BASE}models/pose_landmarker_lite.task`, delegate },
          runningMode: 'VIDEO', numPoses: 1,
          minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        });
        try { this.landmarker = await make('GPU'); this.delegate = 'GPU'; } catch { this.landmarker = await make('CPU'); this.delegate = 'CPU'; }
      } catch (e) {
        this.onStatus('error', `The pose model could not load (${(e && e.message) || e}). Reload the page and try again.`);
        this.stopCamera();
        return false;
      }
    }
    this.running = true;
    this.onStatus('running', `Camera on. Pose tracking running (${this.delegate}).`);
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const v = this.video;
      if (!v || v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
      this.lastVideoTime = v.currentTime;
      const now = performance.now();
      let res;
      try { res = this.landmarker.detectForVideo(v, now); } catch { return; }
      this._frames.push(now);
      while (this._frames.length && now - this._frames[0] > 1000) this._frames.shift();
      this.fps = this._frames.length;
      this.onResult({
        landmarks: res.landmarks && res.landmarks[0] ? res.landmarks[0] : null,
        world: res.worldLandmarks && res.worldLandmarks[0] ? res.worldLandmarks[0] : null,
        width: v.videoWidth, height: v.videoHeight, t: now,
      });
    };
    this.raf = requestAnimationFrame(loop);
    return true;
  }

  stopCamera() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  stop() {
    this.stopCamera();
    this.onStatus('off', 'Camera off.');
  }

  close() {
    this.stopCamera();
    if (this.landmarker) { try { this.landmarker.close(); } catch { /* already closed */ } }
    this.landmarker = null;
  }
}
