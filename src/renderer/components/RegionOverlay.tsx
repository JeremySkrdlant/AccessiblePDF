import { useEffect, useRef, useState } from 'react'
import type { BoundingBox, PDFRegion, TagRole } from '../lib/types'
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

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
  e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
  sw: 'nesw-resize', w: 'ew-resize'
}

// Position each handle on the border (half outside, half inside)
const HANDLE_STYLE: Record<ResizeHandle, React.CSSProperties> = {
  nw: { top: -4, left: -4 },
  n:  { top: -4, left: '50%', transform: 'translateX(-50%)' },
  ne: { top: -4, right: -4 },
  e:  { top: '50%', right: -4, transform: 'translateY(-50%)' },
  se: { bottom: -4, right: -4 },
  s:  { bottom: -4, left: '50%', transform: 'translateX(-50%)' },
  sw: { bottom: -4, left: -4 },
  w:  { top: '50%', left: -4, transform: 'translateY(-50%)' },
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

function computeResizedBbox(
  orig: BoundingBox,
  handle: ResizeHandle,
  dx: number, dy: number,
  cw: number, ch: number
): BoundingBox {
  const ndx = dx / cw
  const ndy = dy / ch
  let { x, y, width, height } = orig

  if (handle.includes('n')) { y += ndy; height -= ndy }
  if (handle.includes('s')) { height += ndy }
  if (handle.includes('e')) { width += ndx }
  if (handle.includes('w')) { x += ndx; width -= ndx }

  // Clamp to [0,1] and enforce minimum size
  width = Math.max(0.01, width)
  height = Math.max(0.01, height)
  x = Math.max(0, Math.min(x, 1 - width))
  y = Math.max(0, Math.min(y, 1 - height))

  return { x, y, width, height }
}

export function RegionOverlay({
  regions, canvasWidth, canvasHeight, selectedRegionIds, pageNum
}: RegionOverlayProps) {
  const { selectRegion, setSelectedRegionIds, updateRegion, addRegion, removeRegion, toolMode, setToolMode, mergeSelectedRegions } = useTagStore()
  const overlayRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<DragRect | null>(null)

  // Resize state
  const resizeRef = useRef<{
    regionId: string
    handle: ResizeHandle
    startX: number
    startY: number
    origBbox: BoundingBox
  } | null>(null)
  const [resizeBbox, setResizeBbox] = useState<{ regionId: string; bbox: BoundingBox } | null>(null)

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') {
        if (toolMode === 'draw' || toolMode === 'draw-text') { setToolMode('select'); return }
        selectRegion(null)
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        mergeSelectedRegions()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedRegionIds.length === 0) return
        const label = selectedRegionIds.length === 1 ? 'this region' : `these ${selectedRegionIds.length} regions`
        if (window.confirm(`Delete ${label}? This cannot be undone.`)) {
          for (const id of [...selectedRegionIds]) removeRegion(id)
        }
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
    // Handle resize drag
    if (resizeRef.current) {
      const { regionId, handle, startX, startY, origBbox } = resizeRef.current
      const pos = getLocalCoords(e)
      const newBbox = computeResizedBbox(origBbox, handle, pos.x - startX, pos.y - startY, canvasWidth, canvasHeight)
      setResizeBbox({ regionId, bbox: newBbox })
      return
    }

    if (!dragStartRef.current) return
    const pos = getLocalCoords(e)
    const x = Math.min(dragStartRef.current.x, pos.x)
    const y = Math.min(dragStartRef.current.y, pos.y)
    const width = Math.abs(pos.x - dragStartRef.current.x)
    const height = Math.abs(pos.y - dragStartRef.current.y)
    if (width > 4 || height > 4) setDragRect({ x, y, width, height })
  }

  function onMouseUp(e: React.MouseEvent) {
    // Commit resize
    if (resizeRef.current) {
      const { regionId } = resizeRef.current
      if (resizeBbox?.regionId === regionId) {
        updateRegion(regionId, { bbox: resizeBbox.bbox })
      }
      resizeRef.current = null
      setResizeBbox(null)
      return
    }

    dragStartRef.current = null

    if (dragRect && (dragRect.width > 8 || dragRect.height > 8)) {
      if (toolMode === 'draw' || toolMode === 'draw-text') {
        const bbox = {
          x: dragRect.x / canvasWidth,
          y: dragRect.y / canvasHeight,
          width: dragRect.width / canvasWidth,
          height: dragRect.height / canvasHeight
        }
        if (toolMode === 'draw') {
          addRegion({
            id: `page-${pageNum}-drawn-${Date.now()}`,
            pageNumber: pageNum,
            bbox,
            type: 'image',
            tag: 'Figure'
          })
        } else {
          addRegion({
            id: `page-${pageNum}-drawn-${Date.now()}`,
            pageNumber: pageNum,
            bbox,
            type: 'text',
            tag: null,
            ocrText: ''
          })
        }
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
    if (toolMode === 'draw' || toolMode === 'draw-text') return
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

  function onHandleMouseDown(e: React.MouseEvent, regionId: string, handle: ResizeHandle, origBbox: BoundingBox) {
    e.stopPropagation()
    e.preventDefault()
    const pos = getLocalCoords(e)
    resizeRef.current = { regionId, handle, startX: pos.x, startY: pos.y, origBbox }
  }

  const cursor = resizeBbox
    ? (HANDLE_CURSORS[resizeRef.current?.handle ?? 'se'])
    : (toolMode === 'draw' || toolMode === 'draw-text') ? 'cursor-crosshair' : 'cursor-default'

  return (
    <div
      ref={overlayRef}
      className={`absolute inset-0 ${resizeBbox ? '' : cursor}`}
      style={{ width: canvasWidth, height: canvasHeight, cursor: resizeBbox ? HANDLE_CURSORS[resizeRef.current?.handle ?? 'se'] : undefined }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {regions.map((region) => {
        const activeBbox = resizeBbox?.regionId === region.id ? resizeBbox.bbox : region.bbox
        const x = activeBbox.x * canvasWidth
        const y = activeBbox.y * canvasHeight
        const w = activeBbox.width * canvasWidth
        const h = activeBbox.height * canvasHeight
        const isSelected = selectedRegionIds.includes(region.id)
        const hasTag = region.tag !== null
        const isImage = region.type === 'image' || region.tag === 'Figure'

        return (
          <div
            key={region.id}
            className={`
              absolute transition-all duration-100 select-none
              ${(toolMode === 'draw' || toolMode === 'draw-text') ? 'pointer-events-none' : 'cursor-pointer'}
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

            {/* Resize handles — only on the single selected region */}
            {isSelected && selectedRegionIds.length === 1 && toolMode === 'select' && (
              (Object.keys(HANDLE_STYLE) as ResizeHandle[]).map((handle) => (
                <div
                  key={handle}
                  className="absolute w-2.5 h-2.5 bg-white border-2 border-blue-500 rounded-sm z-30"
                  style={{ ...HANDLE_STYLE[handle], cursor: HANDLE_CURSORS[handle] }}
                  onMouseDown={(e) => onHandleMouseDown(e, region.id, handle, activeBbox)}
                />
              ))
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
              : toolMode === 'draw-text'
                ? 'border-2 border-blue-500 bg-blue-500/10'
                : 'border-2 border-blue-400 bg-blue-400/10'
          }`}
          style={{ left: dragRect.x, top: dragRect.y, width: dragRect.width, height: dragRect.height }}
        />
      )}
    </div>
  )
}
