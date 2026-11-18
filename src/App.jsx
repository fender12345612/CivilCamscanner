import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Camera,
  Image as ImageIcon,
  FileDown,
  Trash2,
  Sliders,
  FileText,
  ArrowLeft,
  ArrowRight,
  GripVertical,
  Sparkles,
  Cpu,
  Database,
  Copy,
  CheckCheck,
  Loader2,
  Plus,
  Share2,
  Scan,
  FolderPlus,
} from 'lucide-react';
import CameraScanner from './components/CameraScanner';
import PerspectiveCropper from './components/PerspectiveCropper';
import FilterEditor from './components/FilterEditor';
import ExportModal from './components/ExportModal';
import {
  getAllPages,
  savePage,
  saveAllPagesOrder,
  deletePageById,
  clearAllPages,
  getDocMeta,
  setDocMeta,
} from './services/db';
import {
  loadOpenCVAsync,
  subscribeOpenCVStatus,
  detectDocumentCorners,
  warpPerspectiveDocument,
  applyDocumentFilter,
  createSampleDocumentDataUrl,
  loadImageElement,
} from './services/vision';
import {
  runTesseractOCR,
  downloadPageAsJPG,
} from './services/exporter';

const FILTER_BADGE_NAMES = {
  original: 'ต้นฉบับ',
  magic: 'สีคมชัด (Magic)',
  grayscale: 'ขาว-เทา',
  bw: 'ขาว-ดำเอกสาร',
};

