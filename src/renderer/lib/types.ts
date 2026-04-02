export type TagRole =
  | 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6'
  | 'P'
  | 'Figure'
  | 'Caption'
  | 'Table'
  | 'List'
  | 'ListItem'
  | 'Artifact'
  | null

export interface BoundingBox {
  // Normalized 0–1 relative to page dimensions, screen-space (top-left origin)
  x: number
  y: number
  width: number
  height: number
}

export interface PDFRegion {
  id: string           // `page-${pageNum}-region-${idx}`
  pageNumber: number   // 1-indexed
  bbox: BoundingBox
  type: 'text' | 'image'
  ocrText?: string
  tag: TagRole
  altText?: string
  readingOrder?: number
}

export interface PDFPage {
  pageNumber: number
  width: number    // points
  height: number
  regions: PDFRegion[]
}

export interface PDFDocumentMeta {
  filePath: string
  fileName: string
  pageCount: number
  pages: PDFPage[]
}

export interface ExportProgress {
  stage: 'loading' | 'embedding-font' | 'building-structure' | 'writing-streams' | 'saving'
  page?: number
  total?: number
}

// Extend Window with the Electron IPC bridge
declare global {
  interface Window {
    electronAPI: {
      saveFile(defaultName: string, bytes: Uint8Array): Promise<string | null>
      openFile(): Promise<{ path: string; buffer: ArrayBuffer } | null>
      getPlatform(): Promise<string>
      getResourcesPath(): Promise<string>
    }
  }
}
