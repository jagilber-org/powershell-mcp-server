import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Lightweight Phase A learning support for UNKNOWN commands.
// SECURITY: This module NEVER persists raw commands; it stores only redacted + hashed forms.

export interface LearningConfig {
  enabled: boolean;
  journalFile: string; // NDJSON (append-only)
  maxJournalKB: number; // Rotate if exceeded
}

const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  enabled: true,
  journalFile: 'learnCandidates.jsonl',
  maxJournalKB: 512
};

export function resolveLearningConfig(partial?: Partial<LearningConfig>): LearningConfig {
  return { ...DEFAULT_LEARNING_CONFIG, ...(partial || {}) };
}

// Basic redaction patterns (Phase A) – later replaced by dedicated obfuscation MCP integration
const REDACTION_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: /[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}/gi, replacement: 'OBF_GUID' },
  { re: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g, replacement: 'OBF_IP' },
  { re: /[A-Z]:\\[^\s"']+/gi, replacement: 'OBF_PATH' },
  { re: /\b[0-9a-f]{32}\b/gi, replacement: 'OBF_HASH32' },
  { re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, replacement: 'OBF_EMAIL' }
];

export function redactCommand(raw: string): string {
  let out = raw;
  for (const { re, replacement } of REDACTION_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export function normalizeRedacted(cmd: string): string {
  return cmd.trim().toLowerCase().replace(/\s+/g, ' ');
}

function structuralHash(raw: string): string {
  const secret = process.env.UNKNOWN_LEARN_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret).update(raw).digest('hex').slice(0, 32);
}

interface JournalEntry {
  ts: string;
  hash: string;   // HMAC of raw (irreversible without secret)
  redacted: string;
  normalized: string;
  sessionId: string;
}

export function recordUnknownCandidate(raw: string, sessionId: string, cfg: LearningConfig): string | undefined {
  if (!cfg.enabled) return undefined;
  try {
    const redacted = redactCommand(raw);
    const normalized = normalizeRedacted(redacted);
    const entry: JournalEntry = {
      ts: new Date().toISOString(),
      hash: structuralHash(raw),
      redacted,
      normalized,
      sessionId
    };
    const filePath = path.resolve(process.cwd(), cfg.journalFile);
    // Basic rotation by size
    try {
      if (fs.existsSync(filePath)) {
        const kb = fs.statSync(filePath).size / 1024;
        if (kb > cfg.maxJournalKB) {
          fs.renameSync(filePath, filePath + '.' + Date.now() + '.bak');
        }
      }
    } catch {}
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
    return normalized;
  } catch (e) {
    // Silent failure – do not impede main execution path
    return undefined;
  }
}

export interface AggregatedCandidate {
  normalized: string;
  redactedSample: string;
  count: number;
  firstTs: string;
  lastTs: string;
  distinctSessions: number;
}

export function aggregateCandidates(limit = 20, cfg?: LearningConfig): AggregatedCandidate[] {
  const filePath = path.resolve(process.cwd(), (cfg || DEFAULT_LEARNING_CONFIG).journalFile);
  if (!fs.existsSync(filePath)) return [];
  const map: Map<string, { c: number; sample: string; first: string; last: string; sessions: Set<string> }> = new Map();
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const j = JSON.parse(line) as JournalEntry;
      const entry = map.get(j.normalized);
      if (entry) {
        entry.c++;
        entry.last = j.ts;
        entry.sessions.add(j.sessionId);
      } else {
        map.set(j.normalized, { c: 1, sample: j.redacted, first: j.ts, last: j.ts, sessions: new Set([j.sessionId]) });
      }
    } catch {}
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].c - a[1].c)
    .slice(0, limit)
    .map(([normalized, v]) => ({
      normalized,
      redactedSample: v.sample,
      count: v.c,
      firstTs: v.first,
      lastTs: v.last,
      distinctSessions: v.sessions.size
    }));
}

// ---------------- Phase B: Intelligent Recommendations & Promotion ----------------

export interface Recommendation extends AggregatedCandidate {
  score: number;           // composite score 0-100
  rationale: string;       // human-readable explanation
}

/** Compute recommendations from aggregated candidates.
 * Scoring factors (weights sum to 1):
 *  - Frequency (count) 0.4
 *  - Distinct sessions 0.25
 *  - Density (count / spanSeconds) 0.2
 *  - Recency (1/(1+hoursSinceLast)) 0.15
 */
export function recommendCandidates(options?: { limit?: number; minCount?: number }, cfg?: LearningConfig): Recommendation[] {
  const limit = options?.limit ?? 20;
  const minCount = options?.minCount ?? 1;
  const now = Date.now();
  const aggs = aggregateCandidates(500, cfg).filter(c => c.count >= minCount);
  if (!aggs.length) return [];
  // Precompute maxima for normalization
  const maxCount = Math.max(...aggs.map(a => a.count));
  const maxSessions = Math.max(...aggs.map(a => a.distinctSessions || 1));
  // density: count / (spanSeconds + 1)
  const densities = aggs.map(a => {
    const spanMs = new Date(a.lastTs).getTime() - new Date(a.firstTs).getTime();
    return a.count / ((spanMs/1000) + 1);
  });
  const maxDensity = Math.max(...densities, 1);
  const recencies = aggs.map(a => 1 / (1 + ((now - new Date(a.lastTs).getTime()) / 3600000))); // 0..1
  const recencyMax = Math.max(...recencies, 1);
  const recMap = new Map<string, number>();
  aggs.forEach((a,i)=> recMap.set(a.normalized, recencies[i]));
  const densMap = new Map<string, number>();
  aggs.forEach((a,i)=> densMap.set(a.normalized, densities[i]));
  const recs: Recommendation[] = aggs.map(a => {
    const freqNorm = a.count / maxCount; // 0..1
    const sessNorm = (a.distinctSessions || 1) / maxSessions;
    const densNorm = (densMap.get(a.normalized) || 0) / maxDensity;
    const recNorm = (recMap.get(a.normalized) || 0) / recencyMax;
    const scoreRaw = 0.4*freqNorm + 0.25*sessNorm + 0.2*densNorm + 0.15*recNorm;
    const score = Math.round(scoreRaw * 10000) / 100; // two decimals 0-100
    const rationale = `count=${a.count} sessions=${a.distinctSessions} density=${(densMap.get(a.normalized)||0).toFixed(3)} recencyBoost=${(recMap.get(a.normalized)||0).toFixed(3)}`;
    return { ...a, score, rationale };
  }).sort((a,b)=> b.score - a.score).slice(0, limit);
  return recs;
}

