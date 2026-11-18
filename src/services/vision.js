// Computer Vision & Image Processing Engine for CivilCamscanner
// Supports async OpenCV.js loading + deterministic Pure-JS CV fallback for 100% offline/instant reliability

let opencvStatus = 'idle'; // 'idle' | 'loading' | 'ready' | 'fallback'
const statusListeners = new Set();

function notifyStatus(status) {
  opencvStatus = status;
  statusListeners.forEach((cb) => {
    try {
      cb(status);
    } catch (err) {
      console.error(err);
    }
  });
}

export function getOpenCVStatus() {
  return opencvStatus;
}

export function subscribeOpenCVStatus(callback) {
  statusListeners.add(callback);
  callback(opencvStatus);
  return () => statusListeners.delete(callback);
}

export function loadOpenCVAsync() {
  if (typeof window === 'undefined') return Promise.resolve('fallback');
  if (window.cv && window.cv.Mat) {
    notifyStatus('ready');
    return Promise.resolve('ready');
  }
  if (opencvStatus === 'loading') {
    return new Promise((resolve) => {
      const unsub = subscribeOpenCVStatus((st) => {
        if (st === 'ready' || st === 'fallback') {
          unsub();
          resolve(st);
        }
      });
    });
  }

  notifyStatus('loading');

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      if (opencvStatus !== 'ready') {
        notifyStatus('fallback');
        resolve('fallback');
      }
    }, 6500);

    const existingScript = document.getElementById('opencv-js-script');
    if (existingScript) {
      return;
    }

    const script = document.createElement('script');
    script.id = 'opencv-js-script';
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;

    script.onload = () => {
      const checkReady = () => {
        if (window.cv && window.cv.Mat) {
          clearTimeout(timeoutId);
          notifyStatus('ready');
          resolve('ready');
        } else if (window.cv && 'onRuntimeInitialized' in window.cv) {
          window.cv.onRuntimeInitialized = () => {
            clearTimeout(timeoutId);
            notifyStatus('ready');
            resolve('ready');
          };
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    };

    script.onerror = () => {
      clearTimeout(timeoutId);
      notifyStatus('fallback');
      resolve('fallback');
    };

    document.body.appendChild(script);
  });
}

/**
 * Orders 4 points clockwise starting from Top-Left: [TL, TR, BR, BL]
 * Points are normalized { x: 0..1, y: 0..1 } or pixel coordinates.
 */
export function orderQuadPoints(pts) {
  if (!pts || pts.length !== 4) {
    return [
      { x: 0.12, y: 0.12 },
      { x: 0.88, y: 0.12 },
      { x: 0.88, y: 0.88 },
      { x: 0.12, y: 0.88 },
    ];
  }
  const cloned = pts.map((p) => ({ x: p.x, y: p.y }));
  // Sort by y first to separate top 2 and bottom 2
  cloned.sort((a, b) => a.y - b.y);
  const top = cloned.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = cloned.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]]; // TL, TR, BR, BL
}

export function getDefaultCorners(margin = 0.08) {
  return [
    { x: margin, y: margin },
    { x: 1 - margin, y: margin },
    { x: 1 - margin, y: 1 - margin },
    { x: margin, y: 1 - margin },
  ];
}

/**
 * Checks if two sets of normalized 4-corner points are close enough to be considered "stable"
 */
export function calculateCornerStability(cornersA, cornersB) {
  if (!cornersA || !cornersB || cornersA.length !== 4 || cornersB.length !== 4) {
    return Infinity;
  }
  let totalDist = 0;
  for (let i = 0; i < 4; i++) {
    const dx = cornersA[i].x - cornersB[i].x;
    const dy = cornersA[i].y - cornersB[i].y;
    totalDist += Math.hypot(dx, dy);
  }
  return totalDist / 4;
}

/**
 * Smoothly interpolates between previous corners and newly detected corners for jitter-free overlay
 */
export function lerpCorners(prev, next, alpha = 0.35) {
  if (!prev || prev.length !== 4) return next;
  if (!next || next.length !== 4) return prev;
  return prev.map((p, idx) => ({
    x: p.x + (next[idx].x - p.x) * alpha,
    y: p.y + (next[idx].y - p.y) * alpha,
  }));
}

