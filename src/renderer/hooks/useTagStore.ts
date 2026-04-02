import { create } from 'zustand'
import type { PDFDocumentMeta, PDFRegion, BoundingBox } from '../lib/types'

interface TagStore {
  document: PDFDocumentMeta | null
  rawPdfBytes: ArrayBuffer | null
  selectedRegionIds: string[]
  ocrProgress: number
  isOcrRunning: boolean
  docTitle: string
  docLanguage: string
  toolMode: 'select' | 'draw'

  setDocument: (doc: PDFDocumentMeta, rawBytes: ArrayBuffer) => void
  setDocTitle: (title: string) => void
  setDocLanguage: (lang: string) => void
  setToolMode: (mode: 'select' | 'draw') => void
  addRegion: (region: PDFRegion) => void
  updateRegion: (regionId: string, updates: Partial<PDFRegion>) => void
  selectRegion: (id: string | null) => void
  setSelectedRegionIds: (ids: string[]) => void
  mergeSelectedRegions: () => void
  getPageRegions: (pageNumber: number) => PDFRegion[]
  setOcrProgress: (progress: number) => void
  setOcrRunning: (running: boolean) => void
  reset: () => void

  // Derived helper — the single selected id (when exactly one is selected)
  selectedRegionId: string | null
}

export const useTagStore = create<TagStore>((set, get) => ({
  document: null,
  rawPdfBytes: null,
  selectedRegionIds: [],
  docTitle: '',
  docLanguage: 'en-US',
  toolMode: 'select',
  get selectedRegionId() {
    const ids = get().selectedRegionIds
    return ids.length === 1 ? ids[0] : null
  },
  ocrProgress: 0,
  isOcrRunning: false,

  setDocument: (doc, rawBytes) =>
    set({
      document: doc,
      rawPdfBytes: rawBytes,
      selectedRegionIds: [],
      ocrProgress: 0,
      // Pre-fill title from filename (strip extension), keep existing language
      docTitle: doc.fileName.replace(/\.pdf$/i, '') || ''
    }),

  setDocTitle: (title) => set({ docTitle: title }),
  setDocLanguage: (lang) => set({ docLanguage: lang }),
  setToolMode: (mode) => set({ toolMode: mode }),

  addRegion: (region) => {
    const doc = get().document
    if (!doc) return
    const isFigure = region.tag === 'Figure' || region.type === 'image'
    set({
      document: {
        ...doc,
        pages: doc.pages.map((page) => {
          if (page.pageNumber !== region.pageNumber) return page
          let newRegions = page.regions
          if (isFigure) {
            newRegions = newRegions.filter(r => {
              const cx = r.bbox.x + r.bbox.width / 2
              const cy = r.bbox.y + r.bbox.height / 2
              const isInside = cx >= region.bbox.x && cx <= region.bbox.x + region.bbox.width &&
                               cy >= region.bbox.y && cy <= region.bbox.y + region.bbox.height
              return !isInside
            })
          }
          return { ...page, regions: [...newRegions, region] }
        })
      },
      selectedRegionIds: [region.id],
      toolMode: 'select'
    })
  },

  updateRegion: (regionId, updates) => {
    const doc = get().document
    if (!doc) return
    set({
      document: {
        ...doc,
        pages: doc.pages.map((page) => {
          const hasRegion = page.regions.some(r => r.id === regionId)
          if (!hasRegion) return page

          const targetRegion = page.regions.find(r => r.id === regionId)!
          const finalRegion = { ...targetRegion, ...updates }
          const isFigure = finalRegion.tag === 'Figure' || finalRegion.type === 'image'

          let filteredRegions = page.regions
          if (isFigure) {
            filteredRegions = filteredRegions.filter(r => {
              if (r.id === regionId) return true // Keep the figure itself
              const cx = r.bbox.x + r.bbox.width / 2
              const cy = r.bbox.y + r.bbox.height / 2
              const isInside = cx >= finalRegion.bbox.x && cx <= finalRegion.bbox.x + finalRegion.bbox.width &&
                               cy >= finalRegion.bbox.y && cy <= finalRegion.bbox.y + finalRegion.bbox.height
              return !isInside
            })
          }

          return {
            ...page,
            regions: filteredRegions.map((r) =>
              r.id === regionId ? finalRegion : r
            )
          }
        })
      }
    })
  },

  selectRegion: (id) => set({ selectedRegionIds: id ? [id] : [] }),

  setSelectedRegionIds: (ids) => set({ selectedRegionIds: ids }),

  mergeSelectedRegions: () => {
    const { document, selectedRegionIds } = get()
    if (!document || selectedRegionIds.length < 2) return

    // Collect all selected regions (may span pages, but typically same page)
    const allRegions = document.pages.flatMap((p) => p.regions)
    const toMerge = allRegions
      .filter((r) => selectedRegionIds.includes(r.id))
      .sort((a, b) => a.pageNumber - b.pageNumber || a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)

    if (toMerge.length < 2) return

    // Union bounding box (all regions must be on the same page for a meaningful union)
    const pageNumber = toMerge[0].pageNumber
    const samePageRegions = toMerge.filter((r) => r.pageNumber === pageNumber)

    const minX = Math.min(...samePageRegions.map((r) => r.bbox.x))
    const minY = Math.min(...samePageRegions.map((r) => r.bbox.y))
    const maxX = Math.max(...samePageRegions.map((r) => r.bbox.x + r.bbox.width))
    const maxY = Math.max(...samePageRegions.map((r) => r.bbox.y + r.bbox.height))

    const mergedBbox: BoundingBox = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    }

    const mergedText = samePageRegions
      .map((r) => r.ocrText ?? '')
      .filter(Boolean)
      .join(' ')

    const mergedId = `page-${pageNumber}-merged-${Date.now()}`
    const mergedRegion: PDFRegion = {
      id: mergedId,
      pageNumber,
      bbox: mergedBbox,
      type: samePageRegions.every((r) => r.type === 'image') ? 'image' : 'text',
      ocrText: mergedText || undefined,
      tag: null
    }

    const mergeIds = new Set(samePageRegions.map((r) => r.id))

    set({
      document: {
        ...document,
        pages: document.pages.map((page) => {
          if (page.pageNumber !== pageNumber) return page
          const filtered = page.regions.filter((r) => !mergeIds.has(r.id))
          // Insert merged region in sorted position
          const insertIdx = filtered.findIndex((r) => r.bbox.y > mergedBbox.y)
          const newRegions = [...filtered]
          newRegions.splice(insertIdx === -1 ? newRegions.length : insertIdx, 0, mergedRegion)
          return { ...page, regions: newRegions }
        })
      },
      selectedRegionIds: [mergedId]
    })
  },

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
      selectedRegionIds: [],
      ocrProgress: 0,
      isOcrRunning: false,
      docTitle: '',
      docLanguage: 'en-US',
      toolMode: 'select'
    })
}))