// Promotion store
interface LearnedSafeEntry { normalized: string; added: string; source: string; pattern: string; }
interface LearnedSafeFile { version: number; approved: LearnedSafeEntry[]; }
const LEARNED_FILE = 'learned-safe.json';

// Queue (pending review) before promotion
interface LearnQueueEntry { normalized: string; added: string; source: string; timesQueued: number; lastQueued: string; }
interface LearnQueueFile { version: number; queued: LearnQueueEntry[]; }
const LEARN_QUEUE_FILE = 'learn-queue.json';

function loadLearnedFile(): LearnedSafeFile {
  const p = path.resolve(process.cwd(), LEARNED_FILE);
  if (!fs.existsSync(p)) return { version:1, approved: [] };
  try { return JSON.parse(fs.readFileSync(p,'utf8')) as LearnedSafeFile; } catch { return { version:1, approved: [] }; }
}

function saveLearnedFile(data: LearnedSafeFile) {
  try { fs.writeFileSync(path.resolve(process.cwd(), LEARNED_FILE), JSON.stringify(data,null,2)); } catch {}
}

function loadQueueFile(): LearnQueueFile {
  const p = path.resolve(process.cwd(), LEARN_QUEUE_FILE);
  if (!fs.existsSync(p)) return { version:1, queued: [] };
  try { return JSON.parse(fs.readFileSync(p,'utf8')) as LearnQueueFile; } catch { return { version:1, queued: [] }; }
}

function saveQueueFile(data: LearnQueueFile) {
  try { fs.writeFileSync(path.resolve(process.cwd(), LEARN_QUEUE_FILE), JSON.stringify(data,null,2)); } catch {}
}

export function queueCandidates(candidates: string[], source='dashboard'): { added: number; skipped: number; total: number } {
  const data = loadQueueFile();
  const map = new Map(data.queued.map(q=>[q.normalized,q] as const));
  let added=0; let skipped=0;
  for (const norm of candidates) {
    if (!norm) { skipped++; continue; }
    const existing = map.get(norm);
    if (existing) {
      existing.timesQueued += 1;
      existing.lastQueued = new Date().toISOString();
      skipped++;
    } else {
      const entry: LearnQueueEntry = { normalized: norm, added: new Date().toISOString(), source, timesQueued:1, lastQueued: new Date().toISOString() };
      data.queued.push(entry);
      map.set(norm, entry);
      added++;
    }
  }
  if (added || skipped) saveQueueFile(data);
  return { added, skipped, total: data.queued.length };
}

export function listQueuedCandidates(): LearnQueueEntry[] { return loadQueueFile().queued; }

export function removeFromQueue(norms: string[]): { removed: number; remaining: number } {
  const data = loadQueueFile();
  const before = data.queued.length;
  const set = new Set(norms);
  data.queued = data.queued.filter(q=> !set.has(q.normalized));
  const removed = before - data.queued.length;
  if (removed) saveQueueFile(data);
  return { removed, remaining: data.queued.length };
}

export function approveQueuedCandidates(norms: string[], source='queue-approve'): { promoted: number; skipped: number; queueRemoved: number; patterns: string[] } {
  // Promote only those currently in queue
  const queued = listQueuedCandidates();
  const qSet = new Set(queued.map(q=>q.normalized));
  const toPromote = norms.filter(n=> qSet.has(n));
  const stats = promoteCandidates(toPromote, source);
  const rem = removeFromQueue(toPromote);
  return { promoted: stats.added, skipped: stats.skipped, queueRemoved: rem.removed, patterns: stats.patterns };
}

function escapeRegExp(str: string): string { return str.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

/** Promote normalized candidates to learned safe list. Returns stats & added regex patterns. */
export function promoteCandidates(candidates: string[], source = 'manual'): { added: number; skipped: number; total: number; patterns: string[] } {
  const data = loadLearnedFile();
  const existing = new Set(data.approved.map(a=>a.normalized));
  let added = 0; const patterns: string[] = [];
  for (const norm of candidates) {
    if (!norm || existing.has(norm)) continue;
    // Build anchored case-insensitive regex pattern for exact normalized form (space flexible)
    const pattern = '^' + escapeRegExp(norm).replace(/\s+/g,'\\s+') + '$';
    data.approved.push({ normalized: norm, added: new Date().toISOString(), source, pattern });
    patterns.push(pattern);
    existing.add(norm);
    added++;
  }
  if (added) saveLearnedFile(data);
  return { added, skipped: candidates.length - added, total: data.approved.length, patterns };
}

export function loadLearnedPatterns(): string[] {
  const data = loadLearnedFile();
  return data.approved.map(a=>a.pattern);
}

