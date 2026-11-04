import { Button } from 'antd'
import type { ComponentProps } from 'react'

/** Retain native button events and form semantics while sharing the application theme. */
export function ActionButton({ type = 'button', className = '', ...props }: Omit<ComponentProps<'button'>, 'color'>) {
  const classes = new Set(className.split(/\s+/))
  return <Button {...props} htmlType={type} className={className}
    type={classes.has('primary') ? 'primary' : 'default'}
    danger={classes.has('danger')} size={classes.has('sm') ? 'small' : 'middle'} />
}
