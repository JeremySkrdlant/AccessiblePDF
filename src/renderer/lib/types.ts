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
  id: string           // `page-${pageNum}-region-${idx}` or `group-${Date.now()}`
  pageNumber: number   // 1-indexed (can be 0 or current page for groups)
  bbox: BoundingBox    // Can be zero-size for logical groups
  type: 'text' | 'image' | 'group'
  ocrText?: string
  tag: TagRole | string
  altText?: string
  readingOrder?: number
  parentId?: string
  isExpanded?: boolean
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
