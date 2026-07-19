'use client';

import {
  OpsTaskListResponseSchema,
  OpsTaskSchema,
  type OpsTask,
  type OpsTaskListResponse,
} from '@carespaces/api-contracts';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  HeartPulse,
  Inbox,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRoundCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminHomeContent } from './page-content';

type QueueFilter = 'ALL' | OpsTask['queue'];
type OwnershipFilter = 'all' | 'mine' | 'unassigned';
type StatusFilter = 'active' | OpsTask['status'];

const queueLabels: Record<OpsTask['queue'], string> = {
  VERIFICATION: 'Verification',
  CLINICAL: 'Clinical',
  URGENT: 'Urgent',
  INCIDENT: 'Incidents',
  REPLACEMENT: 'Replacements',
  DISPUTE: 'Disputes',
  FINANCE: 'Finance',
  GENERAL: 'General',
};

const taskLabels: Record<string, string> = {
  'incident.active_triage': 'Triage active incident',
  'replacement.coverage_search': 'Find replacement coverage',
  'assignment.provider_cancelled': 'Provider cancelled assignment',
};

const resolutionOptions = [
  ['incident_routed', 'Incident routed'],
  ['replacement_coordinated', 'Replacement coordinated'],
  ['customer_contacted', 'Customer contacted'],
  ['no_action_required', 'No action required'],
] as const;

