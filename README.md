# CivilCamscanner (PWA Document Scanner & OCR)

แอปพลิเคชันสแกนเอกสารระดับมืออาชีพแบบ **Progressive Web App (PWA)** สำหรับใช้งานบนมือถือ (รองรับทั้ง **Android Chrome** และ **iOS Safari**) พัฒนาด้วย **Vite + React + Tailwind CSS**

## ฟีเจอร์หลัก (Key Features)

1. **ระบบกล้องสแกนสด & Real-time Edge Detection (Computer Vision)**
   - เปิดกล้องหลังความละเอียดสูง (`facingMode: "environment"`, `ideal: 1920x1080`) พร้อม `playsInline muted autoPlay` รองรับ iOS Safari
   - โหลด **OpenCV.js** แบบ Async พร้อมระบบ Computer Vision ตรวจจับขอบกระดาษ 4 มุมแบบ Real-time วาดกรอบเส้นสีเขียวเรืองแสงทับบนภาพกล้องสด
   - โหมด **Auto-Snap** ลั่นชัตเตอร์ถ่ายภาพอัตโนมัติเมื่อตรวจจับมุมกระดาษนิ่งติดต่อกัน **1.5 วินาที**
   - ปุ่มเปิด/ปิดไฟฉาย (`torch` constraint), ปุ่มอัปโหลดรูปภาพจากแกลเลอรี และโหมดจำลองกล้องสแกนสดสำหรับทดสอบ

2. **หน้าปรับมุมกระดาษ 4 ด้านพร้อมแว่นขยาย (4-Point Perspective Crop)**
   - วางจุดมุม 4 จุดตามตำแหน่งที่ AI ตรวจจับได้อัตโนมัติ พร้อมปุ่ม **"ตรวจจับมุมใหม่"** และ **"รีเซ็ตเต็มภาพ"**
   - รองรับการใช้นิ้วลากจุดมุมทั้ง 4 บนหน้าจอสัมผัส (`onTouchStart`, `onTouchMove`) พร้อมแสดง **วงกลมแว่นขยาย (Magnifier Loupe)** ลอยเยื้องขึ้นด้านบนเหนือปลายนิ้ว
   - คำนวณ **Perspective Transform (Homography)** ดัดภาพที่ถ่ายเอียงให้กลับมาเป็นสี่เหลี่ยมผืนผ้าหน้าตรงตามสัดส่วนจริง

3. **ฟิลเตอร์ปรับความคมชัดเอกสาร & เครื่องมือแก้ไข**
   - ฟิลเตอร์ 4 โหมด: **ต้นฉบับ (Original)**, **สีคมชัด (Magic Color)**, **ขาว-เทา (Grayscale)** และ **ขาว-ดำเอกสาร (Adaptive Thresholding)**
   - แถบเลื่อนปรับ **ความสว่าง (Brightness)**, **ความคมชัด (Contrast)** และปุ่ม **หมุนภาพ 90 องศา**

4. **ระบบจัดการหลายหน้า & ส่งออกไฟล์ (Multi-Page & Export)**
   - บันทึกหน้าที่สแกนสะสมไว้ใน **IndexedDB** (`CivilCamscannerDB`) รองรับรูปความละเอียดสูงโดยไม่ติดโควตา 5MB ของ `localStorage`
   - สแกนเพิ่มหน้าใหม่, ลากสลับลำดับหน้า, ลบหน้า หรือกดเข้าไปแก้ไขฟิลเตอร์ย้อนหลังได้
   - **Export PDF:** ใช้ `jspdf` รวมทุกหน้าเป็นไฟล์ `.pdf` ขนาดมาตรฐาน **A4** (จัดกึ่งกลางอัตโนมัติ) พร้อมตัวเลือกคุณภาพไฟล์ (ขนาดเล็ก / คมชัดสูง) และตั้งชื่อไฟล์ก่อนดาวน์โหลดได้
   - **Export รูปภาพ & แชร์:** บันทึกรูป `.jpg` ลงเครื่อง หรือใช้ **Web Share API (`navigator.share`)** ส่งเข้า LINE / Google Drive
   - **ระบบ OCR (Offline):** แปลงภาพเป็นข้อความด้วย `tesseract.js` รองรับภาษาไทย (`tha`) + อังกฤษ (`eng`) พร้อมปุ่มคัดลอกข้อความ

5. **PWA & การติดตั้งใช้งาน**
   - ตั้งค่า `vite-plugin-pwa` สร้าง `manifest.json` (`display: "standalone"`, `orientation: "portrait"`) และ Service Worker สำหรับใช้งานแบบ Offline
   - ตั้งค่า `base: './'` ใน `vite.config.js` รองรับการ Deploy ขึ้น **GitHub Pages**

## คำสั่งรันโปรเจกต์

```bash
npm install
npm run dev
npm run build
```
