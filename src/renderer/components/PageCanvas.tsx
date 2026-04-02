import { useEffect, useRef, useState } from 'react'
import { useTagStore } from '../hooks/useTagStore'
import { RegionOverlay } from './RegionOverlay'

interface PageCanvasProps {
  pageNum: number
  containerWidth: number
  renderPage: (pageNum: number, containerWidth: number) => Promise<{
    canvas: HTMLCanvasElement
    scale: number
    widthPt: number
    heightPt: number
  }>
}

export function PageCanvas({ pageNum, containerWidth, renderPage }: PageCanvasProps) {
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null)
  const [isRendering, setIsRendering] = useState(true)
  const regions = useTagStore(
    (state) => state.document?.pages.find((p) => p.pageNumber === pageNum)?.regions ?? []
  )
  const selectedRegionIds = useTagStore((state) => state.selectedRegionIds)
  const selectRegion = useTagStore((state) => state.selectRegion)

  useEffect(() => {
    let cancelled = false
    setIsRendering(true)

    renderPage(pageNum, containerWidth).then(({ canvas }) => {
      if (cancelled || !canvasContainerRef.current) return
      canvasContainerRef.current.innerHTML = ''
      canvasContainerRef.current.appendChild(canvas)
      setDimensions({ w: canvas.width, h: canvas.height })
      setIsRendering(false)
    })

    return () => {
      cancelled = true
    }
  }, [pageNum, containerWidth])

  return (
    <div className="relative mb-6 shadow-lg bg-white" style={{ width: containerWidth }}>
      {/* Page number label */}
      <div className="absolute -top-6 left-0 text-xs text-gray-400 select-none">
        Page {pageNum}
      </div>

      {/* Canvas mount point */}
      <div
        ref={canvasContainerRef}
        className="relative"
        style={{ minHeight: dimensions?.h ?? 200 }}
        onClick={() => selectRegion(null)}
      />

      {/* Loading overlay */}
      {isRendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <span className="text-sm text-gray-400">Rendering…</span>
        </div>
      )}

      {/* Region overlay */}
      {!isRendering && dimensions && (
        <div className="absolute top-0 left-0">
          <RegionOverlay
            regions={regions}
            canvasWidth={dimensions.w}
            canvasHeight={dimensions.h}
            selectedRegionIds={selectedRegionIds}
            pageNum={pageNum}
          />
        </div>
      )}
    </div>
  )
}