/**
 * Validates that a 4-point polygon looks like a plausible document quad
 */
function isValidQuad(pts) {
  if (!pts || pts.length !== 4) return false;
  // Shoelace area in normalized coords (0..1)
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  area = Math.abs(area) / 2;
  if (area < 0.08 || area > 0.96) return false;

  // Check minimum side length
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const len = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
    if (len < 0.15) return false;
  }
  return true;
}

/**
 * Detects 4 corners of a document from a Video, Image, or Canvas source.
 * Returns { detected: boolean, corners: [{x,y}, {x,y}, {x,y}, {x,y}], confidence: number }
 * Coordinates are normalized in [0, 1].
 */
const workCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

export function detectDocumentCorners(sourceElement) {
  if (!workCanvas || !sourceElement) {
    return { detected: false, corners: getDefaultCorners(0.1), confidence: 0 };
  }

  const srcW = sourceElement.videoWidth || sourceElement.naturalWidth || sourceElement.width || 0;
  const srcH = sourceElement.videoHeight || sourceElement.naturalHeight || sourceElement.height || 0;
  if (srcW < 32 || srcH < 32) {
    return { detected: false, corners: getDefaultCorners(0.1), confidence: 0 };
  }

  const maxDim = 260;
  const scale = Math.min(maxDim / srcW, maxDim / srcH);
  const w = Math.max(48, Math.round(srcW * scale));
  const h = Math.max(48, Math.round(srcH * scale));

  workCanvas.width = w;
  workCanvas.height = h;
  const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceElement, 0, 0, w, h);

  // 1. Try OpenCV.js Canny + Contours + approxPolyDP if OpenCV is ready
  if (window.cv && window.cv.Mat && opencvStatus === 'ready') {
    try {
      const cvResult = detectWithOpenCV(workCanvas, w, h);
      if (cvResult && cvResult.detected) {
        return cvResult;
      }
    } catch {
      // Fall through to pure JS CV detector
    }
  }

  // 2. Pure-JS Computer Vision Detector (Bright Document Segmentation + Sobel Edge Extremal Quad)
  const imgData = ctx.getImageData(0, 0, w, h);
  return detectWithPureJS(imgData.data, w, h);
}

function detectWithOpenCV(canvas, w, h) {
  const cv = window.cv;
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const hierarchy = new cv.Mat();
  const contours = new cv.MatVector();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);

    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, edges, kernel);
    kernel.delete();

    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let bestQuad = null;
    const totalArea = w * h;

    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area > totalArea * 0.1 && area < totalArea * 0.96) {
        const peri = cv.arcLength(cnt, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.025 * peri, true);
        if (approx.rows === 4 && area > maxArea && cv.isContourConvex(approx)) {
          maxArea = area;
          bestQuad = [
            { x: approx.data32S[0] / w, y: approx.data32S[1] / h },
            { x: approx.data32S[2] / w, y: approx.data32S[3] / h },
            { x: approx.data32S[4] / w, y: approx.data32S[5] / h },
            { x: approx.data32S[6] / w, y: approx.data32S[7] / h },
          ];
        }
        approx.delete();
      }
      cnt.delete();
    }

    if (bestQuad) {
      const ordered = orderQuadPoints(bestQuad);
      if (isValidQuad(ordered)) {
        return {
          detected: true,
          corners: ordered,
          confidence: Math.min(0.98, maxArea / (totalArea * 0.55)),
        };
      }
    }
    return null;
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    hierarchy.delete();
    contours.delete();
  }
}

