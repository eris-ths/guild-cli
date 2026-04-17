import { Request } from '../../domain/request/Request.js';
import { Issue } from '../../domain/issue/Issue.js';
import { extractReferences } from '../../domain/shared/extractReferences.js';
import { RequestRepository } from '../ports/RequestRepository.js';
import { IssueRepository } from '../ports/IssueRepository.js';

/**
 * Read-model: "what concerns do I have on the record that nobody has
 * written a follow-up about?"
 *
 * Answers the gap observed in `gate resume`'s open-loops view:
 * state-machine open_loops don't surface `concern` / `reject` verdicts
 * left on completed requests. Those are also commitments, just softer.
 *
 * Naive definition (deliberately coarse):
 *   A concern is "unresponded" when NO later request/issue authored by
 *   the request's authorship set ({R.from} ∪ R.with) mentions R.id in
 *   its prose. If any follow-up exists, the whole request is dropped —
 *   the tool does NOT pretend to detect partial-close (2 concerns
 *   addressed by 1 follow-up that only covered one of them). That
 *   judgment is returned to the reader; if they want to verify
 *   coverage, `gate chain <id>` walks the actual references.
 *
 * Age cutoff avoids stale concerns from years ago creeping into every
 * resume forever. 30 days is a deliberate middle — long enough that a
 * genuine concern survives a weekend + a week of holidays, short
 * enough that un-acted-on criticism doesn't become resume noise.
 */

export interface UnrespondedConcernInfo {
  readonly by: string;
  readonly lense: string;
  readonly at: string;
  readonly age_days: number;
  readonly verdict: 'concern' | 'reject';
}

export interface UnrespondedConcernsEntry {
  readonly request_id: string;
  readonly action: string;
  readonly concerns: ReadonlyArray<UnrespondedConcernInfo>;
}

export interface UnrespondedConcernsInput {
  readonly actor: string;
  readonly now: Date;
  readonly maxAgeDays?: number;
}

export const DEFAULT_MAX_AGE_DAYS = 30;

export class UnrespondedConcernsQuery {
  constructor(
    private readonly requests: RequestRepository,
    private readonly issues: IssueRepository,
  ) {}

  async run(
    input: UnrespondedConcernsInput,
  ): Promise<UnrespondedConcernsEntry[]> {
    const actorLower = input.actor.toLowerCase();
    const maxAge = input.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
    const nowMs = input.now.getTime();
    const allRequests = await this.requests.listAll();
    const allIssues = await this.issues.listAll();

    return computeUnrespondedConcerns(
      allRequests,
      allIssues,
      actorLower,
      nowMs,
      maxAge,
    );
  }
}

/**
 * Pure core of the query — extracted so it can be unit-tested against
 * in-memory Request/Issue arrays without a repository. All behavior
 * (authorship set, age cutoff, follow-up detection) lives here.
 */
export function computeUnrespondedConcerns(
  allRequests: ReadonlyArray<Request>,
  allIssues: ReadonlyArray<Issue>,
  actorLower: string,
  nowMs: number,
  maxAgeDays: number,
): UnrespondedConcernsEntry[] {
  const entries: UnrespondedConcernsEntry[] = [];

  for (const r of allRequests) {
    const authorshipSet = authorshipSetOf(r);
    if (!authorshipSet.has(actorLower)) continue;

    const concerns: UnrespondedConcernInfo[] = [];
    for (const rv of r.reviews) {
      if (rv.verdict !== 'concern' && rv.verdict !== 'reject') continue;
      const ageDays = computeAgeDays(rv.at, nowMs);
      if (ageDays === null) continue;
      if (ageDays > maxAgeDays) continue;
      concerns.push({
        by: rv.by.value,
        lense: rv.lense,
        at: rv.at,
        age_days: ageDays,
        verdict: rv.verdict as 'concern' | 'reject',
      });
    }
    if (concerns.length === 0) continue;

    if (hasFollowUp(r.id.value, authorshipSet, allRequests, allIssues)) {
      continue;
    }

    entries.push({
      request_id: r.id.value,
      action: r.action,
      concerns,
    });
  }

  // Most-recent concern first so the agent sees the freshest unaddressed
  // criticism at the top of resume output.
  entries.sort((a, b) => latestAt(b) - latestAt(a));
  return entries;
}

function authorshipSetOf(r: Request): Set<string> {
  const set = new Set<string>();
  set.add(r.from.value);
  for (const partner of r.with) {
    set.add(partner.value);
  }
  return set;
}

function computeAgeDays(at: string, nowMs: number): number | null {
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return null;
  const delta = nowMs - parsed;
  if (delta < 0) return 0;
  return Math.floor(delta / 86_400_000);
}

function latestAt(entry: UnrespondedConcernsEntry): number {
  let max = 0;
  for (const c of entry.concerns) {
    const t = Date.parse(c.at);
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

/**
 * Return true if any request or issue other than `targetId`, authored
 * by someone in `authorshipSet`, mentions `targetId` in its free text.
 * This is the "follow-up exists" check. Does NOT try to detect whether
 * the follow-up actually addresses the concerns — that is the reader's
 * judgment, documented as a deliberate limitation.
 */
function hasFollowUp(
  targetId: string,
  authorshipSet: ReadonlySet<string>,
  allRequests: ReadonlyArray<Request>,
  allIssues: ReadonlyArray<Issue>,
): boolean {
  for (const r of allRequests) {
    if (r.id.value === targetId) continue;
    if (!authorshipSet.has(r.from.value)) continue;
    if (proseMentionsId(gatherRequestProse(r), targetId)) return true;
  }
  for (const i of allIssues) {
    if (!authorshipSet.has(i.from.value)) continue;
    if (proseMentionsId(i.text, targetId)) return true;
  }
  return false;
}

function gatherRequestProse(r: Request): string {
  const parts: string[] = [r.action, r.reason];
  for (const entry of r.statusLog) {
    if (entry.note) parts.push(entry.note);
  }
  for (const rv of r.reviews) {
    parts.push(rv.comment);
  }
  return parts.join('\n');
}

function proseMentionsId(prose: string, id: string): boolean {
  return extractReferences(prose).requestIds.includes(id);
}
