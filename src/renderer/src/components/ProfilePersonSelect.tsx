import { Select } from 'antd'
import { useRef, useState } from 'react'

const pageSize = 20

export function ProfilePersonSelect({ label, options, value, onChange, loading, disabled, empty }: {
  label: string
  options: { id: string; name: string }[]
  value?: string
  onChange: (id: string) => void
  loading?: boolean
  disabled?: boolean
  empty: string
}) {
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const scrollContainer = useRef<HTMLElement | null>(null)
  const names = options.map(item => item.name && item.name !== item.id ? item.name : `未命名${label}`)
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  const seen = new Map<string, number>()
  const choices = options.map((item, index) => {
    const name = names[index]
    const number = (seen.get(name) ?? 0) + 1
    seen.set(name, number)
    return { value: item.id, label: counts.get(name)! > 1 ? `${name}（${number}）` : name }
  })
  const filtered = choices.filter(item => item.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  function resetResults(text: string) {
    setSearch(text)
    setVisibleCount(pageSize)
    if (scrollContainer.current) scrollContainer.current.scrollTop = 0
  }

  return (
    <div className="profile-select">
      <Select
        aria-label={label} placeholder={`选择${label}`} value={value} onChange={onChange}
        getPopupContainer={trigger => trigger.parentElement!}
        classNames={{ popup: { root: 'profile-select-popup' } }}
        loading={loading} disabled={disabled} notFoundContent={empty} virtual={false}
        showSearch={{ searchValue: search, filterOption: false, onSearch: resetResults }}
        onOpenChange={open => { if (!open) resetResults('') }}
        onPopupScroll={event => {
          const list = event.currentTarget
          scrollContainer.current = list
          if (list.scrollHeight - list.scrollTop - list.clientHeight <= 2 && visibleCount < filtered.length) {
            setVisibleCount(visibleCount + pageSize)
          }
        }}
        options={filtered.slice(0, visibleCount)}
        labelRender={({ value: selected }) => choices.find(item => item.value === selected)?.label ?? ''}
      />
    </div>
  )
}