export default function App() {
  // Persisted pages in IndexedDB
  const [pages, setPages] = useState([]);
  const [docName, setDocName] = useState('เอกสารสแกน-CivilCamscanner');
  const [dbLoading, setDbLoading] = useState(true);

  // OpenCV.js Async Status ('idle' | 'loading' | 'ready' | 'fallback')
  const [cvStatus, setCvStatus] = useState('loading');

  // Workflow step: 'home' | 'camera' | 'crop' | 'filter'
  const [step, setStep] = useState('home');

  // Active draft page being scanned or edited
  const [draftPage, setDraftPage] = useState(null);

  // Export Modal & Quick OCR Modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [ocrModalPage, setOcrModalPage] = useState(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState({ status: '', progress: 0 });
  const [ocrCopied, setOcrCopied] = useState(false);

  // Drag-and-drop page index
  const [draggedIdx, setDraggedIdx] = useState(null);

  // Toast notification
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const galleryInputRef = useRef(null);

  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 3200);
  }, []);

  // Load OpenCV.js asynchronously + Load saved pages from IndexedDB
  useEffect(() => {
    const unsub = subscribeOpenCVStatus((status) => {
      setCvStatus(status);
    });
    loadOpenCVAsync();

    async function initFromIndexedDB() {
      try {
        const [storedPages, storedDocName] = await Promise.all([
          getAllPages(),
          getDocMeta('docName', 'เอกสารสแกน-CivilCamscanner'),
        ]);
        setPages(storedPages);
        if (storedDocName) setDocName(storedDocName);
      } catch (err) {
        console.error('Failed to load IndexedDB:', err);
      } finally {
        setDbLoading(false);
      }
    }
    initFromIndexedDB();

    return () => unsub();
  }, []);

  const handleDocNameChange = async (newName) => {
    setDocName(newName);
    await setDocMeta('docName', newName);
  };

  // Start new capture from CameraScanner
  const handleCameraCaptured = ({ originalDataUrl, corners }) => {
    setDraftPage({
      id: `page_${Date.now()}`,
      isNew: true,
      originalDataUrl,
      corners,
      croppedDataUrl: null,
      processedDataUrl: null,
      filter: 'magic',
      brightness: 0,
      contrast: 0,
      rotation: 0,
      ocrText: '',
      createdAt: Date.now(),
    });
    setStep('crop');
  };

  // Upload image directly from home screen gallery button
  const handleHomeGalleryUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result;
      if (typeof dataUrl === 'string') {
        const img = await loadImageElement(dataUrl);
        const detection = detectDocumentCorners(img);
        handleCameraCaptured({
          originalDataUrl: dataUrl,
          corners: detection.corners,
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Create and open a realistic Sample Civil Engineering Document for instant testing
  const handleCreateSampleScan = async (enterCropFirst = true) => {
    const sampleUrl = createSampleDocumentDataUrl(pages.length + 1);
    const img = await loadImageElement(sampleUrl);
    const detection = detectDocumentCorners(img);

    if (enterCropFirst) {
      handleCameraCaptured({
        originalDataUrl: sampleUrl,
        corners: detection.corners,
      });
      showToast('โหลดภาพเอกสารตัวอย่างแล้ว ลองใช้นิ้วลากมุมทั้ง 4 พร้อมแว่นขยายได้เลย!');
    } else {
      const croppedDataUrl = await warpPerspectiveDocument(sampleUrl, detection.corners);
      const processedDataUrl = await applyDocumentFilter(croppedDataUrl, {
        filter: 'magic',
        brightness: 0,
        contrast: 0,
        rotation: 0,
      });
      const newPage = {
        id: `page_${Date.now()}`,
        order: pages.length,
        originalDataUrl: sampleUrl,
        corners: detection.corners,
        croppedDataUrl,
        processedDataUrl,
        filter: 'magic',
        brightness: 0,
        contrast: 0,
        rotation: 0,
        ocrText: '',
        createdAt: Date.now(),
      };
      await savePage(newPage);
      setPages((prev) => [...prev, newPage]);
      showToast('เพิ่มหน้าเอกสารตัวอย่างลงใน IndexedDB เรียบร้อย');
    }
  };

  // After 4-Point Perspective Crop is confirmed
  const handleCropConfirmed = ({ corners, croppedDataUrl }) => {
    setDraftPage((prev) => ({
      ...prev,
      corners,
      croppedDataUrl,
    }));
    setStep('filter');
  };

  // After Filter & Adjustments are confirmed -> Persist to IndexedDB
  const handleSaveEditedPage = async ({
    processedDataUrl,
    filter,
    brightness,
    contrast,
    rotation,
    ocrText,
  }) => {
    if (!draftPage) return;

    const existingIdx = pages.findIndex((p) => p.id === draftPage.id);
    const pageToSave = {
      id: draftPage.id,
      order: existingIdx >= 0 ? pages[existingIdx].order : pages.length,
      originalDataUrl: draftPage.originalDataUrl,
      corners: draftPage.corners,
      croppedDataUrl: draftPage.croppedDataUrl,
      processedDataUrl,
      filter,
      brightness,
      contrast,
      rotation,
      ocrText: ocrText ?? draftPage.ocrText ?? '',
      createdAt: draftPage.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    await savePage(pageToSave);

    if (existingIdx >= 0) {
      setPages((prev) => prev.map((p, idx) => (idx === existingIdx ? pageToSave : p)));
      showToast(`อัปเดตหน้าที่ ${existingIdx + 1} ลงใน IndexedDB แล้ว`);
    } else {
      setPages((prev) => [...prev, pageToSave]);
      showToast(`บันทึกหน้าที่ ${pages.length + 1} ลงใน IndexedDB แล้ว`);
    }

    setDraftPage(null);
    setStep('home');
  };

  // Edit existing page retroactively (Filter or 4-Point Crop)
  const handleEditExistingPage = (page, startAt = 'filter') => {
    setDraftPage({
      ...page,
      isNew: false,
    });
    setStep(startAt);
  };

  // Delete a single page from IndexedDB
  const handleDeletePage = async (id, idx) => {
    await deletePageById(id);
    const remaining = pages.filter((p) => p.id !== id).map((p, i) => ({ ...p, order: i }));
    await saveAllPagesOrder(remaining);
    setPages(remaining);
    showToast(`ลบหน้าที่ ${idx + 1} เรียบร้อยแล้ว`);
  };

  // Clear all scanned pages
  const handleClearAll = async () => {
    if (pages.length === 0) return;
    await clearAllPages();
    setPages([]);
    showToast('ล้างหน้าเอกสารทั้งหมดแล้ว');
  };

  // Reorder pages via Move Left / Right or Drag-and-Drop
  const handleMovePage = async (fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= pages.length || fromIdx === toIdx) return;
    const updated = [...pages];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    const reindexed = updated.map((p, i) => ({ ...p, order: i }));
    setPages(reindexed);
    await saveAllPagesOrder(reindexed);
    showToast(`สลับลำดับหน้าเป็นหน้าที่ ${toIdx + 1} แล้ว`);
  };

  // Run Offline/Browser OCR on any page card directly from the workspace
  const handleOpenPageOCR = async (page) => {
    setOcrModalPage(page);
    if (page.ocrText && page.ocrText.trim().length > 0) {
      return;
    }
    await executePageOCR(page);
  };

  const executePageOCR = async (page) => {
    if (!page || ocrRunning) return;
    setOcrRunning(true);
    setOcrProgress({ status: 'กำลังโหลดโมเดลภาษาไทย (tha) + อังกฤษ (eng)...', progress: 5 });
    try {
      const imgSrc = page.processedDataUrl || page.croppedDataUrl || page.originalDataUrl;
      const text = await runTesseractOCR(imgSrc, (p) => setOcrProgress(p));
      const finalText = text || 'ไม่พบข้อความในหน้านี้';
      const updatedPage = { ...page, ocrText: finalText };
      await savePage(updatedPage);
      setPages((prev) => prev.map((p) => (p.id === page.id ? updatedPage : p)));
      setOcrModalPage(updatedPage);
      showToast('แปลงภาพเป็นข้อความ (OCR) เสร็จสมบูรณ์!');
    } catch (err) {
      console.error(err);
      showToast('เกิดข้อผิดพลาดในการรัน OCR');
    } finally {
      setOcrRunning(false);
    }
  };

  const handleCopyModalOCR = async () => {
    if (!ocrModalPage?.ocrText) return;
    try {
      await navigator.clipboard.writeText(ocrModalPage.ocrText);
      setOcrCopied(true);
      showToast('คัดลอกข้อความลงคลิปบอร์ดเรียบร้อย');
      setTimeout(() => setOcrCopied(false), 2000);
    } catch {
      showToast('กรุณากดค้างที่กล่องข้อความเพื่อคัดลอก');
    }
  };

  // Fullscreen Camera Scanner View
  if (step === 'camera') {
    return (
      <CameraScanner
        cvStatus={cvStatus}
        pageCount={pages.length}
        onCapture={handleCameraCaptured}
        onClose={() => setStep('home')}
        onNotify={showToast}
      />
    );
  }

  // Fullscreen 4-Point Perspective Cropper View with Magnifier Loupe
  if (step === 'crop' && draftPage) {
    return (
      <PerspectiveCropper
        originalDataUrl={draftPage.originalDataUrl}
        initialCorners={draftPage.corners}
        onConfirmCrop={handleCropConfirmed}
        onCancel={() => {
          if (draftPage.isNew) {
            setStep('camera');
          } else {
            setStep('home');
          }
        }}
        onNotify={showToast}
      />
    );
  }

  // Fullscreen Document Filter & Enhancement View
  if (step === 'filter' && draftPage) {
    return (
      <FilterEditor
        croppedDataUrl={draftPage.croppedDataUrl || draftPage.originalDataUrl}
        initialFilter={draftPage.filter}
        initialBrightness={draftPage.brightness}
        initialContrast={draftPage.contrast}
        initialRotation={draftPage.rotation}
        initialOcrText={draftPage.ocrText}
        onSavePage={handleSaveEditedPage}
        onRecrop={() => setStep('crop')}
        onCancel={() => setStep('crop')}
        onNotify={showToast}
      />
    );
  }

  // Main Multi-Page Workspace View
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-slate-950">
      {/* Top App Header */}
      <header
        className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shadow-inner">
              <Scan className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-white flex items-center gap-2">
                <span>CivilCamscanner</span>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  PWA Pro
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">
                สแกนเอกสาร 4 มุมอัตโนมัติ • ดัดหน้าตรง • OCR ไทย/อังกฤษ
              </p>
            </div>
          </div>

          {/* OpenCV.js & IndexedDB Status Pills */}
          <div className="flex items-center gap-2">
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-300"
              title="บันทึกข้อมูลความละเอียดสูงลงใน IndexedDB อัตโนมัติ"
            >
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span>IndexedDB พร้อม</span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px]">
              <Cpu
                className={`w-3.5 h-3.5 ${
                  cvStatus === 'ready'
                    ? 'text-emerald-400'
                    : cvStatus === 'loading'
                    ? 'text-amber-400 animate-spin'
                    : 'text-emerald-400'
                }`}
              />
              <span className="text-slate-300">
                {cvStatus === 'loading'
                  ? 'โหลด OpenCV...'
                  : cvStatus === 'ready'
                  ? 'OpenCV พร้อม'
                  : 'CV Engine พร้อม'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 pt-4 pb-32 space-y-5">
        {/* Document Name & Summary Bar */}
        <section className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor="workspace-doc-name" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              ชื่อแฟ้มเอกสาร (บันทึกอัตโนมัติใน IndexedDB)
            </label>
            <input
              id="workspace-doc-name"
              type="text"
              value={docName}
              onChange={(e) => handleDocNameChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-semibold text-slate-100 focus:outline-none focus:border-emerald-500"
              placeholder="ตั้งชื่อแฟ้มเอกสาร..."
            />
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2.5">
            <div className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300">
              จำนวนหน้า: <strong className="text-emerald-400 font-bold">{pages.length}</strong> หน้า
            </div>

            <button
              id="demo-sample-doc-btn"
              type="button"
              onClick={() => handleCreateSampleScan(true)}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-semibold active:scale-95 transition"
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>ทดสอบดัดมุมเอกสารตัวอย่าง</span>
            </button>

            {pages.length > 0 && (
              <button
                id="clear-all-pages-btn"
                type="button"
                onClick={handleClearAll}
                className="p-2.5 rounded-xl bg-slate-950 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 transition"
                title="ลบหน้าทั้งหมด"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </section>

        {/* Empty State or Multi-Page Grid */}
        {dbLoading ? (
          <div className="py-20 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto" />
            <p className="text-sm text-slate-400">กำลังโหลดหน้าเอกสารที่บันทึกไว้ใน IndexedDB...</p>
          </div>
        ) : pages.length === 0 ? (
          <section className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 sm:p-10 text-center space-y-6">
            <div className="w-20 h-20 rounded-3xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
              <Camera className="w-10 h-10 text-emerald-400" />
            </div>

            <div className="max-w-md mx-auto space-y-2">
              <h2 className="text-lg sm:text-xl font-bold text-white">
                เริ่มต้นสแกนเอกสารคมชัดระดับมืออาชีพ
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                ตรวจจับขอบกระดาษ 4 มุมแบบ Real-time พร้อมโหมดลั่นชัตเตอร์อัตโนมัติ (Auto-Snap 1.5s),
                แว่นขยายช่วยเล็งมุม, ฟิลเตอร์ลบเงา Magic Color และแปลงภาพเป็นข้อความภาษาไทย/อังกฤษ
              </p>
            </div>

            <div className="max-w-md mx-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                id="empty-start-camera-btn"
                type="button"
                onClick={() => setStep('camera')}
                className="min-h-[54px] rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-95 transition"
              >
                <Camera className="w-5 h-5" />
                <span>เปิดกล้องสแกนเอกสาร</span>
              </button>

              <button
                id="empty-try-sample-btn"
                type="button"
                onClick={() => handleCreateSampleScan(true)}
                className="min-h-[54px] rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
              >
                <FolderPlus className="w-5 h-5 text-amber-400" />
                <span>ทดลองด้วยเอกสารตัวอย่าง</span>
              </button>
            </div>

            {/* Feature Pills */}
            <div className="pt-2 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400">
              <span className="px-3 py-1 rounded-full bg-slate-950 border border-slate-800">
                1. กล้องหลัง HD + กรอบสีเขียวเรืองแสง
              </span>
              <span className="px-3 py-1 rounded-full bg-slate-950 border border-slate-800">
                2. ดัดมุม 4 ด้านพร้อมแว่นขยาย (Loupe)
              </span>
              <span className="px-3 py-1 rounded-full bg-slate-950 border border-slate-800">
                3. Magic Color & Adaptive B&W
              </span>
              <span className="px-3 py-1 rounded-full bg-slate-950 border border-slate-800">
                4. ส่งออก PDF (A4) & OCR ไทย+อังกฤษ
              </span>
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <span>รายการหน้าที่สแกน ({pages.length} หน้า)</span>
                <span className="text-xs font-normal text-slate-400">
                  • ลากสลับลำดับ หรือกดเพื่อแก้ไขฟิลเตอร์ย้อนหลังได้
                </span>
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {pages.map((page, idx) => (
                <article
                  key={page.id}
                  draggable
                  onDragStart={() => setDraggedIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedIdx !== null && draggedIdx !== idx) {
                      handleMovePage(draggedIdx, idx);
                    }
                    setDraggedIdx(null);
                  }}
                  className={`group bg-slate-900 border rounded-2xl overflow-hidden flex flex-col transition shadow-lg ${
                    draggedIdx === idx
                      ? 'border-emerald-400 opacity-60 scale-95'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Card Top Bar: Page Order & Reorder Controls */}
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-950/80 border-b border-slate-800/80">
                    <div className="flex items-center gap-1.5">
                      <GripVertical className="w-4 h-4 text-slate-500 cursor-grab" />
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-xs font-bold">
                        หน้าที่ {idx + 1}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {FILTER_BADGE_NAMES[page.filter] || 'Magic'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        id={`move-page-left-${idx}`}
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMovePage(idx, idx - 1)}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-slate-300"
                        title="เลื่อนขึ้น/ไปทางซ้าย"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        id={`move-page-right-${idx}`}
                        type="button"
                        disabled={idx === pages.length - 1}
                        onClick={() => handleMovePage(idx, idx + 1)}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-slate-300"
                        title="เลื่อนลง/ไปทางขวา"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        id={`delete-page-${idx}`}
                        type="button"
                        onClick={() => handleDeletePage(page.id, idx)}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/80 text-slate-400 hover:text-rose-300"
                        title="ลบหน้านี้"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Page Thumbnail Preview (Click to re-edit filter) */}
                  <div
                    onClick={() => handleEditExistingPage(page, 'filter')}
                    className="relative aspect-[3/4] bg-slate-950 flex items-center justify-center p-2.5 cursor-pointer overflow-hidden"
                  >
                    <img
                      src={page.processedDataUrl || page.croppedDataUrl || page.originalDataUrl}
                      alt={`เอกสารสแกนหน้าที่ ${idx + 1}`}
                      className="max-w-full max-h-full object-contain rounded shadow-md group-hover:scale-[1.02] transition-transform"
                    />
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute inset-0 bg-slate-950/50 flex items-center justify-center">
                      <span className="px-3 py-1.5 rounded-xl bg-slate-900/95 border border-slate-700 text-xs font-semibold text-emerald-300 flex items-center gap-1.5 shadow-lg">
                        <Sliders className="w-3.5 h-3.5" />
                        กดเพื่อแก้ไขฟิลเตอร์ / มุม
                      </span>
                    </div>
                  </div>

                  {/* Card Bottom Action Buttons */}
                  <div className="p-2.5 bg-slate-900 border-t border-slate-800/80 grid grid-cols-3 gap-1.5">
                    <button
                      id={`edit-page-filter-${idx}`}
                      type="button"
                      onClick={() => handleEditExistingPage(page, 'filter')}
                      className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 text-[11px] font-semibold active:scale-95 transition"
                    >
                      <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                      <span>ฟิลเตอร์</span>
                    </button>

                    <button
                      id={`ocr-page-btn-${idx}`}
                      type="button"
                      onClick={() => handleOpenPageOCR(page)}
                      className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-amber-300 text-[11px] font-semibold active:scale-95 transition"
                    >
                      <FileText className="w-3.5 h-3.5 text-amber-400" />
                      <span>OCR ข้อความ</span>
                    </button>

                    <button
                      id={`jpg-page-btn-${idx}`}
                      type="button"
                      onClick={() =>
                        downloadPageAsJPG(page, `${docName || 'CivilCamscanner'}-Page-${idx + 1}.jpg`)
                      }
                      className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 text-[11px] font-semibold active:scale-95 transition"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                      <span>บันทึก JPG</span>
                    </button>
                  </div>
                </article>
              ))}

              {/* Add New Page Card */}
              <button
                id="grid-add-page-btn"
                type="button"
                onClick={() => setStep('camera')}
                className="min-h-[260px] rounded-2xl border-2 border-dashed border-slate-800 hover:border-emerald-500/60 bg-slate-900/40 hover:bg-slate-900/80 flex flex-col items-center justify-center gap-3 p-6 text-slate-400 hover:text-emerald-300 transition active:scale-[0.99]"
              >
                <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                  <Plus className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="text-center">
                  <span className="block text-sm font-bold text-slate-200">สแกนเพิ่มหน้าใหม่</span>
                  <span className="text-xs text-slate-400">ถ่ายจากกล้อง หรืออัปโหลดรูปภาพ</span>
                </div>
              </button>
            </div>
          </section>
        )}
      </main>

      {/* Hidden File Input for Quick Gallery Upload */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleHomeGalleryUpload}
        className="hidden"
      />

      {/* Sticky Bottom One-Handed Mobile Bar (Supports env(safe-area-inset-bottom)) */}
      <footer
        className="fixed bottom-0 inset-x-0 z-30 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/90 px-4 pt-3 pb-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="max-w-lg mx-auto grid grid-cols-12 gap-2.5 items-center">
          {/* Upload from Gallery */}
          <button
            id="bottom-upload-gallery-btn"
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="col-span-3 min-h-[52px] rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition"
          >
            <ImageIcon className="w-5 h-5 text-emerald-400" />
            <span className="text-[11px] font-semibold">แกลเลอรี</span>
          </button>

          {/* Primary Open Camera Scan Button */}
          <button
            id="bottom-open-camera-btn"
            type="button"
            onClick={() => setStep('camera')}
            className="col-span-5 min-h-[52px] rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 active:scale-95 transition"
          >
            <Camera className="w-5 h-5 stroke-[2.5]" />
            <span>สแกนหน้าใหม่</span>
          </button>

          {/* Export PDF / Share Button */}
          <button
            id="bottom-export-pdf-btn"
            type="button"
            disabled={pages.length === 0}
            onClick={() => setShowExportModal(true)}
            className="col-span-4 min-h-[52px] rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-emerald-500/40 text-emerald-300 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 active:scale-95 transition"
          >
            <FileDown className="w-4 h-4 text-emerald-400" />
            <span>ส่งออก PDF</span>
          </button>
        </div>
      </footer>

      {/* Export PDF & Native Share Modal */}
      {showExportModal && (
        <ExportModal
          pages={pages}
          defaultDocName={docName}
          onUpdateDocName={handleDocNameChange}
          onClose={() => setShowExportModal(false)}
          onNotify={showToast}
        />
      )}

      {/* Workspace Quick OCR Modal (Tesseract.js tha + eng) */}
      {ocrModalPage && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    แปลงภาพเป็นข้อความ (OCR ภาษาไทย + อังกฤษ)
                  </h3>
                  <p className="text-[11px] text-slate-400">Tesseract.js Offline/Browser OCR (tha+eng)</p>
                </div>
              </div>
              <button
                id="workspace-ocr-close-btn"
                type="button"
                onClick={() => setOcrModalPage(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
              >
                ปิด
              </button>
            </div>

            {ocrRunning ? (
              <div className="py-8 space-y-3 text-center">
                <Loader2 className="w-8 h-8 text-amber-400 animate-spin mx-auto" />
                <p className="text-xs font-medium text-slate-200">
                  {ocrProgress.status} ({ocrProgress.progress}%)
                </p>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all"
                    style={{ width: `${Math.max(8, ocrProgress.progress)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <textarea
                  id="workspace-ocr-textarea"
                  rows={7}
                  value={ocrModalPage.ocrText || ''}
                  onChange={async (e) => {
                    const nextText = e.target.value;
                    const updated = { ...ocrModalPage, ocrText: nextText };
                    setOcrModalPage(updated);
                    await savePage(updated);
                    setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
                  }}
                  className="w-full rounded-2xl bg-slate-950 border border-slate-800 p-3.5 text-xs sm:text-sm text-slate-100 leading-relaxed focus:outline-none focus:border-emerald-500"
                  placeholder="ข้อความจากเอกสาร..."
                />

                <div className="flex items-center gap-2.5">
                  <button
                    id="workspace-ocr-copy-btn"
                    type="button"
                    onClick={handleCopyModalOCR}
                    className="flex-1 min-h-[46px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-95 transition"
                  >
                    {ocrCopied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{ocrCopied ? 'คัดลอกเรียบร้อยแล้ว!' : 'คัดลอกข้อความ'}</span>
                  </button>

                  <button
                    id="workspace-ocr-rerun-btn"
                    type="button"
                    onClick={() => executePageOCR(ocrModalPage)}
                    className="min-h-[46px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold active:scale-95 transition"
                  >
                    วิเคราะห์ซ้ำ
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-slate-900/95 border border-emerald-500/50 text-emerald-200 text-xs font-semibold shadow-2xl backdrop-blur-md">
          {toast}
        </div>
      )}
    </div>
  );
}
