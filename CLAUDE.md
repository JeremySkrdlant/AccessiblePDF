# PDF Accessibility Tagger — CLAUDE.md

## Project Overview

A cross-platform Electron desktop app that helps users make PDF files accessible by:
1. Accepting a PDF via drag-and-drop
2. OCR-scanning the document to detect text regions and images
3. Providing a visual tagging interface to assign accessibility roles (headings, alt text, etc.)
4. Exporting a new, accessibility-tagged PDF

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Desktop shell | Electron (v28+) | Cross-platform Mac/Windows app |
| UI framework | React 18 + TypeScript | Component-based interface |
| PDF rendering | PDF.js (`pdfjs-dist`) | Render PDF pages as canvases |
| OCR engine | Tesseract.js (v5) | Extract text blocks + bounding boxes |
| PDF writing | `pdf-lib` | Write structure/accessibility tags back to PDF |
| Styling | Tailwind CSS | Utility-first styling |
| Build tool | Vite + `electron-vite` | Fast dev/build pipeline |
| Packaging | `electron-builder` | Produce .dmg (Mac) and .exe (Windows) installers |

NOTE: Do not use the Axios package. 
---

## Project Structure

```
pdf-accessibility-tagger/
├── CLAUDE.md
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.json
│
├── src/
│   ├── main/                        # Electron main process
│   │   ├── index.ts                 # App entry, window creation
│   │   ├── ipc-handlers.ts          # IPC: file save, PDF export
│   │   └── preload.ts               # Context bridge (main ↔ renderer)
│   │
│   ├── renderer/                    # React UI (renderer process)
│   │   ├── index.html
│   │   ├── main.tsx                 # React entry point
│   │   ├── App.tsx                  # Root component + routing
│   │   │
│   │   ├── components/
│   │   │   ├── DropZone.tsx         # Drag-and-drop PDF landing area
│   │   │   ├── PDFViewer.tsx        # Renders PDF pages via PDF.js
│   │   │   ├── PageCanvas.tsx       # Single page canvas + overlay
│   │   │   ├── RegionOverlay.tsx    # Clickable bounding box regions
│   │   │   ├── TagPanel.tsx         # Side panel: assign tags to selection
│   │   │   ├── ImageAltEditor.tsx   # Modal/inline alt text input for images
│   │   │   ├── TagBadge.tsx         # Visual label shown on tagged regions
│   │   │   └── ExportButton.tsx     # Trigger tagged PDF export
│   │   │
│   │   ├── hooks/
│   │   │   ├── usePDF.ts            # Load + paginate PDF.js document
│   │   │   ├── useOCR.ts            # Run Tesseract.js, return region map
│   │   │   └── useTagStore.ts       # Zustand store for all tag state
│   │   │
│   │   ├── lib/
│   │   │   ├── ocr.ts               # Tesseract.js wrapper, normalize output
│   │   │   ├── pdfExport.ts         # pdf-lib: write tagged PDF
│   │   │   ├── regionDetect.ts      # Merge OCR words into line/block regions
│   │   │   └── types.ts             # Shared TypeScript types
│   │   │
│   │   └── styles/
│   │       └── globals.css
│
└── resources/
    └── icons/                       # App icons (.icns, .ico, .png)
```

---

## Core Data Types (`src/renderer/lib/types.ts`)

```typescript
export type TagRole =
  | 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6'
  | 'P'          // Paragraph
  | 'Figure'     // Image / figure
  | 'Caption'    // Figure caption
  | 'Table'      // Table
  | 'List'       // List container
  | 'ListItem'   // List item
  | 'Artifact'   // Decorative — exclude from reading order
  | null;        // Untagged

export interface BoundingBox {
  x: number;       // Normalized 0–1 relative to page width
  y: number;       // Normalized 0–1 relative to page height
  width: number;
  height: number;
}

export interface PDFRegion {
  id: string;          // Unique: `page-${pageNum}-region-${idx}`
  pageNumber: number;  // 1-indexed
  bbox: BoundingBox;
  type: 'text' | 'image';
  ocrText?: string;    // Raw OCR text for text regions
  tag: TagRole;        // Current accessibility tag
  altText?: string;    // For Figure regions
  readingOrder?: number; // Optional manual reading order override
}

export interface PDFDocument {
  filePath: string;
  fileName: string;
  pageCount: number;
  pages: PDFPage[];
}

export interface PDFPage {
  pageNumber: number;
  width: number;   // Points
  height: number;
  regions: PDFRegion[];
}
```

---

## Key Features & Implementation Notes

### 1. Drag-and-Drop (`DropZone.tsx`)
- Accept `.pdf` files only
- On drop: read file as `ArrayBuffer` via `FileReader`
- Pass buffer to `usePDF` hook to initialize PDF.js
- Show loading spinner + progress while OCR runs

### 2. PDF Rendering (`PDFViewer.tsx` + `PageCanvas.tsx`)
- Use `pdfjs-dist` to render each page to a `<canvas>`
- Scale pages to fit the viewer panel width (maintain aspect ratio)
- Worker: set `GlobalWorkerOptions.workerSrc` to bundled worker path
- Render pages lazily (virtualize if doc > 20 pages)

### 3. OCR Pipeline (`useOCR.ts` + `ocr.ts`)
- Use `Tesseract.js` with `createWorker`
- Run OCR page-by-page, reporting `onProgress` for UI feedback
- Extract `words` array from Tesseract result → group into **line-level regions** using `regionDetect.ts`
- Line grouping: words on the same baseline (±5px) with small horizontal gaps → one region
- Also detect image regions: use PDF.js `page.getOperatorList()` to find image XObjects and their bounding boxes
- Store all regions in Zustand store keyed by page number

