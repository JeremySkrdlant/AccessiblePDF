import { useCallback, useState } from 'react'

interface DropZoneProps {
  onPDFLoaded: (bytes: ArrayBuffer, fileName: string, filePath: string) => void
}

export function DropZone({ onPDFLoaded }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function readFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setError('Please drop a PDF file.')
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer
      onPDFLoaded(buffer, file.name, file.name)
    }
    reader.readAsArrayBuffer(file)
  }

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) readFile(file)
    },
    []
  )

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const onDragLeave = () => setIsDragging(false)

  async function openViaDialog() {
    const result = await window.electronAPI.openFile()
    if (!result) return
    const parts = result.path.replace(/\\/g, '/').split('/')
    const fileName = parts[parts.length - 1]
    onPDFLoaded(result.buffer, fileName, result.path)
  }

  return (
    <div className="flex items-center justify-center h-full bg-gray-50">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`
          flex flex-col items-center justify-center gap-4
          w-[480px] h-[320px] rounded-2xl border-2 border-dashed
          transition-colors cursor-pointer select-none
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/50'}
        `}
        onClick={openViaDialog}
      >
        <svg className="w-16 h-16 text-gray-300" fill="none" viewBox="0 0 64 64" stroke="currentColor" strokeWidth={1.5}>
          <rect x="8" y="4" width="40" height="52" rx="4" />
          <path d="M36 4v16h16" strokeLinejoin="round" />
          <path d="M20 36h24M20 44h16" strokeLinecap="round" />
        </svg>
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-700">Drop a PDF here</p>
          <p className="text-sm text-gray-400 mt-1">or click to browse</p>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  )
}
