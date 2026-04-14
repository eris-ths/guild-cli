import YAML from 'yaml';
import { join } from 'node:path';
import { Request, StatusLogEntry } from '../../domain/request/Request.js';
import { RequestId } from '../../domain/request/RequestId.js';
import {
  RequestState,
  REQUEST_STATES,
  parseRequestState,
} from '../../domain/request/RequestState.js';
import { Review } from '../../domain/request/Review.js';
import { MemberName } from '../../domain/member/MemberName.js';
import { RequestRepository } from '../../application/ports/RequestRepository.js';
import {
  existsSafe,
  listDirSafe,
  readTextSafe,
  writeTextSafe,
  moveSafe,
} from './safeFs.js';
import { GuildConfig } from '../config/GuildConfig.js';

/**
 * Layout: <paths.requests>/<state>/<id>.yaml
 * Save writes to the request's current state dir; if the state has changed
 * since the file was loaded the old file is moved to the new dir.
 */
export class YamlRequestRepository implements RequestRepository {
  constructor(private readonly config: GuildConfig) {}

  async findById(id: RequestId): Promise<Request | null> {
    for (const state of REQUEST_STATES) {
      const rel = join(state, `${id.value}.yaml`);
      if (existsSafe(this.config.paths.requests, rel)) {
        const raw = readTextSafe(this.config.paths.requests, rel);
        return hydrate(YAML.parse(raw), state);
      }
    }
    return null;
  }

  async listByState(state: RequestState): Promise<Request[]> {
    const files = listDirSafe(this.config.paths.requests, state)
      .filter((f) => /^\d{4}-\d{2}-\d{2}-\d{3}\.yaml$/.test(f))
      .slice(0, 1000);
    const out: Request[] = [];
    for (const f of files) {
      const raw = readTextSafe(this.config.paths.requests, join(state, f));
      const r = hydrate(YAML.parse(raw), state);
      if (r) out.push(r);
    }
    return out;
  }

  async save(request: Request): Promise<void> {
    const currentState = request.state;
    const currentRel = join(currentState, `${request.id.value}.yaml`);
    // Locate any existing file under another state dir
    for (const state of REQUEST_STATES) {
      if (state === currentState) continue;
      const rel = join(state, `${request.id.value}.yaml`);
      if (existsSafe(this.config.paths.requests, rel)) {
        moveSafe(this.config.paths.requests, rel, currentRel);
        break;
      }
    }
    const text = YAML.stringify(request.toJSON());
    writeTextSafe(this.config.paths.requests, currentRel, text);
  }

  async nextSequence(dateKey: string): Promise<number> {
    let max = 0;
    for (const state of REQUEST_STATES) {
      const files = listDirSafe(this.config.paths.requests, state);
      for (const f of files) {
        const m = f.match(/^(\d{4}-\d{2}-\d{2})-(\d{3})\.yaml$/);
        if (m && m[1] === dateKey) {
          const n = parseInt(m[2] as string, 10);
          if (n > max) max = n;
        }
      }
    }
    return max + 1;
  }
}

function hydrate(data: unknown, stateHint?: RequestState): Request | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const obj = data as Record<string, unknown>;
  try {
    const id = RequestId.of(obj['id']);
    const state =
      typeof obj['state'] === 'string'
        ? parseRequestState(obj['state'])
        : stateHint !== undefined
          ? stateHint
          : parseRequestState('pending');
    const reviewsRaw = Array.isArray(obj['reviews'])
      ? (obj['reviews'] as unknown[])
      : [];
    const reviews: Review[] = [];
    for (const r of reviewsRaw) {
      if (r && typeof r === 'object') {
        const ro = r as Record<string, unknown>;
        const rc: Parameters<typeof Review.create>[0] = {
          by: String(ro['by']),
          lense: String(ro['lense']),
          verdict: String(ro['verdict']),
          comment: String(ro['comment'] ?? ''),
        };
        if (typeof ro['at'] === 'string') rc.at = ro['at'] as string;
        reviews.push(Review.create(rc));
      }
    }
    const statusLogRaw = Array.isArray(obj['status_log'])
      ? (obj['status_log'] as unknown[])
      : [];
    const statusLog: StatusLogEntry[] = [];
    for (const s of statusLogRaw) {
      if (!s || typeof s !== 'object') continue;
      const so = s as Record<string, unknown>;
      // Legacy entries may omit `state` (e.g., review notes). Skip them
      // rather than failing the whole request.
      if (typeof so['state'] !== 'string') continue;
      try {
        const entry: StatusLogEntry = {
          state: parseRequestState(so['state']),
          by: String(so['by'] ?? 'unknown'),
          at: String(so['at'] ?? new Date().toISOString()),
        };
        if (typeof so['note'] === 'string') entry.note = so['note'] as string;
        statusLog.push(entry);
      } catch {
        // drop malformed entries silently
      }
    }
    const createdAt =
      typeof obj['created_at'] === 'string'
        ? (obj['created_at'] as string)
        : typeof obj['created'] === 'string'
          ? (obj['created'] as string)
          : new Date().toISOString();
    const action = String(obj['action'] ?? '(no action)').trim() || '(no action)';
    const reason = String(obj['reason'] ?? '(no reason)').trim() || '(no reason)';
    const props: Parameters<typeof Request.restore>[0] = {
      id,
      from: MemberName.of(obj['from']),
      action,
      reason,
      state,
      createdAt,
      reviews,
      statusLog,
    };
    const executorRaw =
      typeof obj['executor'] === 'string'
        ? (obj['executor'] as string)
        : typeof obj['executor_actual'] === 'string'
          ? (obj['executor_actual'] as string)
          : typeof obj['executor_preferred'] === 'string'
            ? (obj['executor_preferred'] as string)
            : undefined;
    if (executorRaw !== undefined)
      props.executor = MemberName.of(executorRaw);
    if (typeof obj['auto_review'] === 'string')
      props.autoReview = MemberName.of(obj['auto_review']);
    if (typeof obj['target'] === 'string') props.target = obj['target'] as string;
    if (typeof obj['completion_note'] === 'string')
      props.completionNote = obj['completion_note'] as string;
    if (typeof obj['deny_reason'] === 'string')
      props.denyReason = obj['deny_reason'] as string;
    if (typeof obj['failure_reason'] === 'string')
      props.failureReason = obj['failure_reason'] as string;
    return Request.restore(props);
  } catch {
    return null;
  }
}
