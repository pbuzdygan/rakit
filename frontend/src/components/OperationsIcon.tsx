import type { HTMLAttributes } from 'react';

export type OperationsIconName =
  | 'overview'
  | 'rack'
  | 'network'
  | 'ports'
  | 'power'
  | 'audit'
  | 'menu'
  | 'search'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'lock'
  | 'plus'
  | 'refresh'
  | 'link'
  | 'download'
  | 'server'
  | 'edit'
  | 'trash'
  | 'close'
  | 'chevron'
  | 'filter'
  | 'check'
  | 'activity'
  | 'comment'
  | 'more';

const ICON_FILES: Record<OperationsIconName, string> = {
  overview: 'layout-dashboard',
  rack: 'server-2',
  network: 'network',
  ports: 'plug-connected',
  power: 'power',
  audit: 'clipboard-list',
  menu: 'menu-2',
  search: 'search',
  settings: 'settings',
  sun: 'sun',
  moon: 'moon',
  lock: 'lock',
  plus: 'plus',
  refresh: 'refresh',
  link: 'link',
  download: 'download',
  server: 'server',
  edit: 'edit',
  trash: 'trash',
  close: 'x',
  chevron: 'chevron-right',
  filter: 'filter',
  check: 'check',
  activity: 'activity',
  comment: 'message',
  more: 'dots',
};

export function OperationsIcon({ name, className, style, ...props }: HTMLAttributes<HTMLSpanElement> & { name: OperationsIconName }) {
  const source = `/icons/ui/${ICON_FILES[name]}.svg`;

  return (
    <span
      {...props}
      aria-hidden="true"
      className={`ops-icon${className ? ` ${className}` : ''}`}
      style={{ WebkitMaskImage: `url("${source}")`, maskImage: `url("${source}")`, ...style }}
    />
  );
}