function detectWithPureJS(data, w, h) {
  const n = w * h;
  const lum = new Float32Array(n);
  let sumLum = 0;

  // Compute paper likelihood score (high luminance, low saturation)
  for (let i = 0; i < n; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const satPenalty = (maxC - minC) * 0.35;
    const val = Math.max(0, 0.299 * r + 0.587 * g + 0.114 * b - satPenalty);
    lum[i] = val;
    sumLum += val;
  }

  const meanLum = sumLum / n;
  // Compute border average luminance to distinguish foreground paper from background
  let borderSum = 0;
  let borderCount = 0;
  for (let x = 0; x < w; x++) {
    borderSum += lum[x] + lum[(h - 1) * w + x];
    borderCount += 2;
  }
  for (let y = 0; y < h; y++) {
    borderSum += lum[y * w] + lum[y * w + (w - 1)];
    borderCount += 2;
  }
  const borderMean = borderSum / Math.max(1, borderCount);
  const threshold = Math.max(meanLum * 1.05, (meanLum + borderMean) * 0.52);

  // Sobel edge + bright paper boundary points
  const edgePoints = [];
  const marginX = Math.floor(w * 0.03);
  const marginY = Math.floor(h * 0.03);

  for (let y = marginY; y < h - marginY; y += 2) {
    for (let x = marginX; x < w - marginX; x += 2) {
      const idx = y * w + x;
      if (lum[idx] < threshold) continue;

      // Check if near boundary (gradient magnitude)
      const gx = lum[idx + 1] - lum[idx - 1];
      const gy = lum[idx + w] - lum[idx - w];
      const grad = Math.abs(gx) + Math.abs(gy);
      if (grad > 18 || lum[idx] > threshold * 1.08) {
        edgePoints.push({ x: x / w, y: y / h, weight: grad });
      }
    }
  }

  if (edgePoints.length < 40) {
    return {
      detected: false,
      corners: getDefaultCorners(0.12),
      confidence: 0,
    };
  }

  // Find centroid of candidate paper points
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < edgePoints.length; i++) {
    cx += edgePoints[i].x;
    cy += edgePoints[i].y;
  }
  cx /= edgePoints.length;
  cy /= edgePoints.length;

  // Find the 4 extremal corners in rotated diagonal directions from centroid
  let tl = null,
    tr = null,
    br = null,
    bl = null;
  let maxTL = -Infinity,
    maxTR = -Infinity,
    maxBR = -Infinity,
    maxBL = -Infinity;

  for (let i = 0; i < edgePoints.length; i++) {
    const p = edgePoints[i];
    const dx = p.x - cx;
    const dy = p.y - cy;

    const sTL = -dx - dy;
    const sTR = dx - dy;
    const sBR = dx + dy;
    const sBL = -dx + dy;

    if (sTL > maxTL) {
      maxTL = sTL;
      tl = p;
    }
    if (sTR > maxTR) {
      maxTR = sTR;
      tr = p;
    }
    if (sBR > maxBR) {
      maxBR = sBR;
      br = p;
    }
    if (sBL > maxBL) {
      maxBL = sBL;
      bl = p;
    }
  }

  const candidate = orderQuadPoints([
    { x: tl.x, y: tl.y },
    { x: tr.x, y: tr.y },
    { x: br.x, y: br.y },
    { x: bl.x, y: bl.y },
  ]);

  if (isValidQuad(candidate)) {
    return {
      detected: true,
      corners: candidate,
      confidence: Math.min(0.95, edgePoints.length / (n * 0.12)),
    };
  }

  return {
    detected: false,
    corners: getDefaultCorners(0.1),
    confidence: 0,
  };
}

/**
 * Solves an 8x8 linear system A * h = b via Gaussian elimination with partial pivoting
 * to compute the exact 3x3 Homography matrix mapping Destination (0..dstW, 0..dstH) -> Source Quad.
 */
function solveHomographyMatrix(srcPts, dstW, dstH) {
  const dstPts = [
    { x: 0, y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0, y: dstH },
  ];

  // We solve for H mapping dst (x,y) -> src (u,v) for inverse-mapped bilinear sampling
  const A = [];
  const B = [];

  for (let i = 0; i < 4; i++) {
    const x = dstPts[i].x;
    const y = dstPts[i].y;
    const u = srcPts[i].x;
    const v = srcPts[i].y;

    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    B.push(v);
  }

  const n = 8;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
        maxRow = k;
      }
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [B[i], B[maxRow]] = [B[maxRow], B[i]];

    const pivot = A[i][i] || 1e-12;
    for (let k = i + 1; k < n; k++) {
      const factor = A[k][i] / pivot;
      B[k] -= factor * B[i];
      for (let j = i; j < n; j++) {
        A[k][j] -= factor * A[i][j];
      }
    }
  }

  const h = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = B[i];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i][j] * h[j];
    }
    h[i] = sum / (A[i][i] || 1e-12);
  }

  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * Performs 4-Point Perspective Transform (Homography) on an image dataURL or HTMLImageElement
 * using normalized corners [TL, TR, BR, BL].
 * Returns a Promise<string> (cropped & deskewed image DataURL).
 */
