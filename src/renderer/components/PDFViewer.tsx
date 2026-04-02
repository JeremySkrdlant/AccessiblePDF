import { useRef, useState, useEffect } from 'react'
import { PageCanvas } from './PageCanvas'

interface PDFViewerProps {
  pageCount: number
  renderPage: (pageNum: number, containerWidth: number) => Promise<{
    canvas: HTMLCanvasElement
    scale: number
    widthPt: number
    heightPt: number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfJsPage: any
  }>
}

const VIEWER_PADDING = 32 // px horizontal padding inside the scroll area
const RENDER_AHEAD = 2    // number of pages to render outside visible area

export function PDFViewer({ pageCount, renderPage }: PDFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1]))
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Measure container width
  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth - VIEWER_PADDING * 2)
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Use IntersectionObserver to track which pages are visible
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev)
          entries.forEach((entry) => {
            const num = Number((entry.target as HTMLElement).dataset.page)
            if (entry.isIntersecting) {
              // Also render ahead
              for (let i = Math.max(1, num - RENDER_AHEAD); i <= Math.min(pageCount, num + RENDER_AHEAD); i++) {
                next.add(i)
              }
            }
          })
          return next
        })
      },
      { root: containerRef.current, rootMargin: '200px 0px' }
    )

    pageRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [pageCount, containerWidth])

  if (!pageCount || !containerWidth) {
    return <div ref={containerRef} className="flex-1 overflow-y-auto" />
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto bg-gray-200">
      <div className="flex flex-col items-center py-8 gap-0" style={{ paddingLeft: VIEWER_PADDING, paddingRight: VIEWER_PADDING }}>
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNum) => (
          <div
            key={pageNum}
            ref={(el) => {
              if (el) pageRefs.current.set(pageNum, el)
              else pageRefs.current.delete(pageNum)
            }}
            data-page={pageNum}
            style={{ width: containerWidth, minHeight: 200, marginBottom: 24, marginTop: 24 }}
          >
            {visiblePages.has(pageNum) && (
              <PageCanvas
                pageNum={pageNum}
                containerWidth={containerWidth}
                renderPage={renderPage}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
