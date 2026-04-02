import type { TagRole, PDFRegion, PDFDocumentMeta } from '../lib/types'
import { useTagStore } from '../hooks/useTagStore'
import { TagBadge } from './TagBadge'
import { ImageAltEditor } from './ImageAltEditor'

const TEXT_ROLES: { role: TagRole; label: string; key: string }[] = [
  { role: 'H1', label: 'Heading 1', key: '1' },
  { role: 'H2', label: 'Heading 2', key: '2' },
  { role: 'H3', label: 'Heading 3', key: '3' },
  { role: 'H4', label: 'Heading 4', key: '4' },
  { role: 'H5', label: 'Heading 5', key: '5' },
  { role: 'H6', label: 'Heading 6', key: '6' },
  { role: 'P', label: 'Paragraph', key: 'P' },
  { role: 'Caption', label: 'Caption', key: 'C' },
  { role: 'Table', label: 'Table', key: 'T' },
  { role: 'List', label: 'List', key: 'L' },
  { role: 'ListItem', label: 'List Item', key: 'I' },
  { role: 'Artifact', label: 'Artifact (decorative)', key: 'A' }
]

function findRegion(document: PDFDocumentMeta | null, id: string): PDFRegion | null {
  if (!document) return null
  for (const page of document.pages) {
    const r = page.regions.find((region) => region.id === id)
    if (r) return r
  }
  return null
}

export function TagPanel() {
  const { document, selectedRegionIds, updateRegion, selectRegion, mergeSelectedRegions } =
    useTagStore()

  const isMultiSelect = selectedRegionIds.length > 1
  const singleRegion =
    selectedRegionIds.length === 1 ? findRegion(document, selectedRegionIds[0]) : null

  // Nothing selected
  if (selectedRegionIds.length === 0) {
    return (
      <div className="w-72 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Tag Panel</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-sm text-gray-400 text-center">
            Click a region to tag it, or drag to select multiple.
          </p>
        </div>
        <div className="p-3 border-t border-gray-100">
          <div className="text-xs text-gray-400 space-y-0.5">
            <div className="font-medium text-gray-500 mb-1">Keyboard shortcuts</div>
            <div>1–6 Headings · P Paragraph</div>
            <div>F Figure · C Caption · T Table</div>
            <div>L List · I List Item · A Artifact</div>
            <div>Cmd+click to add to selection · Esc Deselect</div>
          </div>
        </div>
      </div>
    )
  }

  // Multiple regions selected — show merge UI
  if (isMultiSelect) {
    function applyTagToAll(role: TagRole) {
      for (const id of selectedRegionIds) {
        updateRegion(id, { tag: role })
      }
    }

    // Check if all selected regions are on the same page (required for merge)
    const pages = new Set(
      selectedRegionIds
        .map((id) => findRegion(document, id)?.pageNumber)
        .filter((p): p is number => p !== undefined)
    )
    const canMerge = pages.size === 1

    return (
      <div className="w-72 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            {selectedRegionIds.length} regions selected
          </h2>
          <button
            onClick={() => selectRegion(null)}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            aria-label="Deselect all"
          >
            ×
          </button>
        </div>

        {/* Merge action */}
        <div className="p-4 border-b border-gray-100">
          <button
            onClick={mergeSelectedRegions}
            disabled={!canMerge}
            className={`
              w-full py-2 px-3 rounded-lg text-sm font-semibold transition-colors
              ${canMerge
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }
            `}
          >
            Combine into one region
          </button>
          {!canMerge && (
            <p className="text-xs text-gray-400 mt-1.5">
              Regions must be on the same page to combine.
            </p>
          )}
        </div>

        {/* Apply tag to all selected */}
        <div className="p-4 flex-1">
          <p className="text-xs font-medium text-gray-500 mb-2">Apply tag to all selected</p>
          <div className="flex flex-col gap-1.5">
            {TEXT_ROLES.map(({ role, label, key }) => (
              <button
                key={role}
                onClick={() => applyTagToAll(role)}
                className="flex items-center justify-between px-3 py-2 rounded-md text-sm bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors text-left"
              >
                <span className="flex items-center gap-2">
                  <TagBadge tag={role} small />
                  <span>{label}</span>
                </span>
                <span className="text-xs text-gray-400">{key}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Single region selected
  const region = singleRegion
  if (!region) return null

  function setTag(role: TagRole) {
    updateRegion(region!.id, { tag: role })
  }

  return (
    <div className="w-72 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-y-auto">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Tag Region</h2>
        <button
          onClick={() => selectRegion(null)}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          aria-label="Close tag panel"
        >
          ×
        </button>
      </div>

      {region.type === 'text' && region.ocrText && region.tag !== 'Figure' && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-500 font-medium mb-1">OCR text</p>
          <p className="text-xs text-gray-700 line-clamp-3 font-mono">{region.ocrText}</p>
        </div>
      )}

      <div className="p-4 flex-1 flex flex-col gap-4">
        {/* Alt text editor — shown whenever tag is Figure */}
        {region.tag === 'Figure' || region.type === 'image' ? (
          <ImageAltEditor region={region} />
        ) : null}

        {/* Tag buttons — always shown so the user can re-tag */}
        <div className="flex flex-col gap-1.5">
          {TEXT_ROLES.map(({ role, label, key }) => {
            const isActive = region.tag === role
            return (
              <button
                key={role}
                onClick={() => setTag(isActive ? null : role)}
                className={`
                  flex items-center justify-between px-3 py-2 rounded-md text-sm
                  transition-colors text-left
                  ${isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }
                `}
              >
                <span className="flex items-center gap-2">
                  <TagBadge tag={role} small />
                  <span>{label}</span>
                </span>
                <span className={`text-xs ${isActive ? 'text-blue-200' : 'text-gray-400'}`}>
                  {key}
                </span>
              </button>
            )
          })}
          {region.tag && (
            <button
              onClick={() => setTag(null)}
              className="mt-1 text-xs text-gray-400 hover:text-gray-600 text-left"
            >
              Clear tag
            </button>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-gray-100">
        <label className="text-xs font-medium text-gray-500">Reading order (optional)</label>
        <input
          type="number"
          min={0}
          value={region.readingOrder ?? ''}
          placeholder="Auto"
          onChange={(e) => {
            const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10)
            updateRegion(region.id, { readingOrder: val })
          }}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    </div>
  )
}
