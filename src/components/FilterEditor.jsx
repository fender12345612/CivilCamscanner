import React, { useEffect, useState } from 'react';
import {
  RotateCw,
  Sun,
  Contrast,
  Check,
  ArrowLeft,
  Sparkles,
  FileText,
  Copy,
  CheckCheck,
  Loader2,
  Crop,
  RotateCcw,
} from 'lucide-react';
import { applyDocumentFilter } from '../services/vision';
import { runTesseractOCR } from '../services/exporter';

const FILTER_MODES = [
  {
    id: 'original',
    label: 'ต้นฉบับ',
    sub: 'Original',
    desc: 'สีจริงตามธรรมชาติหลังดัดหน้าตรง',
  },
  {
    id: 'magic',
    label: 'สีคมชัด',
    sub: 'Magic Color',
    desc: 'ลบเงามืด พื้นขาว คงสีลายเซ็นและตราประทับ',
  },
  {
    id: 'grayscale',
    label: 'ขาว-เทา',
    sub: 'Grayscale',
    desc: 'โทนสีเทาไล่ระดับคมชัด',
  },
  {
    id: 'bw',
    label: 'ขาว-ดำเอกสาร',
    sub: 'Adaptive B&W',
    desc: 'ตัดพื้นขาวสะอาด ตัวหนังสือดำคมกริบเหมือนถ่ายเอกสาร',
  },
];

