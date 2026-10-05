'use client';
import { Button, Field, Input } from '@remix/ui';
import type { StudentListItem } from '@remix/types/api';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { FeeError, type FeeFailure, feeFailure } from './fee-error';

export function StudentSearch({ onChoose, focus = false, disabled = false }: { onChoose: (student: StudentListItem) => void; focus?: boolean; disabled?: boolean }) {
  const t = useTranslations('fees'); const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(''); const [results, setResults] = useState<StudentListItem[] | null>(null);
  const [busy, setBusy] = useState(false); const [failure, setFailure] = useState<FeeFailure | null>(null);
  const generation = useRef({ value: 0 });
  useEffect(() => { const sequence = generation.current; if (focus) input.current?.focus(); return () => { sequence.value++; }; }, [focus]);
  async function search() {
    if (!q.trim() || busy || disabled) return;
    const version = ++generation.current.value;
    setBusy(true); setFailure(null); setResults(null);
    try {
      const response = await createBrowserApi().api.call('listStudents', { query: { q: q.trim(), pageSize: 25 } });
      if (version === generation.current.value) setResults(response.items);
    } catch (err) { if (version === generation.current.value) setFailure(feeFailure(err)); }
    finally { if (version === generation.current.value) setBusy(false); }
  }
  return <div className="flex flex-col gap-3">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <Field className="flex-1" label={t('search')} hint={t('searchHint')}><Input ref={input} value={q} maxLength={80} disabled={disabled} onChange={e => { generation.current.value++; setBusy(false); setQ(e.target.value); setResults(null); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void search(); } }} /></Field>
      <Button size="lg" type="button" variant="secondary" className="sm:mt-6" disabled={!q.trim() || disabled} loading={busy} onClick={() => void search()}><Search aria-hidden size={18} />{t('searchButton')}</Button>
    </div>
    <FeeError failure={failure} />
    {results?.length === 0 ? <p role="status" className="m-0 text-muted">{t('noStudents')}</p> : null}
    {results?.length ? <ul aria-label={t('student')} className="m-0 list-none divide-y divide-line rounded-lg border border-line bg-surface p-0">{results.map(s => <li key={s.id}><button type="button" disabled={disabled} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand" onClick={() => { onChoose(s); setResults(null); }} aria-label={t('chooseStudent', { name: s.displayName, number: s.studentNo })}><span className="font-semibold">{s.displayName}<span className="block text-sm font-normal text-muted">{s.phone}</span></span><span className="text-sm text-muted">{s.studentNo}</span></button></li>)}</ul> : null}
  </div>;
}
