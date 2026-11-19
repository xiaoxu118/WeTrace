import { useState } from 'react'
import { Button, DatePicker, Select } from 'antd'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'

interface AnalysisFiltersProps {
  start: string
  end: string
  onRangeChange: (start: string, end: string) => void
  presets: { label: string; days: number | null; endOffset?: number }[]
  allowAll?: boolean
  member?: string
  members?: [string, string][]
  onMemberChange?: (member: string) => void
}

export function AnalysisFilters({ start, end, onRangeChange, presets, allowAll = false, member = '', members, onMemberChange }: AnalysisFiltersProps) {
  const [memberOpen, setMemberOpen] = useState(false)
  const today = dayjs().format('YYYY-MM-DD')
  return <div className="analysis-filters">
    <div className="analysis-filter-fields">
      {members && <div className="analysis-filter-member"><span>观察对象</span><Select aria-label="观察对象" value={member} open={memberOpen} onOpenChange={setMemberOpen} onChange={value => { onMemberChange?.(value); setMemberOpen(false) }} showSearch classNames={{ popup: { root: 'analysis-member-popup' } }} popupMatchSelectWidth={false} getPopupContainer={trigger => trigger.parentElement!} virtual={false} optionFilterProp="label" notFoundContent="未找到匹配成员" options={[{ value: '', label: '整个会话' }, ...members.map(([value, label]) => ({ value, label }))]} /></div>}
      <div className="analysis-filter-range"><span>统计时间</span><div className="analysis-date-fields">
        <DatePicker aria-label="开始日期" getPopupContainer={trigger => trigger.parentElement!} classNames={{ popup: { root: 'analysis-date-popup' } }} value={start ? dayjs(start).locale('zh-cn') : null} format="YYYY-MM-DD" placeholder="开始日期" allowClear={allowAll} disabledDate={date => date.isAfter(dayjs(), 'day') || !!end && date.isAfter(dayjs(end), 'day')} onChange={date => onRangeChange(date?.format('YYYY-MM-DD') ?? '', end)} />
        <span className="analysis-date-separator">至</span>
        <DatePicker aria-label="结束日期" getPopupContainer={trigger => trigger.parentElement!} classNames={{ popup: { root: 'analysis-date-popup' } }} value={end ? dayjs(end).locale('zh-cn') : null} format="YYYY-MM-DD" placeholder="结束日期" allowClear={allowAll} disabledDate={date => date.isAfter(dayjs(), 'day') || !!start && date.isBefore(dayjs(start), 'day')} onChange={date => onRangeChange(start, date?.format('YYYY-MM-DD') ?? '')} />
      </div></div>
    </div>
    <div className="analysis-presets" aria-label="快捷时间范围">{presets.map(({ label, days, endOffset = 0 }) => {
      const from = days === null ? '' : dayjs().subtract(endOffset + days - 1, 'day').format('YYYY-MM-DD')
      const to = days === null ? '' : endOffset ? dayjs().subtract(endOffset, 'day').format('YYYY-MM-DD') : today
      const active = start === from && end === to
      return <Button key={label} type={active ? 'primary' : 'default'} aria-pressed={active} onClick={() => onRangeChange(from, to)}>{label}</Button>
    })}</div>
  </div>
}
