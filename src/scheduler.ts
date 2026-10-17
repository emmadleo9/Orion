import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PublishResult, ScheduleCreateInput, ScheduledPost } from './instagram/types.js';

type PublishPayload = ScheduledPost['payload'];
type Publisher = (payload: PublishPayload) => Promise<PublishResult>;

export class Scheduler {
  private jobs: ScheduledPost[];
  private timer?: NodeJS.Timeout;

  constructor(private readonly publish: Publisher, private readonly filePath = path.resolve('.orion-data/schedules.json')) {
    this.jobs = this.read();
    this.start();
  }

  list(): ScheduledPost[] { return [...this.jobs].sort((a, b) => a.publishAt.localeCompare(b.publishAt)); }

  get(id: string): ScheduledPost | undefined { return this.jobs.find((job) => job.id === id); }

  create(input: ScheduleCreateInput): ScheduledPost {
    const date = new Date(input.publishAt);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error('publishAt must be a valid future ISO timestamp');
    const now = new Date().toISOString();
    const job: ScheduledPost = { id: randomUUID(), publishAt: date.toISOString(), createdAt: now, updatedAt: now, status: 'SCHEDULED', payload: input.payload };
    this.jobs.push(job); this.persist(); return job;
  }

  cancel(id: string): ScheduledPost {
    const job = this.get(id);
    if (!job) throw new Error('Scheduled post not found');
    if (job.status === 'PUBLISHED') throw new Error('Published posts cannot be cancelled');
    job.status = 'CANCELLED'; job.updatedAt = new Date().toISOString(); this.persist(); return job;
  }

  close(): void { if (this.timer) clearInterval(this.timer); }

  private start(): void { this.timer = setInterval(() => void this.processDue(), 1_000); this.timer.unref(); void this.processDue(); }

  private async processDue(): Promise<void> {
    const due = this.jobs.filter((job) => job.status === 'SCHEDULED' && new Date(job.publishAt).getTime() <= Date.now());
    for (const job of due) {
      job.status = 'PROCESSING'; job.updatedAt = new Date().toISOString(); this.persist();
      try { job.result = await this.publish(job.payload); job.status = 'PUBLISHED'; }
      catch (error) { job.status = 'FAILED'; job.error = error instanceof Error ? error.message : 'Publishing failed'; }
      job.updatedAt = new Date().toISOString(); this.persist();
    }
  }

  private read(): ScheduledPost[] {
    try { const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.jobs, null, 2));
    fs.renameSync(temp, this.filePath);
  }
}
