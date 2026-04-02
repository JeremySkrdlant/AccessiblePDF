import { useEffect, useRef, useState } from 'react'
import type { PDFRegion, TagRole } from '../lib/types'
import { TagBadge } from './TagBadge'
import { useTagStore } from '../hooks/useTagStore'

interface RegionOverlayProps {
  regions: PDFRegion[]
  canvasWidth: number
  canvasHeight: number
  selectedRegionIds: string[]
  pageNum: number
}

interface DragRect {
  x: number
  y: number
  width: number
  height: number
}

const KEY_TO_TAG: Record<string, TagRole> = {
  '1': 'H1', '2': 'H2', '3': 'H3', '4': 'H4', '5': 'H5', '6': 'H6',
  p: 'P', f: 'Figure', c: 'Caption', t: 'Table', l: 'List', i: 'ListItem', a: 'Artifact'
}

function rectsIntersect(r: PDFRegion, drag: DragRect, cw: number, ch: number): boolean {
  const rx = r.bbox.x * cw, ry = r.bbox.y * ch
  const rw = r.bbox.width * cw, rh = r.bbox.height * ch
  return rx < drag.x + drag.width && rx + rw > drag.x && ry < drag.y + drag.height && ry + rh > drag.y
}

export function RegionOverlay({
  regions, canvasWidth, canvasHeight, selectedRegionIds, pageNum
}: RegionOverlayProps) {
  const { selectRegion, setSelectedRegionIds, updateRegion, addRegion, toolMode, setToolMode, mergeSelectedRegions } = useTagStore()
  const overlayRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<DragRect | null>(null)

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') {
        if (toolMode === 'draw') { setToolMode('select'); return }
        selectRegion(null)
        return
      }
      if (e.key.toLowerCase() === 'm') {
        mergeSelectedRegions()
        return
      }
      const role = KEY_TO_TAG[e.key.toLowerCase()]
      if (!role) return
      for (const id of selectedRegionIds) updateRegion(id, { tag: role })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedRegionIds, selectRegion, updateRegion, mergeSelectedRegions, setToolMode, toolMode])

  function getLocalCoords(e: React.MouseEvent) {
    const rect = overlayRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    // In draw mode, start from anywhere; in select mode, only from background
    if (toolMode === 'select' && (e.target as HTMLElement) !== overlayRef.current) return
    e.preventDefault()
    dragStartRef.current = getLocalCoords(e)
    setDragRect(null)
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragStartRef.current) return
    const pos = getLocalCoords(e)
    const x = Math.min(dragStartRef.current.x, pos.x)
    const y = Math.min(dragStartRef.current.y, pos.y)
    const width = Math.abs(pos.x - dragStartRef.current.x)
    const height = Math.abs(pos.y - dragStartRef.current.y)
    if (width > 4 || height > 4) setDragRect({ x, y, width, height })
  }

  function onMouseUp(e: React.MouseEvent) {
    const start = dragStartRef.current
    dragStartRef.current = null

    if (dragRect && (dragRect.width > 8 || dragRect.height > 8)) {
      if (toolMode === 'draw') {
        // Create a new Figure region from the drawn rectangle
        const bbox = {
          x: dragRect.x / canvasWidth,
          y: dragRect.y / canvasHeight,
          width: dragRect.width / canvasWidth,
          height: dragRect.height / canvasHeight
        }
        addRegion({
          id: `page-${pageNum}-drawn-${Date.now()}`,
          pageNumber: pageNum,
          bbox,
          type: 'image',
          tag: 'Figure'
        })
      } else {
        // Rubber-band select
        const hit = regions
          .filter((r) => rectsIntersect(r, dragRect, canvasWidth, canvasHeight))
          .map((r) => r.id)
        setSelectedRegionIds(hit)
      }
    } else if (toolMode === 'select' && (e.target as HTMLElement) === overlayRef.current) {
      selectRegion(null)
    }

    setDragRect(null)
  }

  function onRegionClick(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (toolMode === 'draw') return // ignore region clicks in draw mode
    if (e.metaKey || e.ctrlKey) {
      setSelectedRegionIds(
        selectedRegionIds.includes(id)
          ? selectedRegionIds.filter((s) => s !== id)
          : [...selectedRegionIds, id]
      )
    } else {
      selectRegion(id)
    }
  }

  const cursor = toolMode === 'draw' ? 'cursor-crosshair' : 'cursor-default'

  return (
    <div
      ref={overlayRef}
      className={`absolute inset-0 ${cursor}`}
      style={{ width: canvasWidth, height: canvasHeight }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {regions.map((region) => {
        const x = region.bbox.x * canvasWidth
        const y = region.bbox.y * canvasHeight
        const w = region.bbox.width * canvasWidth
        const h = region.bbox.height * canvasHeight
        const isSelected = selectedRegionIds.includes(region.id)
        const hasTag = region.tag !== null
        const isImage = region.type === 'image' || region.tag === 'Figure'

        return (
          <div
            key={region.id}
            className={`
              absolute transition-all duration-100 select-none
              ${toolMode === 'draw' ? 'pointer-events-none' : 'cursor-pointer'}
              ${isSelected
                ? `border-2 z-20 ${isImage ? 'border-green-500 bg-green-500/10' : 'border-blue-500 bg-blue-500/10'}`
                : hasTag
                  ? `border z-10 ${isImage ? 'border-green-300 hover:bg-green-500/5' : 'border-blue-300 hover:bg-blue-500/5'}`
                  : 'border border-transparent hover:border-gray-400 hover:bg-gray-500/5 z-10'
              }
            `}
            style={{ left: x, top: y, width: w, height: h }}
            onMouseDown={(e) => { if (toolMode === 'select') e.stopPropagation() }}
            onClick={(e) => onRegionClick(e, region.id)}
          >
            {(hasTag || isSelected) && (
              <div className="absolute -top-4 left-0 pointer-events-none">
                <TagBadge tag={region.tag} small />
              </div>
            )}
          </div>
        )
      })}

      {/* Drag rectangle — blue for rubber-band select, green for draw */}
      {dragRect && (
        <div
          className={`absolute pointer-events-none z-30 ${
            toolMode === 'draw'
              ? 'border-2 border-green-500 bg-green-500/10'
              : 'border-2 border-blue-400 bg-blue-400/10'
          }`}
          style={{ left: dragRect.x, top: dragRect.y, width: dragRect.width, height: dragRect.height }}
        />
      )}
    </div>
  )
}
