import { useState, useRef, useEffect } from 'react'
import { useTagStore } from '../hooks/useTagStore'
import { PDFRegion } from '../lib/types'
import { TagBadge } from './TagBadge'
import { compareReadingOrder } from '../lib/readingOrder'

export function TreeEditor() {
  const { document, selectedRegionIds, selectRegion, setSelectedRegionIds, groupSelectedRegions, unparentSelected, moveRegion, removeRegion, updateRegion, reorderRegion, toolMode, setToolMode } = useTagStore()
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' | 'inside' } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorIdRef = useRef<string | null>(null)

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = () => setContextMenu(null)
    window.addEventListener('mousedown', dismiss)
    return () => window.removeEventListener('mousedown', dismiss)
  }, [contextMenu])

  if (!document) return null

  // Flatten all regions across pages
  const allRegions = document.pages.flatMap(p => p.regions)

  // Build a hierarchy derived from parentId
  const rootRegions = allRegions.filter(r => !r.parentId)

  // Utility to find children
  const getChildren = (parentId: string) => {
    return allRegions
      .filter(r => r.parentId === parentId)
      .sort(compareReadingOrder)
  }

  // Flat list of visible nodes in display order (depth-first, collapsed nodes skip children)
  const getFlatVisibleNodes = (): PDFRegion[] => {
    const result: PDFRegion[] = []
    function visit(region: PDFRegion) {
      result.push(region)
      if (region.isExpanded ?? true) {
        getChildren(region.id).forEach(visit)
      }
    }
    rootRegions.sort(compareReadingOrder).forEach(visit)
    return result
  }

  const renderNode = (region: PDFRegion, depth: number) => {
    const isSelected = selectedRegionIds.includes(region.id)
    const children = getChildren(region.id)
    const isGroup = region.type === 'group'
    const hasChildren = children.length > 0
    const isExpanded = region.isExpanded ?? true

    return (
      <div key={region.id} className="flex flex-col">
        <div
          draggable
          onMouseDown={(e) => {
            longPressTimer.current = setTimeout(() => {
              setContextMenu({ id: region.id, x: e.clientX, y: e.clientY })
            }, 500)
          }}
          onMouseUp={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
          onMouseLeave={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
          onTouchStart={(e) => {
            const touch = e.touches[0]
            longPressTimer.current = setTimeout(() => {
              setContextMenu({ id: region.id, x: touch.clientX, y: touch.clientY })
            }, 500)
          }}
          onTouchEnd={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
          onTouchMove={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
          onDragStart={(e) => {
            if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
            e.dataTransfer.setData('text/plain', region.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setDropTarget(null)}
          onDragEnter={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            
            const rect = e.currentTarget.getBoundingClientRect()
            const y = e.clientY - rect.top
            
            let pos: 'before' | 'after' | 'inside'
            if (isGroup && y > rect.height * 0.25 && y < rect.height * 0.75) {
              pos = 'inside'
            } else if (y < rect.height * 0.5) {
              pos = 'before'
            } else {
              pos = 'after'
            }
            
            setDropTarget(prev => (prev?.id === region.id && prev?.position === pos) ? prev : { id: region.id, position: pos })
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!dropTarget) return
            
            const draggedId = e.dataTransfer.getData('text/plain')
            if (draggedId && draggedId !== region.id) {
              reorderRegion(draggedId, dropTarget.id, dropTarget.position)
              if (dropTarget.position === 'inside') {
                updateRegion(region.id, { isExpanded: true })
              }
            }
            setDropTarget(null)
          }}
          className={`flex items-center group gap-2 py-1.5 px-2 text-sm cursor-pointer border border-transparent rounded-md transition-colors ${
            isSelected ? 'bg-blue-100 border-blue-300' : 'hover:bg-gray-100'
          } ${dropTarget?.id === region.id && dropTarget.position === 'inside' ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-400' : ''}`}
          style={{ 
            paddingLeft: `${depth * 1.5 + 0.5}rem`,
            boxShadow: dropTarget?.id === region.id 
              ? (dropTarget.position === 'before' ? 'inset 0 2px 0 0 #3b82f6' : dropTarget.position === 'after' ? 'inset 0 -2px 0 0 #3b82f6' : undefined) 
              : undefined
          }}
          onClick={(e) => {
            if (e.shiftKey && anchorIdRef.current) {
              const flat = getFlatVisibleNodes()
              const anchorIdx = flat.findIndex(r => r.id === anchorIdRef.current)
              const clickIdx = flat.findIndex(r => r.id === region.id)
              if (anchorIdx !== -1 && clickIdx !== -1) {
                const [from, to] = anchorIdx <= clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx]
                setSelectedRegionIds(flat.slice(from, to + 1).map(r => r.id))
              }
            } else if (e.metaKey || e.ctrlKey) {
              if (isSelected) {
                setSelectedRegionIds(selectedRegionIds.filter(id => id !== region.id))
              } else {
                setSelectedRegionIds([...selectedRegionIds, region.id])
                anchorIdRef.current = region.id
              }
            } else {
              selectRegion(region.id)
              anchorIdRef.current = region.id
            }
          }}
        >
          {/* Chevron for expand/collapse */}
          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {(isGroup || hasChildren) && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  updateRegion(region.id, { isExpanded: !isExpanded })
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            )}
          </div>

          <div className="flex-shrink-0">
            <TagBadge tag={region.tag || (isGroup ? 'Group' : 'un-tagged')} small />
          </div>

          <div className="flex-1 min-w-0 truncate text-xs text-gray-700">
            {isGroup ? (
              <span className="font-semibold">{region.altText || region.tag || 'Group'}</span>
            ) : (
              <span className="opacity-80">
                {region.ocrText ? region.ocrText.substring(0, 30) : (region.altText || 'Image Region')}
              </span>
            )}
          </div>
          
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
            {region.parentId && (
              <button
                className="text-[10px] bg-red-100 text-red-700 px-1 rounded hover:bg-red-200"
                onClick={(e) => { e.stopPropagation(); moveRegion(region.id, null) }}
                title="Remove from group"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {isExpanded && hasChildren && (
          <div className="flex flex-col">
            {children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-y-hidden">
      <div className="p-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Document Structure</h2>
      </div>

      <div className="p-2 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-2 text-xs">
        <button
          onClick={() => setToolMode(toolMode === 'draw' ? 'select' : 'draw')}
          title={toolMode === 'draw' ? 'Exit draw mode (Esc)' : 'Draw image region'}
          className={`px-2 py-1 border rounded shadow-sm flex items-center gap-1 ${
            toolMode === 'draw'
              ? 'bg-green-600 text-white border-green-600 hover:bg-green-700'
              : 'bg-white border-gray-300 hover:bg-gray-50'
          }`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
            <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3 2" />
            <path d="M8 5v6M5 8h6" strokeLinecap="round" />
          </svg>
          {toolMode === 'draw' ? 'Drawing Image…' : 'Draw Image'}
        </button>
        <button
          onClick={() => setToolMode(toolMode === 'draw-text' ? 'select' : 'draw-text')}
          title={toolMode === 'draw-text' ? 'Exit draw text mode (Esc)' : 'Add text region'}
          className={`px-2 py-1 border rounded shadow-sm flex items-center gap-1 ${
            toolMode === 'draw-text'
              ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
              : 'bg-white border-gray-300 hover:bg-gray-50'
          }`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
            <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3 2" />
            <text x="8" y="11" textAnchor="middle" fontSize="7" stroke="none" fill="currentColor" fontWeight="bold">T</text>
          </svg>
          {toolMode === 'draw-text' ? 'Drawing Text…' : 'Draw Text'}
        </button>
        <button
          disabled={selectedRegionIds.length === 0}
          onClick={() => groupSelectedRegions('List')}
          className="px-2 py-1 bg-white border border-gray-300 rounded shadow-sm disabled:opacity-50 hover:bg-gray-50"
        >
          Group into List
        </button>
      </div>

      <div 
        className={`flex-1 overflow-y-auto p-2 ${dropTarget?.id === 'root' ? 'bg-gray-50 ring-inset ring-2 ring-blue-300' : ''}`}
        onDragEnter={(e) => e.preventDefault()}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropTarget(prev => (prev?.id === 'root' && prev?.position === 'inside') ? prev : { id: 'root', position: 'inside' })
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDropTarget(null)
          const draggedId = e.dataTransfer.getData('text/plain')
          if (draggedId) {
            moveRegion(draggedId, null) // unpack to root
          }
        }}
      >
        {rootRegions.length === 0 ? (
          <p className="text-xs text-gray-400 text-center mt-4">No regions generated yet.</p>
        ) : (
          <div className="flex flex-col">
            {rootRegions
              .sort(compareReadingOrder)
              .map(node => renderNode(node, 0))}
          </div>
        )}
      </div>

      {contextMenu && (() => {
        const region = allRegions.find(r => r.id === contextMenu.id)
        if (!region) return null
        return (
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[140px] text-sm"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1 text-xs text-gray-400 font-medium border-b border-gray-100 mb-1 truncate max-w-[160px]">
              {region.ocrText ? region.ocrText.substring(0, 24) : (region.altText || 'Region')}
            </div>
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600"
              onClick={() => {
                removeRegion(contextMenu.id)
                setContextMenu(null)
              }}
            >
              Remove region
            </button>
          </div>
        )
      })()}
    </div>
  )
}
