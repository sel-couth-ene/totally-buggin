// Camera + MediaPipe Tasks Vision (pose, hands, face). Runs entirely in the browser.
import {
  FilesetResolver,
  PoseLandmarker,
  HandLandmarker,
  FaceLandmarker,
  DrawingUtils,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

const COLORS = {
  body: '#6fe3ff',
  hands: '#ffc857',
  faceMesh: 'rgba(255,255,255,0.20)',
  faceLine: '#b7f0ff',
  iris: '#ffc857',
};

export class Tracker {
  /**
   * @param {{video:HTMLVideoElement, canvas:HTMLCanvasElement,
   *          onFrame:(f:object)=>void, onStatus:(msg:string)=>void}} cfg
   */
  constructor({ video, canvas, onFrame, onStatus }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onFrame = onFrame;
    this.onStatus = onStatus || (() => {});

    // What to draw. Pose and hands always run, because pointing needs them.
    this.show = { body: true, hands: true, face: true };

    this.ready = false;
    this.running = false;
    this.stream = null;
    this.lastTime = -1;
    this.frameNo = 0;
    this.lastFace = null;
    this.fpsCount = 0;
    this.fpsStamp = performance.now();
  }

  async load() {
    if (this.ready) return;
    this.onStatus('Loading tracking models…');
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    this.pose = await this._make(PoseLandmarker, fileset, '/models/pose_landmarker_full.task', { numPoses: 1 });
    this.hands = await this._make(HandLandmarker, fileset, '/models/hand_landmarker.task', { numHands: 2 });
    this.face = await this._make(FaceLandmarker, fileset, '/models/face_landmarker.task', { numFaces: 1 });
    this.ready = true;
  }

  async _make(Cls, fileset, path, extra) {
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: path, delegate },
      runningMode: 'VIDEO',
      ...extra,
    });
    try {
      return await Cls.createFromOptions(fileset, opts('GPU'));
    } catch (err) {
      console.warn('GPU delegate unavailable, falling back to CPU.', err);
      return await Cls.createFromOptions(fileset, opts('CPU'));
    }
  }

  async start() {
    await this.load();
    this.onStatus('Starting camera…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.lastTime = -1;
    this.lastFace = null;
    this.running = true;
    requestAnimationFrame(() => this._loop());
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _loop() {
    if (!this.running) return;
    const v = this.video;

    if (v.readyState >= 2 && v.currentTime !== this.lastTime) {
      this.lastTime = v.currentTime;
      const ts = performance.now();

      const poseRes = this.pose.detectForVideo(v, ts);
      const handRes = this.hands.detectForVideo(v, ts);
      // the face mesh is the most expensive model: run it on every other frame and only if shown
      if (this.show.face) {
        if (this.frameNo % 2 === 0) this.lastFace = this.face.detectForVideo(v, ts);
      } else {
        this.lastFace = null;
      }
      this.frameNo++;

      const w = this.canvas.width;
      const h = this.canvas.height;
      this._draw(poseRes, handRes, this.lastFace, w, h);

      this.fpsCount++;
      const now = performance.now();
      let fps = null;
      if (now - this.fpsStamp >= 1000) {
        fps = Math.round((this.fpsCount * 1000) / (now - this.fpsStamp));
        this.fpsCount = 0;
        this.fpsStamp = now;
      }

      this.onFrame({
        pose: poseRes.landmarks && poseRes.landmarks[0] ? poseRes.landmarks[0] : null,
        hands: handRes,
        w, h,
        ctx: this.ctx,
        fps,
      });
    }
    requestAnimationFrame(() => this._loop());
  }

  _draw(poseRes, handRes, faceRes, w, h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // mirrored video, slightly dimmed so the skeleton stands out
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, 0, 0, w, h);
    ctx.fillStyle = 'rgba(10,14,20,0.38)';
    ctx.fillRect(0, 0, w, h);

    const du = new DrawingUtils(ctx);

    // face: tessellation, contours (eyes, brows, lips, oval) and irises
    if (this.show.face && faceRes && faceRes.faceLandmarks) {
      for (const f of faceRes.faceLandmarks) {
        du.drawConnectors(f, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: COLORS.faceMesh, lineWidth: 0.6 });
        du.drawConnectors(f, FaceLandmarker.FACE_LANDMARKS_CONTOURS, { color: COLORS.faceLine, lineWidth: 1.3 });
        du.drawConnectors(f, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, { color: COLORS.iris, lineWidth: 1.5 });
        du.drawConnectors(f, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, { color: COLORS.iris, lineWidth: 1.5 });
      }
    }

    // body: all 33 pose joints
    if (this.show.body && poseRes.landmarks) {
      for (const lm of poseRes.landmarks) {
        du.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: COLORS.body, lineWidth: 3 });
        du.drawLandmarks(lm, {
          color: COLORS.body,
          fillColor: '#ffffff',
          lineWidth: 1.5,
          radius: (d) => DrawingUtils.lerp(d.from ? d.from.z : 0, -0.15, 0.1, 6, 2),
        });
      }
    }

    // hands: 21 joints each
    if (this.show.hands && handRes.landmarks) {
      for (const lm of handRes.landmarks) {
        du.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: COLORS.hands, lineWidth: 3 });
        du.drawLandmarks(lm, {
          color: COLORS.hands,
          fillColor: '#ffffff',
          lineWidth: 1,
          radius: (d) => DrawingUtils.lerp(d.from ? d.from.z : 0, -0.15, 0.1, 5, 1.5),
        });
      }
    }
    ctx.restore();
  }
}
