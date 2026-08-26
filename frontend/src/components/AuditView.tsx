import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Api } from '../api';
import { useAppStore } from '../store';
import { formatDateTime } from '../utils/dateTime';
import { OperationsIcon } from './OperationsIcon';

export function AuditView() {
  const timeZone = useAppStore((state) => state.timeZone);
  const [filter, setFilter] = useState('');
  const [result, setResult] = useState('all');
  const [objectType, setObjectType] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['audit-page', filter, result, objectType],
    queryFn: ({ pageParam }) => Api.auditPage({ limit: 100, cursor: pageParam as number | null, query: filter.trim(), result, objectType }),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
  const events = query.data?.pages.flatMap((page: any) => page.events ?? []) ?? [];
  const firstPage = query.data?.pages[0] as any;
  const objectTypes = (firstPage?.objectTypes ?? []) as string[];
  const total = Number(firstPage?.total ?? 0);

  const exportCsv = async () => {
    setExporting(true); setError('');
    try { await Api.exportAudit({ query: filter.trim(), result, objectType }); }
    catch (reason) { setError(readError(reason)); }
    finally { setExporting(false); }
  };

  return <section className="ops-panel ops-table-panel">
    <div className="ops-panel-toolbar ops-panel-toolbar--wrap">
      <div className="ops-filter-input"><OperationsIcon name="search" /><input data-module-search value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search operation, object or details…" /></div>
      <select className="ops-compact-select" value={result} onChange={(event) => setResult(event.target.value)}><option value="all">All results</option><option value="success">Success</option><option value="error">Error</option></select>
      <select className="ops-compact-select" value={objectType} onChange={(event) => setObjectType(event.target.value)}><option value="all">All object types</option>{objectTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>
      <div className="ops-toolbar-spacer" />
      <span className="ops-toolbar-count">{total.toLocaleString()} events</span>
      <button className="ops-button ops-button--secondary" disabled={exporting} onClick={exportCsv}><OperationsIcon name="download" /> {exporting ? 'Exporting…' : 'Export CSV'}</button>
      <button className="ops-button ops-button--secondary" disabled={query.isFetching} onClick={() => query.refetch()}><OperationsIcon name="refresh" /> Refresh</button>
    </div>
    {error ? <div className="ops-notice ops-notice--error">{error}<button onClick={() => setError('')}><OperationsIcon name="close" /></button></div> : null}
    <div className="ops-table-wrap">
      <table className="ops-table ops-audit-table">
        <thead><tr><th>Time</th><th>Operation</th><th>Object</th><th>Details</th><th>Result</th></tr></thead>
        <tbody>{events.map((event: any) => <tr key={event.id}>
          <td className="ops-mono" data-label="Time">{formatDateTime(event.createdAt, timeZone)}</td><td data-label="Operation"><strong>{event.action}</strong></td><td className="ops-mono" data-label="Object">{event.objectType}{event.objectId ? ` #${event.objectId}` : ''}</td><td className="ops-muted" data-label="Details">{event.details || '—'}</td><td data-label="Result"><span className={`ops-state ops-state--${event.result === 'error' ? 'danger' : 'ok'}`}>{event.result}</span></td>
        </tr>)}</tbody>
      </table>
      {!query.isLoading && !events.length ? <div className="ops-empty-inline">No audit events match these filters.</div> : null}
    </div>
    {query.hasNextPage ? <div className="ops-load-more"><button className="ops-button ops-button--secondary" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading…' : `Load more (${events.length} of ${total})`}</button></div> : null}
  </section>;
}

function readError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  try { return JSON.parse(message).error || message; } catch { return message || 'Export failed'; }
}
