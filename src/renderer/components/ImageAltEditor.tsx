import { useState, useEffect } from 'react'
import type { PDFRegion } from '../lib/types'
import { useTagStore } from '../hooks/useTagStore'

interface ImageAltEditorProps {
  region: PDFRegion
}

export function ImageAltEditor({ region }: ImageAltEditorProps) {
  const { updateRegion } = useTagStore()
  const [isDecorative, setIsDecorative] = useState(region.tag === 'Artifact')
  const [altText, setAltText] = useState(region.altText ?? '')

  // Sync when region changes
  useEffect(() => {
    setIsDecorative(region.tag === 'Artifact')
    setAltText(region.altText ?? '')
  }, [region.id])

  function handleDecorativeChange(checked: boolean) {
    setIsDecorative(checked)
    if (checked) {
      updateRegion(region.id, { tag: 'Artifact', altText: undefined })
    } else {
      updateRegion(region.id, { tag: 'Figure', altText: altText || undefined })
    }
  }

  function handleAltChange(text: string) {
    setAltText(text)
    updateRegion(region.id, { altText: text || undefined })
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isDecorative}
          onChange={(e) => handleDecorativeChange(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-700">Decorative — skip for screen readers</span>
      </label>

      {!isDecorative && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Alt text
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <textarea
            value={altText}
            onChange={(e) => handleAltChange(e.target.value)}
            placeholder="Describe the image for screen reader users…"
            rows={3}
            className="
              w-full rounded-md border border-gray-300 px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
              resize-none
            "
          />
          {!altText && (
            <p className="text-xs text-amber-600">
              Alt text is required for non-decorative images.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
