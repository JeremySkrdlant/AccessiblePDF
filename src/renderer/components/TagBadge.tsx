import type { TagRole } from '../lib/types'

interface TagBadgeProps {
  tag: TagRole
  small?: boolean
}

const TAG_COLORS: Record<NonNullable<TagRole>, string> = {
  H1: 'bg-blue-600 text-white',
  H2: 'bg-blue-500 text-white',
  H3: 'bg-blue-400 text-white',
  H4: 'bg-blue-300 text-blue-900',
  H5: 'bg-blue-200 text-blue-900',
  H6: 'bg-blue-100 text-blue-900',
  P: 'bg-gray-400 text-white',
  Figure: 'bg-green-500 text-white',
  Caption: 'bg-green-300 text-green-900',
  Table: 'bg-purple-500 text-white',
  List: 'bg-yellow-400 text-yellow-900',
  ListItem: 'bg-yellow-300 text-yellow-900',
  Artifact: 'bg-red-400 text-white'
}

const TAG_LABELS: Record<NonNullable<TagRole>, string> = {
  H1: 'H1', H2: 'H2', H3: 'H3', H4: 'H4', H5: 'H5', H6: 'H6',
  P: 'P',
  Figure: 'Fig',
  Caption: 'Cap',
  Table: 'Tbl',
  List: 'List',
  ListItem: 'LI',
  Artifact: 'Art'
}

export function TagBadge({ tag, small = false }: { tag: string | null; small?: boolean }) {
  if (!tag) return null
  const role = tag as NonNullable<TagRole>
  const color = TAG_COLORS[role] || 'bg-indigo-500 text-white'
  const label = TAG_LABELS[role] || tag
  const size = small ? 'text-[10px] px-1 py-0' : 'text-xs px-1.5 py-0.5'
  return (
    <span className={`inline-block rounded font-bold leading-tight ${size} ${color}`}>
      {label}
    </span>
  )
}