export function OpsWorkspace() {
  const [projection, setProjection] = useState<OpsTaskListResponse | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueFilter>('ALL');
  const [ownership, setOwnership] = useState<OwnershipFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolutionCode, setResolutionCode] = useState('incident_routed');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/ops/tasks?limit=100', {
        headers: { Authorization: 'Bearer fake:admin-001' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Queue data is unavailable');
      const next = OpsTaskListResponseSchema.parse(await response.json());
      setProjection(next);
      setSelectedId((current) => current ?? next.tasks[0]?.id ?? null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Queue data is unavailable',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (projection?.tasks ?? []).filter((task) => {
      if (queue !== 'ALL' && task.queue !== queue) return false;
      if (ownership === 'mine' && task.ownerUserId !== projection?.actor.userId)
        return false;
      if (ownership === 'unassigned' && task.ownerUserId !== null) return false;
      if (status === 'active' && !['OPEN', 'CLAIMED'].includes(task.status))
        return false;
      if (status !== 'active' && task.status !== status) return false;
      if (
        needle &&
        !`${task.taskType} ${task.subjectType} ${task.subjectId}`
          .toLowerCase()
          .includes(needle)
      )
        return false;
      return true;
    });
  }, [projection, queue, ownership, status, search]);

  const selected =
    filteredTasks.find((task) => task.id === selectedId) ??
    filteredTasks[0] ??
    null;

  async function command(
    task: OpsTask,
    action: 'claim' | 'escalate' | 'resolve',
    body: Record<string, unknown>,
  ) {
    setWorking(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/ops/tasks/${task.id}/${action}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer fake:admin-001',
          'Content-Type': 'application/json',
          'Idempotency-Key': `${action}:${task.id}:${task.version}:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ expectedVersion: task.version, ...body }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(payload.error?.message ?? 'Task update failed');
      }
      const updated = OpsTaskSchema.parse(await response.json());
      setProjection((current) =>
        current
          ? {
              ...current,
              tasks: current.tasks.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Task update failed');
      await refresh();
    } finally {
      setWorking(false);
    }
  }

  const queues = projection?.actor.queues ?? [];
  const activeCount = (projection?.tasks ?? []).filter((task) =>
    ['OPEN', 'CLAIMED'].includes(task.status),
  ).length;

  return (
    <main className="ops-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <HeartPulse size={18} />
          </span>
          <div>
            <strong>Carespaces</strong>
            <span>Care operations</span>
          </div>
        </div>
        <nav aria-label={adminHomeContent.queueTitle}>
          <p className="nav-label">{adminHomeContent.queueTitle}</p>
          <button
            className={queue === 'ALL' ? 'nav-item active' : 'nav-item'}
            onClick={() => setQueue('ALL')}
          >
            <Inbox size={17} />
            <span>All work</span>
            <b>{activeCount}</b>
          </button>
          {queues.map((item) => {
            const count = (projection?.tasks ?? []).filter(
              (task) =>
                task.queue === item &&
                ['OPEN', 'CLAIMED'].includes(task.status),
            ).length;
            return (
              <button
                key={item}
                className={queue === item ? 'nav-item active' : 'nav-item'}
                onClick={() => setQueue(item)}
              >
                <CircleDot size={17} />
                <span>{queueLabels[item]}</span>
                <b>{count}</b>
              </button>
            );
          })}
        </nav>
        <div className="operator">
          <span>AP</span>
          <div>
            <strong>Admin fixture</strong>
            <small>{projection?.actor.roles[0] ?? 'Care Ops'}</small>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p>Operations</p>
            <h1>{adminHomeContent.title}</h1>
          </div>
          <button
            className="icon-button"
            title="Refresh queues"
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
              placeholder="Search task or subject"
            />
          </label>
          <div className="segments" aria-label="Ownership filter">
            {(['all', 'mine', 'unassigned'] as const).map((item) => (
              <button
                key={item}
                className={ownership === item ? 'selected' : ''}
                onClick={() => setOwnership(item)}
              >
                {item === 'all'
                  ? 'All'
                  : item === 'mine'
                    ? 'Mine'
                    : 'Unassigned'}
              </button>
            ))}
          </div>
          <select
            aria-label="Status filter"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            <option value="active">Active</option>
            <option value="OPEN">Open</option>
            <option value="CLAIMED">Claimed</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </div>

        {error ? (
          <div className="error-banner">
            <AlertTriangle size={17} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="work-grid">
          <section className="task-list" aria-label="Ops Tasks">
            <div className="list-heading">
              <span>{filteredTasks.length} tasks</span>
              <span>Priority · due time</span>
            </div>
            {loading && !projection ? <LoadingRows /> : null}
            {!loading && filteredTasks.length === 0 ? (
              <div className="empty-state">
                <CheckCircle2 size={28} />
                <strong>Queue clear</strong>
                <span>No tasks match this view.</span>
              </div>
            ) : null}
            {filteredTasks.map((task) => (
              <button
                key={task.id}
                className={
                  selected?.id === task.id ? 'task-row selected' : 'task-row'
                }
                onClick={() => setSelectedId(task.id)}
              >
                <span
                  className={`priority-dot ${task.priority.toLowerCase()}`}
                />
                <span className="task-copy">
                  <strong>
                    {taskLabels[task.taskType] ?? humanize(task.taskType)}
                  </strong>
                  <small>
                    {queueLabels[task.queue]} · {humanize(task.subjectType)}
                  </small>
                </span>
                <span className="task-meta">
                  <b className={`status ${task.status.toLowerCase()}`}>
                    {task.status}
                  </b>
                  <small className={isOverdue(task) ? 'overdue' : ''}>
                    {dueLabel(task.dueAt)}
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
          </section>

          <aside className="detail-pane" aria-label="Task detail">
            {selected ? (
              <>
                <div className="detail-heading">
                  <span
                    className={`priority-badge ${selected.priority.toLowerCase()}`}
                  >
                    {selected.priority}
                  </span>
                  <span>{queueLabels[selected.queue]}</span>
                </div>
                <h2>
                  {taskLabels[selected.taskType] ?? humanize(selected.taskType)}
                </h2>
                <p className="subject-line">
                  {humanize(selected.subjectType)} ·{' '}
                  {shortId(selected.subjectId)}
                </p>
                <dl>
                  <div>
                    <dt>
                      <Clock3 size={15} />
                      Due
                    </dt>
                    <dd className={isOverdue(selected) ? 'overdue' : ''}>
                      {dateTime(selected.dueAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <UserRoundCheck size={15} />
                      Owner
                    </dt>
                    <dd>
                      {selected.ownerUserId === projection?.actor.userId
                        ? 'You'
                        : selected.ownerUserId
                          ? shortId(selected.ownerUserId)
                          : 'Unassigned'}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <ShieldAlert size={15} />
                      Escalation
                    </dt>
                    <dd>Level {selected.escalationLevel}</dd>
                  </div>
                  <div>
                    <dt>
                      <CircleDot size={15} />
                      Version
                    </dt>
                    <dd>{selected.version}</dd>
                  </div>
                </dl>
                <div className="detail-actions">
                  {selected.status === 'OPEN' ? (
                    <button
                      className="primary-action"
                      disabled={working}
                      onClick={() =>
                        void command(selected, 'claim', {
                          reasonCode: 'queue_claim',
                        })
                      }
                    >
                      <UserRoundCheck size={17} />
                      Claim task
                    </button>
                  ) : null}
                  {selected.status === 'CLAIMED' &&
                  selected.ownerUserId === projection?.actor.userId ? (
                    <>
                      <label className="resolution-field">
                        <span>Resolution</span>
                        <select
                          value={resolutionCode}
                          onChange={(event) =>
                            setResolutionCode(event.target.value)
                          }
                        >
                          {resolutionOptions.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="primary-action"
                        disabled={working}
                        onClick={() =>
                          void command(selected, 'resolve', {
                            reasonCode: 'task_completed',
                            resolutionCode,
                          })
                        }
                      >
                        <Check size={17} />
                        Resolve task
                      </button>
                    </>
                  ) : null}
                  {['OPEN', 'CLAIMED'].includes(selected.status) ? (
                    <button
                      className="secondary-action"
                      disabled={working || selected.priority === 'CRITICAL'}
                      onClick={() =>
                        void command(selected, 'escalate', {
                          reasonCode: 'manual_escalation',
                          priority: 'CRITICAL',
                        })
                      }
                    >
                      <ShieldAlert size={17} />
                      Escalate
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="empty-detail">
                <Inbox size={26} />
                <span>Select a task</span>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
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

function dueLabel(value: string | null) {
  if (!value) return 'No deadline';
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60)
    return minutes < 0 ? `${Math.abs(minutes)}m overdue` : `Due in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 0 ? `${Math.abs(hours)}h overdue` : `Due in ${hours}h`;
}

function dateTime(value: string | null) {
  if (!value) return 'No deadline';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value));
}

function isOverdue(task: OpsTask) {
  return (
    task.dueAt !== null &&
    new Date(task.dueAt).getTime() < Date.now() &&
    ['OPEN', 'CLAIMED'].includes(task.status)
  );
}
