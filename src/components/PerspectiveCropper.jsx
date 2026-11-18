import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Maximize2,
  ScanLine,
  Check,
  ArrowLeft,
  Move,
  Loader2,
} from 'lucide-react';
import {
  detectDocumentCorners,
  getDefaultCorners,
  loadImageElement,
  orderQuadPoints,
  warpPerspectiveDocument,
} from '../services/vision';

const CORNER_LABELS = ['บนซ้าย (TL)', 'บนขวา (TR)', 'ล่างขวา (BR)', 'ล่างซ้าย (BL)'];
const LOUPE_SIZE = 128; // Diameter in px
const LOUPE_ZOOM = 3.0; // 3x magnification

export default function PerspectiveCropper({
  originalDataUrl,
  initialCorners,
  onConfirmCrop,
  onCancel,
  onNotify,
}) {
  const containerRef = useRef(null);
  const imageCanvasRef = useRef(null);
  const loupeCanvasRef = useRef(null);
  const loadedImgRef = useRef(null);

  const [corners, setCorners] = useState(() =>
    initialCorners && initialCorners.length === 4 ? orderQuadPoints(initialCorners) : getDefaultCorners(0.1)
  );
  const [activeCornerIdx, setActiveCornerIdx] = useState(null);
  const [loupeScreenPos, setLoupeScreenPos] = useState({ x: 0, y: 0 });
  const [canvasBounds, setCanvasBounds] = useState({ width: 320, height: 420, left: 0, top: 0 });
  const [isWarping, setIsWarping] = useState(false);

  // Load image and fit to container
  const updateCanvasLayout = useCallback(() => {
    const img = loadedImgRef.current;
    const container = containerRef.current;
    const canvas = imageCanvasRef.current;
    if (!img || !container || !canvas) return;

    const availW = Math.max(240, container.clientWidth - 28);
    const availH = Math.max(280, container.clientHeight - 28);
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;

    const scale = Math.min(availW / imgW, availH / imgH);
    const drawW = Math.round(imgW * scale);
    const drawH = Math.round(imgH * scale);

    canvas.width = drawW;
    canvas.height = drawH;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, drawW, drawH);
    ctx.drawImage(img, 0, 0, drawW, drawH);

    const rect = canvas.getBoundingClientRect();
    setCanvasBounds({
      width: drawW,
      height: drawH,
      left: rect.left,
      top: rect.top,
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    loadImageElement(originalDataUrl).then((img) => {
      if (!mounted) return;
      loadedImgRef.current = img;
      updateCanvasLayout();
    });

    window.addEventListener('resize', updateCanvasLayout);
    return () => {
      mounted = false;
      window.removeEventListener('resize', updateCanvasLayout);
    };
  }, [originalDataUrl, updateCanvasLayout]);

  // Draw Magnifier Loupe whenever an active corner is being dragged
  useEffect(() => {
    if (activeCornerIdx === null || !loupeCanvasRef.current || !loadedImgRef.current) return;

    const loupeCanvas = loupeCanvasRef.current;
    loupeCanvas.width = LOUPE_SIZE;
    loupeCanvas.height = LOUPE_SIZE;
    const lctx = loupeCanvas.getContext('2d');

    const img = loadedImgRef.current;
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;

    const pt = corners[activeCornerIdx];
    const srcCenterX = pt.x * imgW;
    const srcCenterY = pt.y * imgH;

    // Source region size in original image pixels
    const displayToImgScale = imgW / Math.max(1, canvasBounds.width);
    const srcRadius = (LOUPE_SIZE / (2 * LOUPE_ZOOM)) * displayToImgScale;

    lctx.save();
    lctx.fillStyle = '#090d16';
    lctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);

    lctx.drawImage(
      img,
      srcCenterX - srcRadius,
      srcCenterY - srcRadius,
      srcRadius * 2,
      srcRadius * 2,
      0,
      0,
      LOUPE_SIZE,
      LOUPE_SIZE
    );

    // Draw zoomed green quad edges meeting at the center of the loupe
    const prevIdx = (activeCornerIdx + 3) % 4;
    const nextIdx = (activeCornerIdx + 1) % 4;
    const prevPt = corners[prevIdx];
    const nextPt = corners[nextIdx];

    const toLoupeCoords = (normP) => ({
      x: LOUPE_SIZE / 2 + ((normP.x - pt.x) * canvasBounds.width) * LOUPE_ZOOM,
      y: LOUPE_SIZE / 2 + ((normP.y - pt.y) * canvasBounds.height) * LOUPE_ZOOM,
    });

    const lpPrev = toLoupeCoords(prevPt);
    const lpNext = toLoupeCoords(nextPt);

    lctx.strokeStyle = '#22c55e';
    lctx.lineWidth = 2.5;
    lctx.beginPath();
    lctx.moveTo(lpPrev.x, lpPrev.y);
    lctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2);
    lctx.lineTo(lpNext.x, lpNext.y);
    lctx.stroke();

    // Precision Crosshair at center of Magnifier Loupe
    const center = LOUPE_SIZE / 2;
    lctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    lctx.lineWidth = 1.5;
    lctx.beginPath();
    lctx.moveTo(center - 14, center);
    lctx.lineTo(center + 14, center);
    lctx.moveTo(center, center - 14);
    lctx.lineTo(center, center + 14);
    lctx.stroke();

    lctx.beginPath();
    lctx.arc(center, center, 4, 0, Math.PI * 2);
    lctx.strokeStyle = '#10b981';
    lctx.lineWidth = 2;
    lctx.stroke();

    lctx.restore();
  }, [activeCornerIdx, corners, canvasBounds]);

  // Convert client (touch/mouse) coordinates into normalized [0..1] image coordinates
  const updateCornerFromClientXY = useCallback((idx, clientX, clientY) => {
    const canvas = imageCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = Math.max(0.01, Math.min(0.99, (clientX - rect.left) / rect.width));
    const ny = Math.max(0.01, Math.min(0.99, (clientY - rect.top) / rect.height));

    setCorners((prev) => {
      const next = [...prev];
      next[idx] = { x: nx, y: ny };
      return next;
    });

    // Position the Magnifier Loupe offset ABOVE the finger so the finger never blocks the view
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    // If dragging near the very top edge, offset slightly to the side so loupe remains inside screen
    const offsetY = localY < 105 ? -52 : -96;
    const clampedLoupeX = Math.max(LOUPE_SIZE / 2 + 4, Math.min(rect.width - LOUPE_SIZE / 2 - 4, localX));
    const clampedLoupeY = Math.max(LOUPE_SIZE / 2 - 24, localY + offsetY);

    setLoupeScreenPos({
      x: clampedLoupeX,
      y: clampedLoupeY,
    });
  }, []);

  // Touch & Mouse event handlers on the interactive overlay
  const findNearestCorner = (clientX, clientY) => {
    const canvas = imageCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    let bestIdx = null;
    let bestDist = 54; // Generous 54px touch radius for mobile fingers
    corners.forEach((c, idx) => {
      const cx = c.x * rect.width;
      const cy = c.y * rect.height;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    return bestIdx;
  };

  const handleTouchStart = (e) => {
    if (!e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    const idx = findNearestCorner(touch.clientX, touch.clientY);
    if (idx !== null) {
      e.preventDefault();
      setActiveCornerIdx(idx);
      updateCornerFromClientXY(idx, touch.clientX, touch.clientY);
    }
  };

  const handleTouchMove = (e) => {
    if (activeCornerIdx === null || !e.touches || e.touches.length === 0) return;
    e.preventDefault();
    const touch = e.touches[0];
    updateCornerFromClientXY(activeCornerIdx, touch.clientX, touch.clientY);
  };

  const handleTouchEnd = () => {
    if (activeCornerIdx !== null) {
      setActiveCornerIdx(null);
    }
  };

  const handleMouseDown = (e) => {
    const idx = findNearestCorner(e.clientX, e.clientY);
    if (idx !== null) {
      e.preventDefault();
      setActiveCornerIdx(idx);
      updateCornerFromClientXY(idx, e.clientX, e.clientY);
    }
  };

  const handleMouseMove = (e) => {
    if (activeCornerIdx === null) return;
    e.preventDefault();
    updateCornerFromClientXY(activeCornerIdx, e.clientX, e.clientY);
  };

  const handleMouseUp = () => {
    if (activeCornerIdx !== null) {
      setActiveCornerIdx(null);
    }
  };

  // Reset Full Image ("รีเซ็ตเต็มภาพ")
  const handleResetFullImage = () => {
    setCorners(getDefaultCorners(0.02));
    onNotify?.('ขยายกรอบครอบคลุมเต็มภาพแล้ว');
  };

  // Re-detect Corners ("ตรวจจับมุมใหม่")
  const handleRedetectCorners = () => {
    if (!loadedImgRef.current) return;
    const res = detectDocumentCorners(loadedImgRef.current);
    setCorners(orderQuadPoints(res.corners));
    onNotify?.(res.detected ? 'AI ตรวจจับมุมเอกสารทั้ง 4 มุมใหม่เรียบร้อย' : 'ตั้งค่ามุมเริ่มต้นอัตโนมัติ');
  };

  // Confirm 4-Point Perspective Homography Crop
  const handleConfirm = async () => {
    if (isWarping) return;
    setIsWarping(true);
    try {
      const ordered = orderQuadPoints(corners);
      const croppedDataUrl = await warpPerspectiveDocument(originalDataUrl, ordered);
      onConfirmCrop({
        corners: ordered,
        croppedDataUrl,
      });
    } catch (err) {
      console.error('Perspective crop error:', err);
      onNotify?.('เกิดข้อผิดพลาดในการดัดภาพ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsWarping(false);
    }
  };

  // Polygon SVG points in pixel space
  const polyPointsStr = corners
    .map((c) => `${(c.x * canvasBounds.width).toFixed(1)},${(c.y * canvasBounds.height).toFixed(1)}`)
    .join(' ');

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100 select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Top Bar */}
      <header
        className="flex items-center justify-between px-4 py-3 bg-slate-950/95 border-b border-slate-800/80"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <button
          id="crop-cancel-btn"
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 text-sm font-medium active:scale-95 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>ถ่ายใหม่</span>
        </button>

        <div className="text-center">
          <h2 className="text-sm font-bold text-slate-100">ปรับมุมกระดาษ 4 ด้าน</h2>
          <p className="text-[11px] text-slate-400">ใช้นิ้วลากจุดมุมพร้อมแว่นขยายซูมขอบ</p>
        </div>

        <div className="w-20 flex justify-end">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-[11px] text-emerald-300 font-medium">
            <Move className="w-3 h-3" /> 4-Point
          </span>
        </div>
      </header>

      {/* Interactive Crop Workspace */}
      <div
        ref={containerRef}
        className="relative flex-1 flex items-center justify-center overflow-hidden bg-slate-950 p-3"
      >
        <div
          className="relative inline-block touch-none shadow-2xl"
          style={{ width: canvasBounds.width, height: canvasBounds.height }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
        >
          {/* Base Image Canvas */}
          <canvas ref={imageCanvasRef} className="block rounded-lg" />

          {/* SVG Quadrilateral Overlay + Edge Midlines */}
          <svg
            width={canvasBounds.width}
            height={canvasBounds.height}
            className="absolute inset-0 pointer-events-none overflow-visible"
          >
            <defs>
              <mask id="crop-dim-mask">
                <rect x="0" y="0" width={canvasBounds.width} height={canvasBounds.height} fill="white" />
                <polygon points={polyPointsStr} fill="black" />
              </mask>
            </defs>

            {/* Dimmed area outside selected 4-corner polygon */}
            <rect
              x="0"
              y="0"
              width={canvasBounds.width}
              height={canvasBounds.height}
              fill="rgba(2, 6, 23, 0.58)"
              mask="url(#crop-dim-mask)"
            />

            {/* Glowing Green Polygon Outline */}
            <polygon
              points={polyPointsStr}
              fill="rgba(16, 185, 129, 0.10)"
              stroke="#22c55e"
              strokeWidth="3"
              strokeLinejoin="round"
            />
          </svg>

          {/* 4 Draggable Corner Handles */}
          {corners.map((c, idx) => {
            const leftPx = c.x * canvasBounds.width;
            const topPx = c.y * canvasBounds.height;
            const isActive = activeCornerIdx === idx;
            return (
              <div
                key={idx}
                id={`crop-corner-handle-${idx}`}
                style={{
                  left: `${leftPx}px`,
                  top: `${topPx}px`,
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  const touch = e.touches[0];
                  setActiveCornerIdx(idx);
                  if (touch) updateCornerFromClientXY(idx, touch.clientX, touch.clientY);
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setActiveCornerIdx(idx);
                  updateCornerFromClientXY(idx, e.clientX, e.clientY);
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing transition-transform ${
                  isActive ? 'scale-125 z-30' : 'z-20'
                }`}
              >
                {/* Outer Touch Ring */}
                <div
                  className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shadow-lg ${
                    isActive
                      ? 'bg-emerald-500/40 border-white ring-4 ring-emerald-400/50'
                      : 'bg-emerald-500/25 border-emerald-400'
                  }`}
                >
                  <div className="w-2.5 h-2.5 rounded-full bg-white" />
                </div>
              </div>
            );
          })}

          {/* Floating Magnifier Loupe (วงกลมแว่นขยายลอยเยื้องขึ้นด้านบนเหนือปลายนิ้ว) */}
          {activeCornerIdx !== null && (
            <div
              id="crop-magnifier-loupe"
              style={{
                left: `${loupeScreenPos.x}px`,
                top: `${loupeScreenPos.y}px`,
                width: `${LOUPE_SIZE}px`,
                height: `${LOUPE_SIZE}px`,
              }}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 z-40 rounded-full overflow-hidden border-[3px] border-emerald-400 shadow-2xl bg-slate-950 ring-4 ring-slate-950/90"
            >
              <canvas ref={loupeCanvasRef} className="w-full h-full block" />
              <div className="absolute bottom-1 inset-x-0 text-center">
                <span className="px-2 py-0.5 rounded-full bg-slate-950/85 text-[10px] font-semibold text-emerald-300 border border-emerald-500/40">
                  {CORNER_LABELS[activeCornerIdx]}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action Controls */}
      <footer
        className="bg-slate-950 border-t border-slate-800/80 px-4 pt-3 pb-5 space-y-3"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        {/* Secondary Quick Corner Tools: Auto Re-Detect & Reset Full Image */}
        <div className="max-w-md mx-auto grid grid-cols-2 gap-2.5">
          <button
            id="crop-redetect-btn"
            type="button"
            onClick={handleRedetectCorners}
            className="flex items-center justify-center gap-2 min-h-[46px] px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs sm:text-sm font-medium active:scale-95 transition"
          >
            <ScanLine className="w-4 h-4 text-emerald-400" />
            <span>ตรวจจับมุมใหม่</span>
          </button>

          <button
            id="crop-reset-full-btn"
            type="button"
            onClick={handleResetFullImage}
            className="flex items-center justify-center gap-2 min-h-[46px] px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs sm:text-sm font-medium active:scale-95 transition"
          >
            <Maximize2 className="w-4 h-4 text-amber-400" />
            <span>รีเซ็ตเต็มภาพ</span>
          </button>
        </div>

        {/* Primary Confirm Perspective Warp Button */}
        <div className="max-w-md mx-auto">
          <button
            id="crop-confirm-btn"
            type="button"
            disabled={isWarping}
            onClick={handleConfirm}
            className="w-full min-h-[52px] rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition"
          >
            {isWarping ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>กำลังดัดภาพหน้าตรง (Perspective Transform)...</span>
              </>
            ) : (
              <>
                <Check className="w-5 h-5 stroke-[2.5]" />
                <span>ตัดและดัดเอกสารหน้าตรง (ถัดไป)</span>
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
