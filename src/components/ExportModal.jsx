import React, { useState } from 'react';
import {
  FileDown,
  Share2,
  Image as ImageIcon,
  X,
  CheckCircle2,
  Loader2,
  FileCheck,
  Sparkles,
} from 'lucide-react';
import {
  generatePDFDocument,
  triggerBlobDownload,
  downloadPageAsJPG,
  shareFilesNative,
  dataUrlToBlob,
} from '../services/exporter';

export default function ExportModal({
  pages,
  defaultDocName = 'CivilCamscanner-Document',
  onUpdateDocName,
  onClose,
  onNotify,
}) {
  const [filename, setFilename] = useState(defaultDocName);
  const [quality, setQuality] = useState('high'); // 'high' | 'small'
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);
  const [busyAction, setBusyAction] = useState(null); // 'pdf-download' | 'pdf-share' | 'jpg-download' | 'jpg-share'
  const [progress, setProgress] = useState(0);

  const handleFilenameChange = (val) => {
    setFilename(val);
    onUpdateDocName?.(val);
  };

  // 1. Download Multi-Page A4 PDF
  const handleDownloadPDF = async () => {
    if (busyAction || pages.length === 0) return;
    setBusyAction('pdf-download');
    setProgress(10);
    try {
      const { blob, filename: outName } = await generatePDFDocument(pages, {
        filename,
        quality,
        onProgress: setProgress,
      });
      triggerBlobDownload(blob, outName);
      onNotify?.(`ดาวน์โหลดไฟล์ PDF (${outName}) จำนวน ${pages.length} หน้าเรียบร้อย!`);
    } catch (err) {
      console.error(err);
      onNotify?.('เกิดข้อผิดพลาดในการสร้างไฟล์ PDF');
    } finally {
      setBusyAction(null);
      setProgress(0);
    }
  };

  // 2. Share Multi-Page A4 PDF via Web Share API (LINE / Google Drive)
  const handleSharePDF = async () => {
    if (busyAction || pages.length === 0) return;
    setBusyAction('pdf-share');
    setProgress(10);
    try {
      const { file, blob, filename: outName } = await generatePDFDocument(pages, {
        filename,
        quality,
        onProgress: setProgress,
      });
      const res = await shareFilesNative([file], {
        title: outName,
        text: `เอกสารสแกน ${pages.length} หน้า จากแอป CivilCamscanner`,
      });
      if (!res.shared) {
        triggerBlobDownload(blob, outName);
        onNotify?.(res.reason || `บันทึกไฟล์ ${outName} ลงเครื่องแล้ว`);
      } else {
        onNotify?.('แชร์ไฟล์ PDF สำเร็จ');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        onNotify?.('ยกเลิกหรือเกิดข้อผิดพลาดในการแชร์ PDF');
      }
    } finally {
      setBusyAction(null);
      setProgress(0);
    }
  };

  // 3. Download Selected Page as .JPG
  const handleDownloadJPG = async () => {
    const targetPage = pages[selectedPageIdx] || pages[0];
    if (!targetPage || busyAction) return;
    setBusyAction('jpg-download');
    try {
      const cleanBase = (filename || 'CivilCamscanner').replace(/\.pdf$/i, '').trim();
      const jpgName = `${cleanBase}-Page-${selectedPageIdx + 1}.jpg`;
      await downloadPageAsJPG(targetPage, jpgName);
      onNotify?.(`บันทึกรูปภาพ ${jpgName} ลงเครื่องเรียบร้อย!`);
    } catch (err) {
      console.error(err);
      onNotify?.('ไม่สามารถบันทึกรูปภาพได้');
    } finally {
      setBusyAction(null);
    }
  };

  // 4. Share Selected Page (or All Pages) as .JPG via Web Share API
  const handleShareJPG = async () => {
    const targetPage = pages[selectedPageIdx] || pages[0];
    if (!targetPage || busyAction) return;
    setBusyAction('jpg-share');
    try {
      const cleanBase = (filename || 'CivilCamscanner').replace(/\.pdf$/i, '').trim();
      const jpgName = `${cleanBase}-Page-${selectedPageIdx + 1}.jpg`;
      const srcUrl = targetPage.processedDataUrl || targetPage.croppedDataUrl || targetPage.originalDataUrl;
      const blob = await dataUrlToBlob(srcUrl);
      const file = new File([blob], jpgName, { type: 'image/jpeg' });

      const res = await shareFilesNative([file], {
        title: jpgName,
        text: `รูปสแกนเอกสารหน้าที่ ${selectedPageIdx + 1} จาก CivilCamscanner`,
      });
      if (!res.shared) {
        triggerBlobDownload(blob, jpgName);
        onNotify?.(res.reason || `บันทึกรูปภาพ ${jpgName} ลงเครื่องแล้ว`);
      } else {
        onNotify?.('แชร์รูปภาพสำเร็จ');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        onNotify?.('ยกเลิกหรือเกิดข้อผิดพลาดในการแชร์รูปภาพ');
      }
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-end sm:items-center justify-center p-3 select-none">
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
              <FileCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">ส่งออกไฟล์ PDF (A4) & รูปภาพ</h2>
              <p className="text-xs text-slate-400">
                รวมเอกสารทั้งหมด {pages.length} หน้า (จัดกึ่งกลางหน้า A4 อัตโนมัติ)
              </p>
            </div>
          </div>

          <button
            id="export-modal-close-btn"
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Custom Filename Input */}
        <div className="space-y-1.5">
          <label htmlFor="export-filename-input" className="block text-xs font-semibold text-slate-300">
            ตั้งชื่อไฟล์เอกสารก่อนดาวน์โหลด / แชร์
          </label>
          <div className="relative">
            <input
              id="export-filename-input"
              type="text"
              value={filename}
              onChange={(e) => handleFilenameChange(e.target.value)}
              placeholder="เช่น รายงานตรวจสอบงานโยธา-2569"
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 pr-14 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
              .pdf / .jpg
            </span>
          </div>
        </div>

        {/* PDF Quality Selector (Small vs High Resolution) */}
        <div className="space-y-1.5">
          <span className="block text-xs font-semibold text-slate-300">เลือกคุณภาพไฟล์ PDF (มาตรฐาน A4)</span>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              id="pdf-quality-high-btn"
              type="button"
              onClick={() => setQuality('high')}
              className={`flex flex-col items-start p-3 rounded-2xl border text-left transition ${
                quality === 'high'
                  ? 'bg-emerald-950/80 border-emerald-400 text-emerald-100'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-bold flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  คมชัดสูง (High-Res)
                </span>
                {quality === 'high' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              </div>
              <span className="text-[11px] text-slate-400 mt-1">
                เหมาะสำหรับพิมพ์เอกสาร A4 และอ่านตัวอักษรขนาดเล็กชัดเจน
              </span>
            </button>

            <button
              id="pdf-quality-small-btn"
              type="button"
              onClick={() => setQuality('small')}
              className={`flex flex-col items-start p-3 rounded-2xl border text-left transition ${
                quality === 'small'
                  ? 'bg-emerald-950/80 border-emerald-400 text-emerald-100'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-bold">ขนาดเล็ก (ประหยัดพื้นที่)</span>
                {quality === 'small' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              </div>
              <span className="text-[11px] text-slate-400 mt-1">
                บีบอัดไฟล์ขนาดกะทัดรัด ส่งผ่าน LINE หรืออีเมลได้รวดเร็ว
              </span>
            </button>
          </div>
        </div>

        {/* Progress Indicator when generating PDF */}
        {busyAction && progress > 0 && (
          <div className="space-y-1.5 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between text-xs text-emerald-300">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                กำลังรวมหน้าเอกสารเข้าสู่กระดาษ A4...
              </span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* PDF Export Actions */}
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              id="download-pdf-btn"
              type="button"
              disabled={Boolean(busyAction)}
              onClick={handleDownloadPDF}
              className="min-h-[50px] rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-95 transition"
            >
              {busyAction === 'pdf-download' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4 stroke-[2.5]" />
              )}
              <span>ดาวน์โหลด PDF ({pages.length} หน้า)</span>
            </button>

            <button
              id="share-pdf-btn"
              type="button"
              disabled={Boolean(busyAction)}
              onClick={handleSharePDF}
              className="min-h-[50px] rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
            >
              {busyAction === 'pdf-share' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Share2 className="w-4 h-4 text-emerald-400" />
              )}
              <span>แชร์ PDF ไปยัง LINE / Drive</span>
            </button>
          </div>
        </div>

        {/* JPG Image Export & Native Share Section */}
        <div className="border-t border-slate-800 pt-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
              ส่งออกเป็นรูปภาพ (.jpg)
            </span>
            {pages.length > 1 && (
              <select
                id="select-jpg-page"
                value={selectedPageIdx}
                onChange={(e) => setSelectedPageIdx(Number(e.target.value))}
                className="rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1 text-xs text-slate-200"
              >
                {pages.map((_, idx) => (
                  <option key={idx} value={idx}>
                    หน้าที่ {idx + 1} จาก {pages.length}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              id="download-jpg-btn"
              type="button"
              disabled={Boolean(busyAction)}
              onClick={handleDownloadJPG}
              className="min-h-[46px] rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition"
            >
              <ImageIcon className="w-4 h-4 text-amber-400" />
              <span>บันทึกรูป .JPG</span>
            </button>

            <button
              id="share-jpg-btn"
              type="button"
              disabled={Boolean(busyAction)}
              onClick={handleShareJPG}
              className="min-h-[46px] rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition"
            >
              <Share2 className="w-4 h-4 text-amber-400" />
              <span>แชร์รูป .JPG (LINE/Drive)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
