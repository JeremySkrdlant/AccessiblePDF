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

function getSelectedRegion(document: PDFDocumentMeta | null, id: string | null): PDFRegion | null {
  if (!document || !id) return null
  for (const page of document.pages) {
    const r = page.regions.find((region) => region.id === id)
    if (r) return r
  }
  return null
}

export function TagPanel() {
  const { document, selectedRegionId, updateRegion, selectRegion } = useTagStore()
  const region = getSelectedRegion(document, selectedRegionId)

  if (!region) {
    return (
      <div className="w-72 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Tag Panel</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-sm text-gray-400 text-center">
            Click a region on the document to tag it.
          </p>
        </div>
        <div className="p-3 border-t border-gray-100">
          <div className="text-xs text-gray-400 space-y-0.5">
            <div className="font-medium text-gray-500 mb-1">Keyboard shortcuts</div>
            <div>1–6 Headings · P Paragraph</div>
            <div>F Figure · C Caption · T Table</div>
            <div>L List · I List Item · A Artifact</div>
            <div>Esc Deselect</div>
          </div>
        </div>
      </div>
    )
  }

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

      {/* OCR preview */}
      {region.type === 'text' && region.ocrText && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-500 font-medium mb-1">OCR text</p>
          <p className="text-xs text-gray-700 line-clamp-3 font-mono">{region.ocrText}</p>
        </div>
      )}

      <div className="p-4 flex-1">
        {region.type === 'image' ? (
          <ImageAltEditor region={region} />
        ) : (
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
        )}
      </div>

      {/* Reading order override */}
      <div className="p-4 border-t border-gray-100">
        <label className="text-xs font-medium text-gray-500">
          Reading order (optional)
        </label>
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
