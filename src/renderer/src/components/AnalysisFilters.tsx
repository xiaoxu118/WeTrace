import { Button, DatePicker, Select } from 'antd'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'

interface AnalysisFiltersProps {
  start: string
  end: string
  onRangeChange: (start: string, end: string) => void
  presets: { label: string; days: number | null }[]
  allowAll?: boolean
  member?: string
  members?: [string, string][]
  onMemberChange?: (member: string) => void
}

export function AnalysisFilters({ start, end, onRangeChange, presets, allowAll = false, member = '', members, onMemberChange }: AnalysisFiltersProps) {
  const today = dayjs().format('YYYY-MM-DD')
  return <div className="analysis-filters">
    <div className="analysis-filter-fields">
      {members && <div className="analysis-filter-member"><span>观察对象</span><Select aria-label="观察对象" value={member} onChange={onMemberChange} showSearch optionFilterProp="label" options={[{ value: '', label: '整个会话' }, ...members.map(([value, label]) => ({ value, label }))]} /></div>}
      <div className="analysis-filter-range"><span>统计时间</span><DatePicker.RangePicker value={start && end ? [dayjs(start).locale('zh-cn'), dayjs(end).locale('zh-cn')] : null} format="YYYY-MM-DD" placeholder={['开始日期', '结束日期']} allowClear={allowAll} disabledDate={date => date.isAfter(dayjs(), 'day')} onChange={dates => {
        if (dates?.[0] && dates[1]) onRangeChange(dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD'))
        else if (allowAll) onRangeChange('', '')
      }} /></div>
    </div>
    <div className="analysis-presets" aria-label="快捷时间范围">{presets.map(({ label, days }) => {
      const from = days === null ? '' : dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD')
      const to = days === null ? '' : today
      const active = start === from && end === to
      return <Button key={label} type={active ? 'primary' : 'default'} aria-pressed={active} onClick={() => onRangeChange(from, to)}>{label}</Button>
    })}</div>
  </div>
}