export async function warpPerspectiveDocument(imageSource, normalizedCorners, maxOutputDim = 1800) {
  const img = await loadImageElement(imageSource);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const ordered = orderQuadPoints(normalizedCorners);
  const srcPts = ordered.map((p) => ({
    x: Math.max(0, Math.min(srcW - 1, p.x * srcW)),
    y: Math.max(0, Math.min(srcH - 1, p.y * srcH)),
  }));

  // Compute physical aspect ratio from Euclidean lengths of opposite sides
  const widthTop = Math.hypot(srcPts[1].x - srcPts[0].x, srcPts[1].y - srcPts[0].y);
  const widthBottom = Math.hypot(srcPts[2].x - srcPts[3].x, srcPts[2].y - srcPts[3].y);
  const heightLeft = Math.hypot(srcPts[3].x - srcPts[0].x, srcPts[3].y - srcPts[0].y);
  const heightRight = Math.hypot(srcPts[2].x - srcPts[1].x, srcPts[2].y - srcPts[1].y);

  let dstW = Math.round(Math.max(widthTop, widthBottom));
  let dstH = Math.round(Math.max(heightLeft, heightRight));

  if (dstW < 64 || dstH < 64) {
    dstW = srcW;
    dstH = srcH;
  }

  if (Math.max(dstW, dstH) > maxOutputDim) {
    const scale = maxOutputDim / Math.max(dstW, dstH);
    dstW = Math.round(dstW * scale);
    dstH = Math.round(dstH * scale);
  }

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  srcCtx.drawImage(img, 0, 0);

  // Try OpenCV.js warpPerspective if ready
  if (window.cv && window.cv.Mat && opencvStatus === 'ready') {
    try {
      const cv = window.cv;
      const srcMat = cv.imread(srcCanvas);
      const dstMat = new cv.Mat();
      const dsize = new cv.Size(dstW, dstH);

      const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        srcPts[0].x,
        srcPts[0].y,
        srcPts[1].x,
        srcPts[1].y,
        srcPts[2].x,
        srcPts[2].y,
        srcPts[3].x,
        srcPts[3].y,
      ]);
      const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, dstW, 0, dstW, dstH, 0, dstH]);

      const M = cv.getPerspectiveTransform(srcTri, dstTri);
      cv.warpPerspective(srcMat, dstMat, M, dsize, cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());

      const outCanvas = document.createElement('canvas');
      outCanvas.width = dstW;
      outCanvas.height = dstH;
      cv.imshow(outCanvas, dstMat);

      srcMat.delete();
      dstMat.delete();
      srcTri.delete();
      dstTri.delete();
      M.delete();

      return outCanvas.toDataURL('image/jpeg', 0.94);
    } catch {
      // Fallback to Pure-JS Homography below
    }
  }

  // Pure-JS Projective Homography with Bilinear Interpolation
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = dstW;
  outCanvas.height = dstH;
  const outCtx = outCanvas.getContext('2d');
  const outImageData = outCtx.createImageData(dstW, dstH);
  const dstData = outImageData.data;

  const H = solveHomographyMatrix(srcPts, dstW, dstH);
  const h0 = H[0],
    h1 = H[1],
    h2 = H[2],
    h3 = H[3],
    h4 = H[4],
    h5 = H[5],
    h6 = H[6],
    h7 = H[7];

  for (let y = 0; y < dstH; y++) {
    const rowOffset = y * dstW;
    for (let x = 0; x < dstW; x++) {
      const denom = h6 * x + h7 * y + 1;
      const u = (h0 * x + h1 * y + h2) / denom;
      const v = (h3 * x + h4 * y + h5) / denom;

      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(u)));
      const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(v)));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);

      const dx = Math.max(0, Math.min(1, u - x0));
      const dy = Math.max(0, Math.min(1, v - y0));

      const w00 = (1 - dx) * (1 - dy);
      const w10 = dx * (1 - dy);
      const w01 = (1 - dx) * dy;
      const w11 = dx * dy;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;

      const dstIdx = (rowOffset + x) * 4;
      dstData[dstIdx] = srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11;
      dstData[dstIdx + 1] =
        srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11;
      dstData[dstIdx + 2] =
        srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11;
      dstData[dstIdx + 3] = 255;
    }
  }

  outCtx.putImageData(outImageData, 0, 0);
  return outCanvas.toDataURL('image/jpeg', 0.94);
}

