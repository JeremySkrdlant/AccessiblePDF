import { create } from 'zustand'
import type { PDFDocumentMeta, PDFRegion } from '../lib/types'

interface TagStore {
  document: PDFDocumentMeta | null
  rawPdfBytes: ArrayBuffer | null
  selectedRegionId: string | null
  ocrProgress: number   // 0–1 overall progress
  isOcrRunning: boolean

  setDocument: (doc: PDFDocumentMeta, rawBytes: ArrayBuffer) => void
  updateRegion: (regionId: string, updates: Partial<PDFRegion>) => void
  selectRegion: (id: string | null) => void
  getPageRegions: (pageNumber: number) => PDFRegion[]
  setOcrProgress: (progress: number) => void
  setOcrRunning: (running: boolean) => void
  reset: () => void
}

export const useTagStore = create<TagStore>((set, get) => ({
  document: null,
  rawPdfBytes: null,
  selectedRegionId: null,
  ocrProgress: 0,
  isOcrRunning: false,

  setDocument: (doc, rawBytes) =>
    set({ document: doc, rawPdfBytes: rawBytes, selectedRegionId: null, ocrProgress: 0 }),

  updateRegion: (regionId, updates) => {
    const doc = get().document
    if (!doc) return
    set({
      document: {
        ...doc,
        pages: doc.pages.map((page) => ({
          ...page,
          regions: page.regions.map((r) =>
            r.id === regionId ? { ...r, ...updates } : r
          )
        }))
      }
    })
  },

  selectRegion: (id) => set({ selectedRegionId: id }),

  getPageRegions: (pageNumber) => {
    const doc = get().document
    if (!doc) return []
    return doc.pages.find((p) => p.pageNumber === pageNumber)?.regions ?? []
  },

  setOcrProgress: (progress) => set({ ocrProgress: progress }),

  setOcrRunning: (running) => set({ isOcrRunning: running }),

  reset: () =>
    set({
      document: null,
      rawPdfBytes: null,
      selectedRegionId: null,
      ocrProgress: 0,
      isOcrRunning: false
    })
}))
