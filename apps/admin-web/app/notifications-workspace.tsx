'use client';

import {
  NotificationAttemptListResponseSchema,
  NotificationIntentListResponseSchema,
  type NotificationAttempt,
  type NotificationAttemptListResponse,
  type NotificationIntent,
  type NotificationIntentListResponse,
} from '@carespaces/api-contracts';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Link2,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type StatusFilter = 'active' | NotificationIntent['status'];
type ClassFilter = 'ALL' | NotificationIntent['notificationClass'];

const classLabels: Record<NotificationIntent['notificationClass'], string> = {
  incident_ack: 'Incident ACK',
  sos: 'SOS',
  credential_expiry_block: 'Credential block',
  replacement_failed: 'Replacement failed',
  shift_reminder: 'Shift reminder',
  reservation_expiry: 'Reservation expiry',
  payment_expiry: 'Payment expiry',
  customer_approval_reminder: 'Approval reminder',
  dispute_update: 'Dispute update',
  payout_retry: 'Payout retry',
  system: 'System',
};

const criticalClasses: ReadonlySet<NotificationIntent['notificationClass']> =
  new Set(['incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed']);

export function NotificationsWorkspace() {
  const [projection, setProjection] =
    useState<NotificationIntentListResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<NotificationAttemptListResponse | null>(
    null,
  );
  const [classFilter, setClassFilter] = useState<ClassFilter>('ALL');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/notifications/intents?limit=100', {
        headers: { Authorization: 'Bearer fake:admin-001' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Notification data is unavailable');
      const next = NotificationIntentListResponseSchema.parse(
        await response.json(),
      );
      setProjection(next);
      setSelectedId((current) => current ?? next.intents[0]?.id ?? null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Notification data is unavailable',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredIntents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (projection?.intents ?? []).filter((intent) => {
      if (classFilter !== 'ALL' && intent.notificationClass !== classFilter)
        return false;
      if (
        status === 'active' &&
        !['PENDING', 'LEASED'].includes(intent.status)
      )
        return false;
      if (status !== 'active' && intent.status !== status) return false;
      if (
        needle &&
        !`${intent.notificationClass} ${intent.subjectType} ${intent.subjectId} ${intent.recipientRef}`
          .toLowerCase()
          .includes(needle)
      )
        return false;
      return true;
    });
  }, [projection, classFilter, status, search]);

  const selected =
    filteredIntents.find((intent) => intent.id === selectedId) ??
    filteredIntents[0] ??
    null;

  useEffect(() => {
    if (!selected) {
      setAttempts(null);
      return;
    }
    setLoadingAttempts(true);
    setError(null);
    fetch(`/api/v1/notifications/intents/${selected.id}/attempts`, {
      headers: { Authorization: 'Bearer fake:admin-001' },
      cache: 'no-store',
    })
      .then((response) => {
        if (!response.ok) throw new Error('Attempt timeline is unavailable');
        return response.json();
      })
      .then((body) =>
        NotificationAttemptListResponseSchema.parse(body),
      )
      .then((data) => setAttempts(data))
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : 'Attempt timeline failed',
        ),
      )
      .finally(() => setLoadingAttempts(false));
  }, [selected?.id]);

  const pendingCount = (projection?.intents ?? []).filter((intent) =>
    ['PENDING', 'LEASED'].includes(intent.status),
  ).length;

  return (
    <main className="ops-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Bell size={18} />
          </span>
          <div>
            <strong>Carespaces</strong>
            <span>Notification center</span>
          </div>
        </div>
        <nav aria-label="Notification classes">
          <p className="nav-label">Classes</p>
          <button
            className={classFilter === 'ALL' ? 'nav-item active' : 'nav-item'}
            onClick={() => setClassFilter('ALL')}
          >
            <Bell size={17} />
            <span>All notifications</span>
            <b>{pendingCount}</b>
          </button>
          {Object.entries(classLabels).map(([value, label]) => {
            const count = (projection?.intents ?? []).filter(
              (intent) =>
                intent.notificationClass === value &&
                ['PENDING', 'LEASED'].includes(intent.status),
            ).length;
            if (count === 0 && value !== 'incident_ack') return null;
            return (
              <button
                key={value}
                className={
                  classFilter === value ? 'nav-item active' : 'nav-item'
                }
                onClick={() => setClassFilter(value as ClassFilter)}
              >
                {criticalClasses.has(value as NotificationIntent['notificationClass']) ? (
                  <ShieldAlert size={17} />
                ) : (
                  <Bell size={17} />
                )}
                <span>{label}</span>
                <b>{count}</b>
              </button>
            );
          })}
          <Link className="nav-item" href="/">
            <ChevronRight size={17} />
            <span>Back to Ops workspace</span>
          </Link>
        </nav>
        <div className="operator">
          <span>AP</span>
          <div>
            <strong>Admin fixture</strong>
            <small>Notification ops</small>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p>Notifications</p>
            <h1>Intent center</h1>
          </div>
          <button
            className="icon-button"
            title="Refresh notifications"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={18} className={loading ? 'spinning' : ''} />
          </button>
        </header>

        <div className="toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search class, subject, recipient"
            />
          </label>
          <select
            aria-label="Status filter"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            <option value="active">Active</option>
            <option value="PENDING">Pending</option>
            <option value="LEASED">Leased</option>
            <option value="DELIVERED">Delivered</option>
            <option value="TERMINAL_FAILED">Terminal failed</option>
          </select>
        </div>

        {error ? (
          <div className="error-banner">
            <AlertTriangle size={17} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="work-grid">
          <section className="task-list" aria-label="Notification intents">
            <div className="list-heading">
              <span>{filteredIntents.length} intents</span>
              <span>Class · status</span>
            </div>
            {loading && !projection ? <LoadingRows /> : null}
            {!loading && filteredIntents.length === 0 ? (
              <div className="empty-state">
                <CheckCircle2 size={28} />
                <strong>No notifications</strong>
                <span>No intents match this view.</span>
              </div>
            ) : null}
            {filteredIntents.map((intent) => (
              <button
                key={intent.id}
                className={
                  selected?.id === intent.id ? 'task-row selected' : 'task-row'
                }
                onClick={() => setSelectedId(intent.id)}
              >
                <span
                  className={`priority-dot ${
                    criticalClasses.has(intent.notificationClass)
                      ? 'critical'
                      : 'normal'
                  }`}
                />
                <span className="task-copy">
                  <strong>
                    {classLabels[intent.notificationClass] ??
                      intent.notificationClass}
                  </strong>
                  <small>
                    {intent.channel} · {humanize(intent.subjectType)}
                  </small>
                </span>
                <span className="task-meta">
                  <b className={`status ${intent.status.toLowerCase()}`}>
                    {intent.status}
                  </b>
                  <small>Attempts: {intent.attempts}</small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
          </section>

          <aside className="detail-pane" aria-label="Intent detail">
            {selected ? (
              <>
                <div className="detail-heading">
                  {criticalClasses.has(selected.notificationClass) ? (
                    <span className="priority-badge critical">Critical</span>
                  ) : (
                    <span className="priority-badge normal">Standard</span>
                  )}
                  <span>{classLabels[selected.notificationClass]}</span>
                </div>
                <h2>{selected.bodyRedacted}</h2>
                <p className="subject-line">
                  {humanize(selected.subjectType)} · {shortId(selected.subjectId)}
                </p>
                <dl>
                  <div>
                    <dt>
                      <Clock3 size={15} />
                      Next attempt
                    </dt>
                    <dd className={isOverdue(selected) ? 'overdue' : ''}>
                      {dateTime(selected.nextAttemptAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <Bell size={15} />
                      Channel
                    </dt>
                    <dd>{selected.channel}</dd>
                  </div>
                  <div>
                    <dt>
                      <CheckCircle2 size={15} />
                      Delivered at
                    </dt>
                    <dd>{dateTime(selected.deliveredAt)}</dd>
                  </div>
                  <div>
                    <dt>
                      <XCircle size={15} />
                      Terminal failure
                    </dt>
                    <dd>{dateTime(selected.terminalFailedAt)}</dd>
                  </div>
                  {selected.opsTaskId ? (
                    <div>
                      <dt>
                        <Link2 size={15} />
                        Ops Task fallback
                      </dt>
                      <dd>
                        <Link href={`/`}>{shortId(selected.opsTaskId)}</Link>
                      </dd>
                    </div>
                  ) : null}
                  {selected.lastError ? (
                    <div>
                      <dt>
                        <AlertTriangle size={15} />
                        Last error
                      </dt>
                      <dd className="overdue">{selected.lastError}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="detail-actions">
                  <h3>Delivery attempts</h3>
                  {loadingAttempts ? (
                    <p className="subject-line">Loading attempts…</p>
                  ) : attempts && attempts.attempts.length > 0 ? (
                    <ul className="attempt-timeline">
                      {attempts.attempts.map((attempt) => (
                        <AttemptRow key={attempt.id} attempt={attempt} />
                      ))}
                    </ul>
                  ) : (
                    <p className="subject-line">
                      No delivery attempts recorded yet.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-detail">
                <Bell size={26} />
                <span>Select a notification intent</span>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

function AttemptRow({ attempt }: { attempt: NotificationAttempt }) {
  const icon =
    attempt.status === 'FIRED' ? (
      <CheckCircle2 size={16} />
    ) : attempt.status === 'DEAD_LETTER' ? (
      <XCircle size={16} />
    ) : (
      <AlertTriangle size={16} />
    );
  return (
    <li className={`attempt-row ${attempt.status.toLowerCase()}`}>
      <span className="attempt-icon">{icon}</span>
      <div>
        <strong>
          Attempt {attempt.attemptNumber} · {attempt.adapterName}
        </strong>
        <small>
          {attempt.status}
          {attempt.providerMessageRef
            ? ` · ref ${shortId(attempt.providerMessageRef)}`
            : ''}
        </small>
        {attempt.errorMessage ? (
          <small className="overdue">
            {attempt.errorClass}: {attempt.errorMessage}
          </small>
        ) : null}
        <small>{dateTime(attempt.completedAt ?? attempt.startedAt)}</small>
      </div>
    </li>
  );
}

function LoadingRows() {
  return (
    <>
      {[1, 2, 3].map((item) => (
        <div className="task-row skeleton" key={item} />
      ))}
    </>
  );
}

function humanize(value: string) {
  return value
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortId(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function dateTime(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value));
}

function isOverdue(intent: NotificationIntent) {
  return (
    ['PENDING', 'LEASED'].includes(intent.status) &&
    new Date(intent.nextAttemptAt).getTime() < Date.now()
  );
}