import { create } from 'zustand'
import type { PDFDocumentMeta, PDFRegion, BoundingBox } from '../lib/types'

interface HistoryState {
  document: PDFDocumentMeta
  selectedRegionIds: string[]
}

interface TagStore {
  document: PDFDocumentMeta | null
  rawPdfBytes: ArrayBuffer | null
  selectedRegionIds: string[]
  ocrProgress: number
  isOcrRunning: boolean
  docTitle: string
  docLanguage: string
  toolMode: 'select' | 'draw'

  history: HistoryState[]
  future: HistoryState[]

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
  groupSelectedRegions: (tag: string, name?: string) => void
  unparentSelected: () => void
  moveRegion: (regionId: string, newParentId: string | null) => void
  reorderRegion: (draggedId: string, targetId: string, position: 'before' | 'after' | 'inside') => void
  setOcrProgress: (progress: number) => void
  setOcrRunning: (running: boolean) => void
  reset: () => void

  saveHistory: () => void
  undo: () => void
  redo: () => void

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
  history: [],
  future: [],
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
      history: [],
      future: [],
      // Pre-fill title from filename (strip extension), keep existing language
      docTitle: doc.fileName.replace(/\.pdf$/i, '') || ''
    }),

  setDocTitle: (title) => set({ docTitle: title }),
  setDocLanguage: (lang) => set({ docLanguage: lang }),
  setToolMode: (mode) => set({ toolMode: mode }),

  addRegion: (region) => {
    const doc = get().document
    if (!doc) return
    get().saveHistory()
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
    get().saveHistory()
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

    get().saveHistory()

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

  groupSelectedRegions: (tag, name) => {
    const { document, selectedRegionIds } = get()
    if (!document || selectedRegionIds.length === 0) return

    get().saveHistory()

    const groupId = `group-${Date.now()}`
    const groupRegion: PDFRegion = {
      id: groupId,
      pageNumber: 0, // 0 for document-level abstract group
      bbox: { x: 0, y: 0, width: 0, height: 0 },
      type: 'group',
      tag: tag,
      altText: name, // reuse altText as the custom group name
      isExpanded: true
    }

    set({
      document: {
        ...document,
        pages: document.pages.map((page, idx) => {
          let newRegions = page.regions.map(r => 
            selectedRegionIds.includes(r.id) ? { ...r, parentId: groupId } : r
          )
          // Add the group abstract region to the first page just to store it
          if (idx === 0) {
            newRegions.push(groupRegion)
          }
          return { ...page, regions: newRegions }
        })
      },
      selectedRegionIds: [groupId]
    })
  },

  unparentSelected: () => {
    const { document, selectedRegionIds } = get()
    if (!document || selectedRegionIds.length === 0) return

    get().saveHistory()

    set({
      document: {
        ...document,
        pages: document.pages.map(page => ({
          ...page,
          regions: page.regions.map(r =>
            selectedRegionIds.includes(r.id) ? { ...r, parentId: undefined } : r
          )
        }))
      }
    })
  },

  moveRegion: (regionId, newParentId) => {
    const doc = get().document
    if (!doc) return

    get().saveHistory()

    set({
      document: {
        ...doc,
        pages: doc.pages.map(page => ({
          ...page,
          regions: page.regions.map(r =>
            r.id === regionId ? { ...r, parentId: newParentId || undefined } : r
          )
        }))
      }
    })
  },

  reorderRegion: (draggedId, targetId, position) => {
    const doc = get().document
    if (!doc) return

    get().saveHistory()

    const allRegions = doc.pages.flatMap(p => p.regions)
    const dragged = allRegions.find(r => r.id === draggedId)
    const target = allRegions.find(r => r.id === targetId)
    if (!dragged || !target) return

    let targetParentId = target.parentId

    if (position === 'inside') {
      targetParentId = targetId
    }

    // Construct siblings without dragged item, maintaining existing sort order
    let siblings = allRegions
      .filter(r => r.parentId === targetParentId && r.id !== draggedId)
      .sort((a, b) => {
        if (a.readingOrder !== undefined && b.readingOrder !== undefined) return a.readingOrder - b.readingOrder
        if (a.readingOrder !== undefined) return -1
        if (b.readingOrder !== undefined) return 1
        return a.pageNumber - b.pageNumber || a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x
      })

    // Splice dragged into siblings array at correct index
    if (position === 'inside') {
      siblings.push(dragged)
    } else {
      const idx = siblings.findIndex(r => r.id === targetId)
      if (idx !== -1) {
        siblings.splice(position === 'before' ? idx : idx + 1, 0, dragged)
      } else {
        siblings.push(dragged)
      }
    }

    const updatedSiblingMap = new Map<string, number>()
    siblings.forEach((r, idx) => updatedSiblingMap.set(r.id, idx))

    set({
      document: {
        ...doc,
        pages: doc.pages.map(page => ({
          ...page,
          regions: page.regions.map(r => {
            if (updatedSiblingMap.has(r.id)) {
              return { 
                ...r, 
                parentId: targetParentId, // Reparent implicitly if moved
                readingOrder: updatedSiblingMap.get(r.id) 
              }
            }
            return r
          })
        }))
      }
    })
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
      toolMode: 'select',
      history: [],
      future: []
    }),

  saveHistory: () => {
    const { document, selectedRegionIds } = get()
    if (!document) return
    // Deep clone doc to avoid mutated references (JSON stringify hack works well for basic objects)
    const clonedDoc = JSON.parse(JSON.stringify(document))
    set((state) => ({
      history: [...state.history, { document: clonedDoc, selectedRegionIds: [...selectedRegionIds] }],
      future: [] // Clear future when new action happens
    }))
  },

  undo: () => {
    const { history, future, document, selectedRegionIds } = get()
    if (history.length === 0 || !document) return

    const previousState = history[history.length - 1]
    const currentDoc = JSON.parse(JSON.stringify(document))

    set({
      document: previousState.document,
      selectedRegionIds: previousState.selectedRegionIds,
      history: history.slice(0, -1),
      future: [...future, { document: currentDoc, selectedRegionIds: [...selectedRegionIds] }]
    })
  },

  redo: () => {
    const { history, future, document, selectedRegionIds } = get()
    if (future.length === 0 || !document) return

    const nextState = future[future.length - 1]
    const currentDoc = JSON.parse(JSON.stringify(document))

    set({
      document: nextState.document,
      selectedRegionIds: nextState.selectedRegionIds,
      history: [...history, { document: currentDoc, selectedRegionIds: [...selectedRegionIds] }],
      future: future.slice(0, -1)
    })
  }
}))
