import { jsPDF } from 'jspdf';
import Tesseract from 'tesseract.js';
import { loadImageElement } from './vision';

/**
 * Compresses/resizes a DataURL image according to quality preset ('small' | 'high')
 */
async function prepareImageForPDF(dataUrl, quality = 'high') {
  const img = await loadImageElement(dataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const maxDim = quality === 'small' ? 1150 : 2100;
  const jpegQuality = quality === 'small' ? 0.62 : 0.93;

  let w = srcW;
  let h = srcH;
  if (Math.max(w, h) > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  return {
    dataUrl: canvas.toDataURL('image/jpeg', jpegQuality),
    width: w,
    height: h,
  };
}

/**
 * Generates a multi-page A4 PDF from scanned pages.
 * Automatically centers each image within the A4 page while preserving aspect ratio.
 */
export async function generatePDFDocument(pages, { filename = 'CivilCamscanner-Document', quality = 'high', onProgress } = {}) {
  if (!pages || pages.length === 0) {
    throw new Error('ไม่มีหน้าเอกสารสำหรับสร้างไฟล์ PDF');
  }

  // Standard A4 dimensions in mm: 210 x 297
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 8; // 8mm clean border margin
  const maxDrawW = pageWidth - margin * 2;
  const maxDrawH = pageHeight - margin * 2;

  for (let i = 0; i < pages.length; i++) {
    if (onProgress) {
      onProgress(Math.round(((i + 0.3) / pages.length) * 100));
    }
    const page = pages[i];
    const srcUrl = page.processedDataUrl || page.croppedDataUrl || page.originalDataUrl;
    const prepared = await prepareImageForPDF(srcUrl, quality);

    if (i > 0) {
      pdf.addPage('a4', 'portrait');
    }

    const imgRatio = prepared.width / prepared.height;
    const boxRatio = maxDrawW / maxDrawH;

    let drawW, drawH;
    if (imgRatio > boxRatio) {
      drawW = maxDrawW;
      drawH = maxDrawW / imgRatio;
    } else {
      drawH = maxDrawH;
      drawW = maxDrawH * imgRatio;
    }

    // Center horizontally and vertically on A4 sheet
    const offsetX = (pageWidth - drawW) / 2;
    const offsetY = (pageHeight - drawH) / 2;

    pdf.addImage(
      prepared.dataUrl,
      'JPEG',
      offsetX,
      offsetY,
      drawW,
      drawH,
      `page_${i + 1}`,
      quality === 'small' ? 'MEDIUM' : 'FAST'
    );

    if (onProgress) {
      onProgress(Math.round(((i + 1) / pages.length) * 100));
    }
  }

  const cleanName = (filename || 'CivilCamscanner-Document').replace(/\.pdf$/i, '').trim() || 'CivilCamscanner-Document';
  const pdfBlob = pdf.output('blob');
  const pdfFile = new File([pdfBlob], `${cleanName}.pdf`, { type: 'application/pdf' });

  return {
    pdf,
    blob: pdfBlob,
    file: pdfFile,
    filename: `${cleanName}.pdf`,
  };
}

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function downloadPageAsJPG(page, filename = 'CivilCamscanner-Page.jpg') {
  const srcUrl = page.processedDataUrl || page.croppedDataUrl || page.originalDataUrl;
  const blob = await dataUrlToBlob(srcUrl);
  const cleanName = filename.endsWith('.jpg') ? filename : `${filename}.jpg`;
  triggerBlobDownload(blob, cleanName);
}

/**
 * Shares one or more files (JPG or PDF) via Mobile Web Share API (LINE, Google Drive, etc.)
 */
export async function shareFilesNative(files, { title = 'CivilCamscanner', text = 'เอกสารสแกนจาก CivilCamscanner' } = {}) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    const shareData = { title, text, files };
    if (!navigator.canShare || navigator.canShare(shareData)) {
      await navigator.share(shareData);
      return { shared: true };
    }
  }
  return { shared: false, reason: 'อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการแชร์ไฟล์โดยตรง ระบบจะดาวน์โหลดไฟล์ลงเครื่องแทน' };
}

/**
 * Runs Tesseract.js OCR with Thai + English ('tha+eng') support
 */
export async function runTesseractOCR(imageSource, onProgress) {
  const result = await Tesseract.recognize(imageSource, 'tha+eng', {
    logger: (m) => {
      if (onProgress) {
        onProgress({
          status: m.status || 'กำลังประมวลผล...',
          progress: typeof m.progress === 'number' ? Math.round(m.progress * 100) : 0,
        });
      }
    },
  });

  return (result?.data?.text || '').trim();
}
