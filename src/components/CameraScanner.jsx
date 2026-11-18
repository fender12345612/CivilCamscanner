import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  Zap,
  ZapOff,
  Image as ImageIcon,
  Sparkles,
  X,
  RefreshCw,
  FileText,
  CheckCircle2,
  Cpu,
} from 'lucide-react';
import {
  detectDocumentCorners,
  calculateCornerStability,
  lerpCorners,
  getDefaultCorners,
  createSampleDocumentDataUrl,
  loadImageElement,
} from '../services/vision';

const AUTO_SNAP_DURATION_MS = 1500; // 1.5 seconds continuous stability

export default function CameraScanner({
  cvStatus,
  onCapture,
  onClose,
  pageCount = 0,
  onNotify,
}) {
  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const simCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [simulationMode, setSimulationMode] = useState(false);
  const [autoSnap, setAutoSnap] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [autoSnapProgress, setAutoSnapProgress] = useState(0);
  const [edgeDetected, setEdgeDetected] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);

  const smoothedCornersRef = useRef(getDefaultCorners(0.12));
  const stableStartRef = useRef(null);
  const lastStableCornersRef = useRef(null);
  const isCapturingRef = useRef(false);
  const sampleImgRef = useRef(null);

  // Stop existing media tracks cleanly
  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Initialize Rear Camera (1920x1080 ideal, environment facingMode)
  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraReady(false);
    stopCameraStream();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('เบราว์เซอร์ไม่รองรับการเปิดกล้องโดยตรง กรุณาใช้โหมดจำลองกล้องสดหรืออัปโหลดรูปภาพ');
      setSimulationMode(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
        const caps = videoTrack.getCapabilities();
        if (caps && 'torch' in caps) {
          setTorchSupported(true);
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('muted', 'true');
        videoRef.current.setAttribute('autoplay', 'true');
        await videoRef.current.play();
        setCameraReady(true);
        setSimulationMode(false);
      }
    } catch (err) {
      console.warn('Camera access fallback to live simulation mode:', err);
      setCameraError('ไม่สามารถเข้าถึงกล้องหลังได้ (เปิดโหมดจำลองกล้องสแกนสดอัตโนมัติ)');
      setSimulationMode(true);
    }
  }, [stopCameraStream]);

  useEffect(() => {
    // Pre-generate sample image for simulation mode
    const sampleUrl = createSampleDocumentDataUrl(pageCount + 1);
    loadImageElement(sampleUrl).then((img) => {
      sampleImgRef.current = img;
    });

    startCamera();
    return () => {
      stopCameraStream();
    };
  }, [startCamera, stopCameraStream, pageCount]);

  // Toggle hardware Torch / Flashlight
  const handleToggleTorch = async () => {
    if (!streamRef.current) {
      onNotify?.('ไฟฉายใช้งานได้เมื่อเชื่อมต่อกล้องจริงของมือถือ');
      return;
    }
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextState = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setTorchOn(nextState);
      onNotify?.(nextState ? 'เปิดไฟฉายแล้ว' : 'ปิดไฟฉายแล้ว');
    } catch {
      onNotify?.('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการสั่งเปิดไฟฉาย (Torch Constraint)');
    }
  };

  // Trigger Shutter (Manual or Auto-Snap)
  const triggerCapture = useCallback(async () => {
    if (isCapturingRef.current) return;
    isCapturingRef.current = true;
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 180);

    try {
      let dataUrl = null;
      let detectedCorners = smoothedCornersRef.current || getDefaultCorners(0.1);

      if (!simulationMode && videoRef.current && videoRef.current.videoWidth > 0) {
        const video = videoRef.current;
        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = video.videoWidth;
        captureCanvas.height = video.videoHeight;
        const ctx = captureCanvas.getContext('2d');
        ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
        dataUrl = captureCanvas.toDataURL('image/jpeg', 0.95);
        const res = detectDocumentCorners(captureCanvas);
        if (res.detected) {
          detectedCorners = res.corners;
        }
      } else if (simCanvasRef.current && simCanvasRef.current.width > 0) {
        dataUrl = simCanvasRef.current.toDataURL('image/jpeg', 0.95);
        const res = detectDocumentCorners(simCanvasRef.current);
        if (res.detected) {
          detectedCorners = res.corners;
        }
      } else {
        dataUrl = createSampleDocumentDataUrl(pageCount + 1);
        const img = await loadImageElement(dataUrl);
        const res = detectDocumentCorners(img);
        detectedCorners = res.corners;
      }

      stopCameraStream();
      onCapture({
        originalDataUrl: dataUrl,
        corners: detectedCorners,
      });
    } finally {
      isCapturingRef.current = false;
    }
  }, [simulationMode, pageCount, stopCameraStream, onCapture]);

  // Real-time Edge Detection + Glowing Green Quad Overlay + 1.5s Auto-Snap Loop
  useEffect(() => {
    let rafId = null;
    let lastDetectionTime = 0;

    const renderLoop = (timestamp) => {
      // 1. If in Simulation Mode, animate a gentle handheld breathing motion on simCanvas
      if (simulationMode && simCanvasRef.current && sampleImgRef.current) {
        const simCanvas = simCanvasRef.current;
        const img = sampleImgRef.current;
        if (simCanvas.width !== 720 || simCanvas.height !== 960) {
          simCanvas.width = 720;
          simCanvas.height = 960;
        }
        const sctx = simCanvas.getContext('2d');
        sctx.fillStyle = '#0b0f17';
        sctx.fillRect(0, 0, simCanvas.width, simCanvas.height);

        const swayX = Math.sin(timestamp * 0.0018) * 3.5;
        const swayY = Math.cos(timestamp * 0.0015) * 3.5;
        sctx.save();
        sctx.translate(simCanvas.width / 2 + swayX, simCanvas.height / 2 + swayY);
        sctx.drawImage(img, -simCanvas.width / 2, -simCanvas.height / 2, simCanvas.width, simCanvas.height);
        sctx.restore();
      }

      const activeSource = !simulationMode && cameraReady ? videoRef.current : simCanvasRef.current;
      const overlay = overlayCanvasRef.current;

      if (activeSource && overlay) {
        const rect = activeSource.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          if (overlay.width !== Math.round(rect.width) || overlay.height !== Math.round(rect.height)) {
            overlay.width = Math.round(rect.width);
            overlay.height = Math.round(rect.height);
          }

          // Run edge detection every ~65ms (~15 FPS CV analysis, 60 FPS smooth drawing)
          if (timestamp - lastDetectionTime > 65) {
            lastDetectionTime = timestamp;
            const detection = detectDocumentCorners(activeSource);
            setEdgeDetected(detection.detected);

            if (detection.detected) {
              const smoothed = lerpCorners(smoothedCornersRef.current, detection.corners, 0.38);
              smoothedCornersRef.current = smoothed;

              // Check stability for 1.5s Auto-Snap
              if (autoSnap && !isCapturingRef.current) {
                const delta = calculateCornerStability(lastStableCornersRef.current, smoothed);
                if (delta < 0.028) {
                  if (!stableStartRef.current) {
                    stableStartRef.current = timestamp;
                  }
                  const elapsed = timestamp - stableStartRef.current;
                  const pct = Math.min(100, Math.round((elapsed / AUTO_SNAP_DURATION_MS) * 100));
                  setAutoSnapProgress(pct);

                  if (elapsed >= AUTO_SNAP_DURATION_MS) {
                    stableStartRef.current = null;
                    setAutoSnapProgress(0);
                    triggerCapture();
                    return;
                  }
                } else {
                  lastStableCornersRef.current = smoothed;
                  stableStartRef.current = timestamp;
                  setAutoSnapProgress(0);
                }
              } else {
                stableStartRef.current = null;
                setAutoSnapProgress(0);
              }
            } else {
              stableStartRef.current = null;
              setAutoSnapProgress(0);
            }
          }

          // Draw Glowing Green Quadrilateral Overlay on Canvas
          const ctx = overlay.getContext('2d');
          ctx.clearRect(0, 0, overlay.width, overlay.height);

          const pts = smoothedCornersRef.current.map((p) => ({
            x: p.x * overlay.width,
            y: p.y * overlay.height,
          }));

          ctx.save();
          // Semi-transparent emerald fill inside detected paper
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.lineTo(pts[2].x, pts[2].y);
          ctx.lineTo(pts[3].x, pts[3].y);
          ctx.closePath();

          ctx.fillStyle = edgeDetected ? 'rgba(16, 185, 129, 0.16)' : 'rgba(148, 163, 184, 0.08)';
          ctx.fill();

          // Glowing Neon Green Border
          ctx.shadowColor = edgeDetected ? '#10b981' : 'transparent';
          ctx.shadowBlur = edgeDetected ? 18 : 0;
          ctx.strokeStyle = edgeDetected ? '#22c55e' : 'rgba(148, 163, 184, 0.45)';
          ctx.lineWidth = edgeDetected ? 3.5 : 2;
          ctx.lineJoin = 'round';
          ctx.stroke();

          // Corner Target Markers
          pts.forEach((pt) => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, edgeDetected ? 8 : 5, 0, Math.PI * 2);
            ctx.fillStyle = edgeDetected ? '#22c55e' : '#94a3b8';
            ctx.fill();
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
          });
          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [simulationMode, cameraReady, autoSnap, edgeDetected, triggerCapture]);

  // Handle Gallery Upload
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result;
      if (typeof dataUrl === 'string') {
        const img = await loadImageElement(dataUrl);
        const detection = detectDocumentCorners(img);
        stopCameraStream();
        onCapture({
          originalDataUrl: dataUrl,
          corners: detection.corners,
        });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100 select-none">
      {/* Top Camera Control Bar */}
      <header
        className="flex items-center justify-between px-4 py-3 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <button
          id="camera-close-btn"
          type="button"
          onClick={() => {
            stopCameraStream();
            onClose();
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 text-sm font-medium active:scale-95 transition"
        >
          <X className="w-4 h-4" />
          <span>กลับ</span>
        </button>

        {/* OpenCV.js Async Engine Status Badge */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs font-medium">
          <Cpu className={`w-3.5 h-3.5 ${cvStatus === 'ready' ? 'text-emerald-400' : 'text-amber-400 animate-spin'}`} />
          <span className="text-slate-300">
            {cvStatus === 'loading'
              ? 'กำลังโหลด OpenCV.js...'
              : cvStatus === 'ready'
              ? 'OpenCV.js + AI Edge พร้อม'
              : 'CV Edge Engine พร้อม'}
          </span>
        </div>

        {/* Torch / Flashlight Toggle */}
        <button
          id="camera-torch-btn"
          type="button"
          onClick={handleToggleTorch}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition active:scale-95 ${
            torchOn
              ? 'bg-amber-500/20 border-amber-400 text-amber-300'
              : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
          }`}
          title={torchSupported ? 'เปิด/ปิดไฟฉาย' : 'เปิด/ปิดไฟฉาย (เฉพาะมือถือที่รองรับ)'}
        >
          {torchOn ? <Zap className="w-4 h-4 text-amber-400" /> : <ZapOff className="w-4 h-4" />}
          <span className="hidden xs:inline">ไฟฉาย</span>
        </button>
      </header>

      {/* Main Live Viewfinder + Real-time Glowing Green Edge Overlay */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
        {/* Live Video Element with iOS Safari attributes: playsInline muted autoPlay */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-contain ${simulationMode ? 'hidden' : 'block'}`}
        />

        {/* Interactive Live Simulation Canvas when testing without a rear camera or in demo mode */}
        <canvas
          ref={simCanvasRef}
          className={`w-full h-full object-contain ${simulationMode ? 'block' : 'hidden'}`}
        />

        {/* Real-time Glowing Green Edge Overlay Canvas */}
        <canvas
          ref={overlayCanvasRef}
          className="pointer-events-none absolute inset-0 m-auto"
        />

        {/* Shutter Flash Effect */}
        {shutterFlash && <div className="pointer-events-none absolute inset-0 bg-white/80 z-30 transition-opacity" />}

        {/* Top Floating Status Pill */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 w-[92%] max-w-sm">
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-2xl backdrop-blur-md border text-xs sm:text-sm font-medium shadow-lg transition ${
              edgeDetected
                ? 'bg-emerald-950/85 border-emerald-500/60 text-emerald-200'
                : 'bg-slate-900/85 border-slate-700/70 text-slate-300'
            }`}
          >
            <CheckCircle2 className={`w-4 h-4 shrink-0 ${edgeDetected ? 'text-emerald-400' : 'text-slate-400'}`} />
            <span>
              {edgeDetected
                ? autoSnap
                  ? `ตรวจพบขอบกระดาษ 4 มุม — ถือค้างไว้ (${((autoSnapProgress / 100) * 1.5).toFixed(1)} / 1.5s)`
                  : 'ตรวจพบขอบกระดาษ 4 มุมพร้อมถ่าย'
                : 'เล็งเอกสารให้อยู่ในกรอบเพื่อตรวจจับขอบกระดาษอัตโนมัติ'}
            </span>
          </div>

          {/* Auto-Snap 1.5s Progress Bar */}
          {autoSnap && edgeDetected && autoSnapProgress > 0 && (
            <div className="w-48 h-1.5 bg-slate-800/90 rounded-full overflow-hidden border border-emerald-500/30">
              <div
                className="h-full bg-emerald-400 transition-all duration-75"
                style={{ width: `${autoSnapProgress}%` }}
              />
            </div>
          )}

          {cameraError && (
            <div className="px-3 py-1 rounded-lg bg-amber-950/80 border border-amber-500/40 text-amber-200 text-[11px] text-center">
              {cameraError}
            </div>
          )}
        </div>

        {/* Mode Switcher Pill (Real Camera vs Live Demo Document Stream) */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-slate-900/85 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-700/70">
          <button
            id="switch-live-camera-btn"
            type="button"
            onClick={() => {
              setSimulationMode(false);
              startCamera();
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium transition ${
              !simulationMode ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            กล้องจริง (Camera)
          </button>
          <button
            id="switch-demo-stream-btn"
            type="button"
            onClick={() => {
              stopCameraStream();
              setSimulationMode(true);
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium transition flex items-center gap-1 ${
              simulationMode ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>จำลองสแกนสด</span>
          </button>
        </div>
      </div>

      {/* Bottom One-Handed Ergonomic Control Bar */}
      <footer
        className="bg-slate-950 border-t border-slate-800/80 px-5 pt-4 pb-5"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="max-w-md mx-auto flex items-center justify-between gap-4">
          {/* Gallery Upload Button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            id="camera-gallery-upload-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1 w-20 min-h-[60px] rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 active:scale-95 transition"
          >
            <ImageIcon className="w-5 h-5 text-emerald-400" />
            <span className="text-[11px] font-medium">แกลเลอรี</span>
          </button>

          {/* Main Shutter Button with Auto-Snap Progress Ring */}
          <div className="relative flex items-center justify-center">
            <button
              id="camera-shutter-btn"
              type="button"
              onClick={triggerCapture}
              aria-label="ถ่ายภาพสแกนเอกสาร"
              className="relative w-20 h-20 rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-90 transition flex items-center justify-center shadow-lg shadow-emerald-500/30 ring-4 ring-slate-800"
            >
              <div className="w-16 h-16 rounded-full border-2 border-slate-950/60 flex items-center justify-center">
                <Camera className="w-8 h-8 text-slate-950" />
              </div>
            </button>
          </div>

          {/* Auto-Snap 1.5s Toggle Button */}
          <button
            id="camera-autosnap-toggle-btn"
            type="button"
            onClick={() => {
              const next = !autoSnap;
              setAutoSnap(next);
              stableStartRef.current = null;
              setAutoSnapProgress(0);
              onNotify?.(next ? 'เปิดโหมด Auto-Snap (ลั่นชัตเตอร์เมื่อนิ่ง 1.5 วินาที)' : 'ปิดโหมด Auto-Snap');
            }}
            className={`flex flex-col items-center justify-center gap-1 w-20 min-h-[60px] rounded-2xl border active:scale-95 transition ${
              autoSnap
                ? 'bg-emerald-950/80 border-emerald-500/70 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
            }`}
          >
            <Sparkles className={`w-5 h-5 ${autoSnap ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className="text-[11px] font-semibold">Auto-Snap</span>
            <span className="text-[10px] opacity-80">{autoSnap ? 'เปิด (1.5s)' : 'ปิด'}</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