export default function FilterEditor({
  croppedDataUrl,
  initialFilter = 'magic',
  initialBrightness = 0,
  initialContrast = 0,
  initialRotation = 0,
  initialOcrText = '',
  onSavePage,
  onRecrop,
  onCancel,
  onNotify,
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [brightness, setBrightness] = useState(initialBrightness);
  const [contrast, setContrast] = useState(initialContrast);
  const [rotation, setRotation] = useState(initialRotation);
  const [previewDataUrl, setPreviewDataUrl] = useState(croppedDataUrl);
  const [isProcessing, setIsProcessing] = useState(false);

  // OCR Modal / Drawer state
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState({ status: '', progress: 0 });
  const [ocrText, setOcrText] = useState(initialOcrText || '');
  const [copied, setCopied] = useState(false);

  // Re-compute processed preview whenever filter, brightness, contrast, or rotation changes
  useEffect(() => {
    let cancelled = false;
    setIsProcessing(true);

    const timer = setTimeout(async () => {
      try {
        const result = await applyDocumentFilter(croppedDataUrl, {
          filter,
          brightness,
          contrast,
          rotation,
        });
        if (!cancelled) {
          setPreviewDataUrl(result);
        }
      } catch (err) {
        console.error('Filter error:', err);
      } finally {
        if (!cancelled) {
          setIsProcessing(false);
        }
      }
    }, 60);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [croppedDataUrl, filter, brightness, contrast, rotation]);

  const handleRotate90 = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleResetAdjustments = () => {
    setBrightness(0);
    setContrast(0);
    setRotation(0);
    onNotify?.('รีเซ็ตความสว่าง ความคมชัด และการหมุนภาพแล้ว');
  };

  const handleRunOCR = async () => {
    setOcrOpen(true);
    if (ocrLoading) return;
    setOcrLoading(true);
    setOcrProgress({ status: 'กำลังเตรียมโมเดลภาษาไทย + อังกฤษ (tha+eng)...', progress: 5 });
    try {
      const text = await runTesseractOCR(previewDataUrl, (p) => {
        setOcrProgress(p);
      });
      setOcrText(text || 'ไม่พบข้อความในภาพ หรือภาพอาจไม่ชัดเจน');
      onNotify?.('แปลงภาพเป็นข้อความ (OCR) สำเร็จ');
    } catch (err) {
      console.error('OCR error:', err);
      setOcrText('เกิดข้อผิดพลาดในการแปลงภาพเป็นข้อความ กรุณาตรวจสอบการเชื่อมต่อหรือลองใหม่อีกครั้ง');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleCopyOcr = async () => {
    if (!ocrText) return;
    try {
      await navigator.clipboard.writeText(ocrText);
      setCopied(true);
      onNotify?.('คัดลอกข้อความลงคลิปบอร์ดแล้ว');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify?.('ไม่สามารถคัดลอกอัตโนมัติได้ กรุณากดค้างที่ข้อความเพื่อคัดลอก');
    }
  };

  const handleConfirmSave = () => {
    onSavePage({
      processedDataUrl: previewDataUrl,
      filter,
      brightness,
      contrast,
      rotation,
      ocrText,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100 select-none">
      {/* Top Bar */}
      <header
        className="flex items-center justify-between px-4 py-3 bg-slate-950/95 border-b border-slate-800/80"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-2">
          <button
            id="editor-back-btn"
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-medium active:scale-95 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>กลับ</span>
          </button>

          {onRecrop && (
            <button
              id="editor-recrop-btn"
              type="button"
              onClick={onRecrop}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-emerald-300 text-xs sm:text-sm font-medium active:scale-95 transition"
            >
              <Crop className="w-4 h-4" />
              <span>ปรับมุม 4 ด้าน</span>
            </button>
          )}
        </div>

        <button
          id="editor-ocr-btn"
          type="button"
          onClick={handleRunOCR}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/50 text-amber-300 text-xs sm:text-sm font-semibold active:scale-95 transition"
        >
          <FileText className="w-4 h-4 text-amber-400" />
          <span>แปลงภาพเป็นข้อความ (OCR)</span>
        </button>
      </header>

      {/* Main Document Preview Area */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-slate-950 p-4">
        <div className="relative max-w-full max-h-full flex items-center justify-center">
          <img
            src={previewDataUrl}
            alt="ตัวอย่างเอกสารที่ผ่านฟิลเตอร์"
            className="max-h-[46vh] sm:max-h-[52vh] w-auto object-contain rounded-lg shadow-2xl border border-slate-800"
          />
          {isProcessing && (
            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px] rounded-lg flex items-center justify-center">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 border border-slate-700 text-xs font-medium text-emerald-300 shadow-lg">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>กำลังปรับความคมชัด...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls Drawer: 4 Filter Presets + Brightness/Contrast/Rotate90 */}
      <footer
        className="bg-slate-900/95 border-t border-slate-800 px-4 pt-3.5 pb-5 space-y-3.5"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="max-w-lg mx-auto space-y-3">
          {/* 4 Filter Mode Buttons */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                โหมดฟิลเตอร์เอกสาร (4 โหมด)
              </span>
              <span className="text-[11px] text-slate-400">
                {FILTER_MODES.find((m) => m.id === filter)?.desc}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {FILTER_MODES.map((mode) => {
                const active = filter === mode.id;
                return (
                  <button
                    key={mode.id}
                    id={`filter-mode-${mode.id}-btn`}
                    type="button"
                    onClick={() => setFilter(mode.id)}
                    className={`flex flex-col items-center justify-center py-2.5 px-1.5 rounded-xl border text-center transition active:scale-95 ${
                      active
                        ? 'bg-emerald-950/90 border-emerald-400 text-emerald-200 shadow-md shadow-emerald-500/10'
                        : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span className="text-xs font-bold leading-tight">{mode.label}</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">{mode.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sliders: Brightness, Contrast & Rotate 90° */}
          <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-3 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Brightness Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="brightness-slider" className="flex items-center gap-1.5 text-slate-300 font-medium">
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>ความสว่าง (Brightness)</span>
                  </label>
                  <span className="text-emerald-400 font-mono text-[11px]">
                    {brightness > 0 ? `+${brightness}` : brightness}
                  </span>
                </div>
                <input
                  id="brightness-slider"
                  type="range"
                  min="-60"
                  max="60"
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Contrast Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="contrast-slider" className="flex items-center gap-1.5 text-slate-300 font-medium">
                    <Contrast className="w-3.5 h-3.5 text-emerald-400" />
                    <span>ความคมชัด (Contrast)</span>
                  </label>
                  <span className="text-emerald-400 font-mono text-[11px]">
                    {contrast > 0 ? `+${contrast}` : contrast}
                  </span>
                </div>
                <input
                  id="contrast-slider"
                  type="range"
                  min="-60"
                  max="60"
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Rotate 90° and Reset Buttons */}
            <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 gap-2">
              <button
                id="rotate-90-btn"
                type="button"
                onClick={handleRotate90}
                className="flex-1 flex items-center justify-center gap-1.5 min-h-[42px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-semibold active:scale-95 transition"
              >
                <RotateCw className="w-4 h-4 text-emerald-400" />
                <span>หมุนภาพ 90° ({rotation}°)</span>
              </button>

              <button
                id="reset-adjustments-btn"
                type="button"
                onClick={handleResetAdjustments}
                className="flex items-center justify-center gap-1.5 min-h-[42px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs font-medium active:scale-95 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>รีเซ็ตค่าแสง</span>
              </button>
            </div>
          </div>

          {/* Primary Save Page to IndexedDB Button */}
          <button
            id="save-page-btn"
            type="button"
            onClick={handleConfirmSave}
            className="w-full min-h-[52px] rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition"
          >
            <Check className="w-5 h-5 stroke-[2.5]" />
            <span>บันทึกหน้านี้ลงเอกสาร (Save Page)</span>
          </button>
        </div>
      </footer>

      {/* Offline OCR Modal (Tesseract.js tha+eng) */}
      {ocrOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">ระบบแปลงภาพเป็นข้อความ (OCR ไทย + อังกฤษ)</h3>
                  <p className="text-[11px] text-slate-400">ขับเคลื่อนด้วย Tesseract.js (tha + eng)</p>
                </div>
              </div>
              <button
                id="close-ocr-modal-btn"
                type="button"
                onClick={() => setOcrOpen(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700"
              >
                ปิดหน้าต่าง
              </button>
            </div>

            {ocrLoading ? (
              <div className="py-8 space-y-3 text-center">
                <Loader2 className="w-8 h-8 text-amber-400 animate-spin mx-auto" />
                <p className="text-xs font-medium text-slate-200">
                  {ocrProgress.status} ({ocrProgress.progress}%)
                </p>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all duration-150"
                    style={{ width: `${Math.max(8, ocrProgress.progress)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <textarea
                  id="ocr-result-textarea"
                  rows={7}
                  value={ocrText}
                  onChange={(e) => setOcrText(e.target.value)}
                  placeholder="ข้อความที่อ่านได้จากเอกสารจะแสดงที่นี่..."
                  className="w-full rounded-2xl bg-slate-950 border border-slate-800 p-3.5 text-xs sm:text-sm text-slate-100 leading-relaxed focus:outline-none focus:border-emerald-500"
                />

                <div className="flex items-center gap-2.5">
                  <button
                    id="copy-ocr-text-btn"
                    type="button"
                    onClick={handleCopyOcr}
                    className="flex-1 min-h-[46px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-95 transition"
                  >
                    {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copied ? 'คัดลอกข้อความแล้ว!' : 'คัดลอกข้อความ (Copy Text)'}</span>
                  </button>

                  <button
                    id="rerun-ocr-btn"
                    type="button"
                    onClick={handleRunOCR}
                    className="min-h-[46px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium active:scale-95 transition"
                  >
                    สแกนซ้ำ
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
