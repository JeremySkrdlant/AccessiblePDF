import { useEffect } from 'react'
import type { PDFRegion, TagRole } from '../lib/types'
import { TagBadge } from './TagBadge'
import { useTagStore } from '../hooks/useTagStore'

interface RegionOverlayProps {
  regions: PDFRegion[]
  canvasWidth: number
  canvasHeight: number
  selectedRegionId: string | null
}

// Map keyboard keys to tag roles
const KEY_TO_TAG: Record<string, TagRole> = {
  '1': 'H1', '2': 'H2', '3': 'H3', '4': 'H4', '5': 'H5', '6': 'H6',
  p: 'P',
  f: 'Figure',
  c: 'Caption',
  t: 'Table',
  l: 'List',
  i: 'ListItem',
  a: 'Artifact'
}

export function RegionOverlay({
  regions,
  canvasWidth,
  canvasHeight,
  selectedRegionId
}: RegionOverlayProps) {
  const { selectRegion, updateRegion } = useTagStore()

  // Global keyboard shortcuts when a region is selected
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignore when typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'Escape') {
        selectRegion(null)
        return
      }
      const role = KEY_TO_TAG[e.key.toLowerCase()]
      if (role && selectedRegionId) {
        updateRegion(selectedRegionId, { tag: role })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedRegionId, selectRegion, updateRegion])

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ width: canvasWidth, height: canvasHeight }}
    >
      {regions.map((region) => {
        const x = region.bbox.x * canvasWidth
        const y = region.bbox.y * canvasHeight
        const w = region.bbox.width * canvasWidth
        const h = region.bbox.height * canvasHeight
        const isSelected = region.id === selectedRegionId
        const hasTag = region.tag !== null

        return (
          <div
            key={region.id}
            className={`
              absolute pointer-events-auto cursor-pointer
              transition-all duration-100
              ${isSelected
                ? 'border-2 border-blue-500 bg-blue-500/10 z-20'
                : hasTag
                  ? 'border border-blue-300 bg-transparent hover:bg-blue-500/5 z-10'
                  : 'border border-transparent hover:border-gray-400 hover:bg-gray-500/5 z-10'
              }
            `}
            style={{ left: x, top: y, width: w, height: h }}
            onClick={(e) => {
              e.stopPropagation()
              selectRegion(region.id)
            }}
          >
            {(hasTag || isSelected) && (
              <div className="absolute -top-4 left-0">
                <TagBadge tag={region.tag} small />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
