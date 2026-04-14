import { useState } from 'react'
import { useTagStore } from '../hooks/useTagStore'
import { exportTaggedPDF } from '../lib/pdfExport'
import { PDFRegion } from '../lib/types'

function findOrphanedListItems(allRegions: PDFRegion[]): PDFRegion[] {
  const regionById = new Map(allRegions.map(r => [r.id, r]))
  return allRegions.filter(r => {
    if (r.tag !== 'ListItem') return false
    if (!r.parentId) return true
    const parent = regionById.get(r.parentId)
    return !parent || parent.tag !== 'List'
  })
}

export function ExportButton() {
  const { document, rawPdfBytes, docTitle, docLanguage } = useTagStore()
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [orphanWarning, setOrphanWarning] = useState<PDFRegion[] | null>(null)

  if (!document || !rawPdfBytes) return null

  const allRegions = document.pages.flatMap((p) => p.regions)
  const taggedCount = allRegions.filter((r) => r.tag !== null).length
  const totalCount = allRegions.length

  async function runExport() {
    if (!document || !rawPdfBytes) return
    setIsExporting(true)
    setError(null)
    setSuccess(false)
    setOrphanWarning(null)

    try {
      const bytes = await exportTaggedPDF(rawPdfBytes, document, docTitle, docLanguage)
      const defaultName = document.fileName.replace(/\.pdf$/i, '') + '-accessible.pdf'
      const savedPath = await window.electronAPI.saveFile(defaultName, bytes)
      if (savedPath) setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setIsExporting(false)
    }
  }

  function handleExport() {
    if (!document) return
    const orphans = findOrphanedListItems(allRegions)
    if (orphans.length > 0) {
      setOrphanWarning(orphans)
    } else {
      runExport()
    }
  }

  return (
    <>
      {orphanWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-2">List Item Warning</h3>
            <p className="text-sm text-gray-600 mb-3">
              {orphanWarning.length === 1
                ? '1 region tagged as List Item is not inside a List.'
                : `${orphanWarning.length} regions tagged as List Item are not inside a List.`}{' '}
              Screen readers may not announce them correctly.
            </p>
            <ul className="text-xs text-gray-500 mb-4 space-y-0.5 max-h-32 overflow-y-auto">
              {orphanWarning.map(r => (
                <li key={r.id} className="truncate">
                  Page {r.pageNumber}{r.ocrText ? `: "${r.ocrText.slice(0, 60)}${r.ocrText.length > 60 ? '…' : ''}"` : ''}
                </li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setOrphanWarning(null)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={runExport}
                className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                Export Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <button
          onClick={handleExport}
          disabled={isExporting || taggedCount === 0}
          className={`
            px-4 py-2 rounded-lg text-sm font-semibold transition-colors
            ${taggedCount === 0
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : isExporting
                ? 'bg-blue-400 text-white cursor-wait'
                : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
            }
          `}
        >
          {isExporting ? 'Exporting…' : `Export Accessible PDF (${taggedCount}/${totalCount} tagged)`}
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
        {success && <p className="text-xs text-green-600">Saved successfully.</p>}
      </div>
    </>
  )
}
