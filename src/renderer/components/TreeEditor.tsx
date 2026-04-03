import { useState } from 'react'
import { useTagStore } from '../hooks/useTagStore'
import { PDFRegion } from '../lib/types'
import { TagBadge } from './TagBadge'

export function TreeEditor() {
  const { document, selectedRegionIds, selectRegion, groupSelectedRegions, unparentSelected, moveRegion, updateRegion } = useTagStore()
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  if (!document) return null

  // Flatten all regions across pages
  const allRegions = document.pages.flatMap(p => p.regions)

  // Build a hierarchy derived from parentId
  const rootRegions = allRegions.filter(r => !r.parentId)

  // Utility to find children
  const getChildren = (parentId: string) => {
    // preserve explicit readingOrder or page order
    return allRegions
      .filter(r => r.parentId === parentId)
      .sort((a, b) => {
        if (a.readingOrder !== undefined && b.readingOrder !== undefined) return a.readingOrder - b.readingOrder
        if (a.readingOrder !== undefined) return -1
        if (b.readingOrder !== undefined) return 1
        if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber
        return a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x
      })
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
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', region.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            if (isGroup) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }
          }}
          onDragEnter={(e) => {
            if (isGroup) setDragOverId(region.id)
          }}
          onDragLeave={() => {
            if (dragOverId === region.id) setDragOverId(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragOverId(null)
            if (isGroup) {
              const draggedId = e.dataTransfer.getData('text/plain')
              if (draggedId && draggedId !== region.id) {
                moveRegion(draggedId, region.id)
                // Also expand the group so the user sees the dropped item
                updateRegion(region.id, { isExpanded: true })
              }
            }
          }}
          className={`flex items-center group gap-2 py-1.5 px-2 text-sm cursor-pointer border border-transparent rounded-md transition-colors ${
            isSelected ? 'bg-blue-100 border-blue-300' : 'hover:bg-gray-100'
          } ${dragOverId === region.id ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-400' : ''}`}
          style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              const { setSelectedRegionIds } = useTagStore.getState()
              if (isSelected) {
                setSelectedRegionIds(selectedRegionIds.filter(id => id !== region.id))
              } else {
                setSelectedRegionIds([...selectedRegionIds, region.id])
              }
            } else {
              selectRegion(region.id)
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
          disabled={selectedRegionIds.length === 0}
          onClick={() => groupSelectedRegions('List')}
          className="px-2 py-1 bg-white border border-gray-300 rounded shadow-sm disabled:opacity-50 hover:bg-gray-50"
        >
          Group into List
        </button>
        <button
          disabled={selectedRegionIds.length === 0}
          onClick={() => groupSelectedRegions('Column')}
          className="px-2 py-1 bg-white border border-gray-300 rounded shadow-sm disabled:opacity-50 hover:bg-gray-50"
        >
          Group into Column
        </button>
      </div>

      <div 
        className={`flex-1 overflow-y-auto p-2 ${dragOverId === 'root' ? 'bg-gray-50 ring-inset ring-2 ring-blue-300' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDragEnter={() => setDragOverId('root')}
        onDragLeave={() => {
          if (dragOverId === 'root') setDragOverId(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOverId(null)
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
              .sort((a, b) => {
                if (a.readingOrder !== undefined && b.readingOrder !== undefined) return a.readingOrder - b.readingOrder
                if (a.readingOrder !== undefined) return -1
                if (b.readingOrder !== undefined) return 1
                if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber
                return a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x
              })
              .map(node => renderNode(node, 0))}
          </div>
        )}
      </div>
    </div>
  )
}