### 4. Region Overlay (`RegionOverlay.tsx`)
- Absolutely-positioned `<div>` elements over the page canvas
- Coordinates: convert normalized bbox → pixel positions using rendered canvas dimensions
- **Click** a region → select it, highlight in blue, open TagPanel
- **Hover** → show faint outline + existing tag badge
- Cursor: `pointer` on hover
- Selected region: solid blue border + elevated z-index

### 5. Tag Panel (`TagPanel.tsx`)
- Shown in a right sidebar when a region is selected
- **Text regions**: radio/button group for H1–H6, P, Caption, List, ListItem, Artifact
- **Image regions**: shows `ImageAltEditor` — textarea for alt text, checkbox for "decorative (no alt)"
- "Clear tag" option to reset to null
- Keyboard shortcut hints (e.g., `1`=H1, `2`=H2, `p`=Paragraph)
- Changes immediately update Zustand store

### 6. State Management (`useTagStore.ts` with Zustand)
```typescript
interface TagStore {
  document: PDFDocument | null;
  selectedRegionId: string | null;
  setDocument: (doc: PDFDocument) => void;
  updateRegion: (regionId: string, updates: Partial<PDFRegion>) => void;
  selectRegion: (id: string | null) => void;
  getPageRegions: (pageNumber: number) => PDFRegion[];
}
```

### 7. PDF Export (`pdfExport.ts` + IPC)
- Load original PDF bytes with `pdf-lib`
- Use `PDFDocument.load(bytes)` 
- For each tagged region:
  - Heading tags: embed as marked content with `/H1`–`/H6` role in the structure tree
  - Figure regions with alt text: add `/Figure` tag with `/Alt` attribute
  - Artifact regions: mark as `/Artifact` to hide from screen readers
- Save with `pdf.save()` → send bytes back to main process via IPC → `fs.writeFile` to disk
- Show save dialog via `dialog.showSaveDialog` in main process

### 8. IPC Bridge (`preload.ts` + `ipc-handlers.ts`)
```typescript
// Exposed via contextBridge as window.electronAPI
{
  saveFile: (defaultName: string, bytes: Uint8Array) => Promise<string | null>,
  openFile: () => Promise<{ path: string, buffer: ArrayBuffer } | null>,
  getPlatform: () => string
}
```

---

## Development Setup

### Prerequisites
- Node.js 18+
- npm 9+

### Install & Run
```bash
npm install
npm run dev          # Start Electron in development mode (hot reload)
```

### Build for Distribution
```bash
npm run build        # Build renderer + main
npm run dist:mac     # Package as .dmg for macOS
npm run dist:win     # Package as .exe/.nsis for Windows
```

### Key `package.json` Scripts
```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "dist:mac": "npm run build && electron-builder --mac",
    "dist:win": "npm run build && electron-builder --win",
    "typecheck": "tsc --noEmit"
  }
}
```

---

## Dependencies

### Production
```json
{
  "pdfjs-dist": "^4.x",
  "tesseract.js": "^5.x",
  "pdf-lib": "^1.17.x",
  "react": "^18.x",
  "react-dom": "^18.x",
  "zustand": "^4.x"
}
```

### Dev
```json
{
  "electron": "^28.x",
  "electron-vite": "^2.x",
  "electron-builder": "^24.x",
  "typescript": "^5.x",
  "tailwindcss": "^3.x",
  "@types/react": "^18.x",
  "vite": "^5.x"
}
```

---

## `electron-builder.yml`

```yaml
appId: com.yourname.pdf-accessibility-tagger
productName: PDF Accessibility Tagger
directories:
  output: dist-electron
files:
  - out/**/*
mac:
  target: dmg
  icon: resources/icons/icon.icns
  category: public.app-category.productivity
win:
  target: nsis
  icon: resources/icons/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

---

## Accessibility Standards Reference

Tag roles map to PDF/UA and WCAG 2.1 structure types:

| App Tag | PDF Structure Type | Screen Reader Behavior |
|---|---|---|
| H1–H6 | `/H1`–`/H6` | Announced as heading level N |
| P | `/P` | Read as body paragraph |
| Figure + alt | `/Figure` with `/Alt` | Alt text announced |
| Decorative | `/Artifact` | Skipped entirely |
| Caption | `/Caption` | Associated with figure |
| List / ListItem | `/L` + `/LI` | Announced as list |

---

## Known Limitations & Future Work

- **Complex PDFs**: Scanned PDFs with skewed text may have imprecise OCR bounding boxes — user should visually verify
- **Multi-column layouts**: OCR region grouping may merge columns; a "split region" tool could help
- **Tables**: Table structure tagging (TD, TH, TR) is complex — v1 tags the whole table as `/Table`
- **Reading order**: v1 uses document order; a future drag-to-reorder panel would improve this
- **PDF/UA validation**: Consider integrating `veraPDF` CLI call (via Electron shell) to validate output

---

## Development Tips for Claude Code

- Always preserve original PDF bytes; load a fresh copy for export rather than mutating the rendered copy
- Tesseract workers must be terminated after use to avoid memory leaks: `await worker.terminate()`
- PDF.js and pdf-lib are separate libraries — PDF.js is read-only rendering; pdf-lib handles writing
- Use `contextIsolation: true` and `nodeIntegration: false` in `BrowserWindow` — all Node access goes through the preload bridge
- Tailwind purge should include `./src/renderer/**/*.{tsx,ts}` 
- When packaging, Tesseract language data (`eng.traineddata`) must be included in `extraResources` in electron-builder config
