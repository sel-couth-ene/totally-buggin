// MediaPipe Tasks (pose, hands, face) running in the browser, fully offline:
// the library is bundled under /static/vendor and the models load from /static/models
// (fetch them once with `python tools/download_models.py`). Nothing is downloaded at runtime.

const VISION = '/static/vendor/tasks-vision/vision_bundle.mjs';
const WASM = '/static/vendor/tasks-vision/wasm';
const MODELS = { pose: 'pose_landmarker_full.task', hand: 'hand_landmarker.task', face: 'face_landmarker.task' };

async function candidates(key) {
  const url = `/static/models/${MODELS[key]}`;
  const r = await fetch(url, { method: 'HEAD' }).catch(() => null);
  if (!r || !r.ok) throw new Error(`the ${key} model is missing; run "python tools/download_models.py" once`);
  return [url];
}

async function create(Cls, fileset, key, extra, delegates = ['GPU', 'CPU']) {
  let lastErr;
  for (const modelAssetPath of await candidates(key)) {
    for (const delegate of delegates) {
      try {
        return await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate }, runningMode: 'VIDEO', ...extra });
      } catch (e) {
        lastErr = e;
        console.warn(`${key}: ${modelAssetPath} with ${delegate} failed`, e);
        if (String(e).includes('fetch')) break;       // model not reachable: try the next URL
      }
    }
  }
  throw lastErr;
}

export async function createTracker(onStatus = () => {}) {
  onStatus('Loading the tracking library');
  const vision = await import(VISION);
  const { FilesetResolver, PoseLandmarker, HandLandmarker, FaceLandmarker } = vision;
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  onStatus('Loading the body model');
  const pose = await create(PoseLandmarker, fileset, 'pose', { numPoses: 1 });
  onStatus('Loading the hand model');
  const hands = await create(HandLandmarker, fileset, 'hand', { numHands: 2 });
  onStatus('Loading the face model');
  // The face model runs on the CPU first: it is small, runs on every third frame, and on some machines the
  // GPU version loads fine but never finds a face. If it still finds nothing while the body tracker clearly
  // sees a face, swapFaceDelegate() reloads it on the other processor.
  const FACE_OPTS = { numFaces: 1, minFaceDetectionConfidence: 0.4, minFacePresenceConfidence: 0.4, minTrackingConfidence: 0.4 };
  const faceInfo = { loaded: false, delegate: null, error: null, swapped: false };
  let face = null;
  const loadFace = async (delegates) => {
    for (const d of delegates) {
      try {
        const f = await create(FaceLandmarker, fileset, 'face', FACE_OPTS, [d]);
        face?.close?.(); face = f;
        Object.assign(faceInfo, { loaded: true, delegate: d, error: null });
        return true;
      } catch (e) { faceInfo.error = String(e?.message || e); }
    }
    return false;
  };
  if (!(await loadFace(['CPU', 'GPU']))) console.warn('Face model unavailable; continuing without it:', faceInfo.error);

  let frame = 0, lastTs = -1, lastFace = null;
  return {
    faceInfo,
    /** Reload the face model on the other processor (once). Returns true if it switched. */
    async swapFaceDelegate() {
      if (faceInfo.swapped || !faceInfo.loaded) return false;
      faceInfo.swapped = true;
      const other = faceInfo.delegate === 'CPU' ? 'GPU' : 'CPU';
      const ok = await loadFace([other]);
      console.info(ok ? `Face model now runs on the ${other}` : `Face model could not switch to the ${other}`);
      return ok;
    },
    connections: {
      pose: PoseLandmarker.POSE_CONNECTIONS,
      hand: HandLandmarker.HAND_CONNECTIONS,
      face: FaceLandmarker.FACE_LANDMARKS_TESSELATION,        // the full triangle mesh over the face
    },
    /** opts.face: also run the face model (only while the face mesh is switched on). */
    detect(video, { face: wantFace = false } = {}) {
      let ts = performance.now();
      if (ts <= lastTs) ts = lastTs + 1;
      lastTs = ts;
      frame++;
      const p = pose.detectForVideo(video, ts);
      const h = hands.detectForVideo(video, ts);
      if (!wantFace) lastFace = null;
      else if (face && frame % 3 === 0) {
        try { lastFace = face.detectForVideo(video, ts).faceLandmarks?.[0] || null; }
        catch (e) { lastFace = null; faceInfo.error = String(e?.message || e); }
      }
      return {
        pose: p.landmarks?.[0] || null,
        world: p.worldLandmarks?.[0] || null,
        hands: (h.landmarks || []).map((lm, i) => ({ landmarks: lm, handedness: h.handedness?.[i]?.[0]?.categoryName || '' })),
        face: lastFace,
        videoWidth: video.videoWidth, videoHeight: video.videoHeight,
      };
    },
  };
}

// Pose connections as plain pairs, used when drawing simulated tracking.
export const POSE_PAIRS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [15, 19], [16, 20], [0, 2], [0, 5], [2, 7], [5, 8]];
export const HAND_PAIRS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