/**
 * Applies Document Filter + Brightness + Contrast + 90-degree Rotation
 * Filter modes:
 * - 'original': ต้นฉบับ
 * - 'magic': สีคมชัด (Magic Color - Shadow Removal + Ink & Stamp Enhancement)
 * - 'grayscale': ขาว-เทา (Grayscale)
 * - 'bw': ขาว-ดำเอกสาร (Adaptive Thresholding)
 */
export async function applyDocumentFilter(
  croppedImageSrc,
  { filter = 'magic', brightness = 0, contrast = 0, rotation = 0 } = {}
) {
  const img = await loadImageElement(croppedImageSrc);
  const rawW = img.naturalWidth || img.width;
  const rawH = img.naturalHeight || img.height;

  const normRot = ((rotation % 360) + 360) % 360;
  const isRotated90 = normRot === 90 || normRot === 270;
  const w = isRotated90 ? rawH : rawW;
  const h = isRotated90 ? rawW : rawH;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((normRot * Math.PI) / 180);
  ctx.drawImage(img, -rawW / 2, -rawH / 2);
  ctx.restore();

  if (filter === 'original' && brightness === 0 && contrast === 0) {
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const n = w * h;

  // Precompute luminance integral image for fast local background estimation (used by 'magic' and 'bw')
  let integral = null;
  if (filter === 'magic' || filter === 'bw') {
    integral = new Float64Array((w + 1) * (h + 1));
    const stride = w + 1;
    for (let y = 1; y <= h; y++) {
      let rowSum = 0;
      const srcRow = (y - 1) * w;
      const intRow = y * stride;
      const prevIntRow = (y - 1) * stride;
      for (let x = 1; x <= w; x++) {
        const idx = (srcRow + (x - 1)) * 4;
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        rowSum += lum;
        integral[intRow + x] = integral[prevIntRow + x] + rowSum;
      }
    }
  }

  const stride = w + 1;
  const windowRadius = Math.max(12, Math.round(Math.min(w, h) * 0.025));

  // Brightness & Contrast factors
  const bOffset = brightness * 1.8;
  const cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - windowRadius);
    const y1 = Math.min(h, y + windowRadius + 1);
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      let r = data[idx];
      let g = data[idx + 1];
      let b = data[idx + 2];

      if (filter === 'magic') {
        // Local background illumination estimation via integral image
        const x0 = Math.max(0, x - windowRadius);
        const x1 = Math.min(w, x + windowRadius + 1);
        const area = (x1 - x0) * (y1 - y0);
        const localSum =
          integral[y1 * stride + x1] -
          integral[y0 * stride + x1] -
          integral[y1 * stride + x0] +
          integral[y0 * stride + x0];
        const localBg = Math.max(60, localSum / area);

        // Normalize illumination to remove shadows while keeping ink & stamps vivid
        const scale = 250 / localBg;
        let nr = Math.min(255, r * scale);
        let ng = Math.min(255, g * scale);
        let nb = Math.min(255, b * scale);

        // Whiten near-white paper background and boost ink contrast & saturation
        const lum = 0.299 * nr + 0.587 * ng + 0.114 * nb;
        if (lum > 212 && Math.max(nr, ng, nb) - Math.min(nr, ng, nb) < 26) {
          nr = 255;
          ng = 255;
          nb = 255;
        } else {
          // Boost contrast & color saturation for signatures/stamps
          const avg = (nr + ng + nb) / 3;
          nr = avg + (nr - avg) * 1.38;
          ng = avg + (ng - avg) * 1.38;
          nb = avg + (nb - avg) * 1.38;
          nr = (nr - 128) * 1.22 + 128;
          ng = (ng - 128) * 1.22 + 128;
          nb = (nb - 128) * 1.22 + 128;
        }
        r = nr;
        g = ng;
        b = nb;
      } else if (filter === 'grayscale') {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        conststretched = (gray - 128) * 1.12 + 132;
        r = g = b = thestretched(thestretched_val(gray));
      } else if (filter === 'bw') {
        // Adaptive Thresholding (ขาว-ดำเอกสาร)
        const x0 = Math.max(0, x - windowRadius);
        const x1 = Math.min(w, x + windowRadius + 1);
        const area = (x1 - x0) * (y1 - y0);
        const localSum =
          integral[y1 * stride + x1] -
          integral[y0 * stride + x1] -
          integral[y1 * stride + x0] +
          integral[y0 * stride + x0];
        const localMean = localSum / area;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        // Sensitivity offset adjusted by brightness/contrast
        const threshOffset = 11 - brightness * 0.12;
        const isInk = lum < localMean - threshOffset;
        const val = isInk ? 12 : 255;
        r = g = b = val;
      }

      // Apply user Brightness & Contrast sliders
      if (filter !== 'bw' || brightness !== 0 || contrast !== 0) {
        r = cFactor * (r + bOffset - 128) + 128;
        g = cFactor * (g + bOffset - 128) + 128;
        b = cFactor * (b + bOffset - 128) + 128;
      }

      data[idx] = Math.max(0, Math.min(255, r));
      data[idx + 1] = Math.max(0, Math.min(255, g));
      data[idx + 2] = Math.max(0, Math.min(255, b));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function thestretched_val(gray) {
  return (gray - 128) * 1.15 + 132;
}
function thestretched(v) {
  return Math.max(0, Math.min(255, v));
}

export function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    if (src instanceof HTMLImageElement) {
      if (src.complete) return resolve(src);
      src.onload = () => resolve(src);
      src.onerror = reject;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

/**
 * Generates a realistic sample Thai/English Civil Engineering inspection document on a dark desk
 * with slight perspective tilt, blue ink signature, and red official stamp.
 */
export function createSampleDocumentDataUrl(pageNumber = 1) {
  const w = 1080;
  const h = 1440;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Dark textured engineering desk background
  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, '#141923');
  bgGrad.addColorStop(1, '#0b0f17');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Subtle desk grain
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 2;
  for (let i = 0; i < h; i += 28) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(w, i + 18);
    ctx.stroke();
  }

  // Draw slightly tilted white paper with realistic lighting gradient (shadow on bottom-right)
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-1.8 * Math.PI) / 180);

  const pw = 820;
  const ph = 1140;
  const px = -pw / 2;
  const py = -ph / 2;

  // Drop shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = 35;
  ctx.shadowOffsetX = 12;
  ctx.shadowOffsetY = 18;

  // Paper surface with slight ambient shadow gradient (great for testing Magic Color & Adaptive Thresholding)
  const paperGrad = ctx.createLinearGradient(px, py, px + pw, py + ph);
  paperGrad.addColorStop(0, '#fcfcfa');
  paperGrad.addColorStop(0.6, '#f1f0ec');
  paperGrad.addColorStop(1, '#d8dadf');
  ctx.fillStyle = paperGrad;
  ctx.fillRect(px, py, pw, ph);

  ctx.shadowColor = 'transparent';

  // Header Border & Civil Engineering Title
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 3;
  ctx.strokeRect(px + 46, py + 46, pw - 92, ph - 92);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('ใบตรวจสอบงานวิศวกรรมโยธา (CIVIL INSPECTION REPORT)', px + 76, py + 110);

  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText(`เลขที่เอกสาร: CIV-2026-00${pageNumber}   |   วันที่: 18 พฤศจิกายน 2569`, px + 76, py + 150);

  ctx.beginPath();
  ctx.moveTo(px + 70, py + 175);
  ctx.lineTo(px + pw - 70, py + 175);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Body Text in Thai & English (for testing Tesseract OCR tha+eng)
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 23px sans-serif';
  ctx.fillText('1. รายละเอียดโครงการก่อสร้าง (Project Specification)', px + 76, py + 225);

  ctx.font = '21px sans-serif';
  ctx.fillStyle = '#1e293b';
  const lines = [
    'ชื่อโครงการ: โครงการก่อสร้างอาคารปฏิบัติการวิศวกรรมโยธา ชั้น 4',
    'สถานที่ตรวจสอบ: เขตจตุจักร กรุงเทพมหานคร (Zone B - Structural Beam)',
    'ผลการทดสอบกำลังอัดคอนกรีต: 345 ksc (ผ่านเกณฑ์มาตรฐาน วสท.)',
    'ระยะหุ้มคอนกรีต (Concrete Covering): 4.00 ซม. ตามแบบก่อสร้าง',
    'สถานะการตรวจสอบเหล็กเสริม: เหล็กข้ออ้อย SD40 ขนาด DB20 ครบถ้วน',
    '',
    '2. สรุปผลการตรวจรับงาน (Inspection Summary)',
    'โครงสร้างเสาและคานคอนกรีตเสริมเหล็กมีความแข็งแรง ได้ระดับและแนวดิ่ง',
    'ตามมาตรฐานงานวิศวกรรมโยธา อนุมัติให้ดำเนินการเทคอนกรีตขั้นตอนถัดไปได้',
    'Approved for Structural Concrete Pouring - CivilCamscanner Verified.',
  ];

  lines.forEach((line, idx) => {
    if (line.startsWith('2.')) {
      ctx.font = 'bold 23px sans-serif';
      ctx.fillStyle = '#0f172a';
    } else {
      ctx.font = '21px sans-serif';
      ctx.fillStyle = '#1e293b';
    }
    ctx.fillText(line, px + 76, py + 270 + idx * 44);
  });

  // Inspection Table
  const tableY = py + 730;
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.8;
  ctx.strokeRect(px + 76, tableY, pw - 152, 140);
  ctx.beginPath();
  ctx.moveTo(px + 76, tableY + 46);
  ctx.lineTo(px + pw - 76, tableY + 46);
  ctx.stroke();

  ctx.font = 'bold 19px sans-serif';
  ctx.fillStyle = '#0f172a';
  ctx.fillText('รายการตรวจสอบ (Item)', px + 96, tableY + 30);
  ctx.fillText('ค่ามาตรฐาน (Spec)', px + 410, tableY + 30);
  ctx.fillText('ผลตรวจ (Result)', px + 610, tableY + 30);

  ctx.font = '19px sans-serif';
  ctx.fillText('Slump Test คอนกรีตสด', px + 96, tableY + 82);
  ctx.fillText('7.5 - 10.0 cm', px + 410, tableY + 82);
  ctx.fillText('8.5 cm (PASS)', px + 610, tableY + 82);

  ctx.fillText('ระดับท้องคาน (Elevation)', px + 96, tableY + 120);
  ctx.fillText('± 3.0 mm', px + 410, tableY + 120);
  ctx.fillText('+1.0 mm (PASS)', px + 610, tableY + 120);

  // Red Official Approved Stamp (ตราประทับสีแดง)
  ctx.save();
  ctx.translate(px + 230, py + 985);
  ctx.rotate((-8 * Math.PI) / 180);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 4;
  ctx.strokeRect(-115, -45, 230, 90);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-108, -38, 216, 76);
  ctx.fillStyle = '#dc2626';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('APPROVED / อนุมัติ', 0, -4);
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('CIVIL ENGINEERING DEPT.', 0, 22);
  ctx.restore();

  // Blue Ink Signature (ลายเซ็นหมึกน้ำเงิน)
  ctx.save();
  ctx.translate(px + 560, py + 965);
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-90, 15);
  ctx.bezierCurveTo(-60, -35, -30, 30, 0, -18);
  ctx.bezierCurveTo(25, -45, 45, 20, 85, -10);
  ctx.lineTo(115, -22);
  ctx.stroke();

  ctx.fillStyle = '#1e3a8a';
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('(นายวิศวะ โยธาพิทักษ์ - ว.12345)', 10, 48);
  ctx.fillText('วิศวกรผู้ควบคุมงาน', 10, 74);
  ctx.restore();

  ctx.restore();

  return canvas.toDataURL('image/jpeg', 0.94);
}
