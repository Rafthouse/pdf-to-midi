import type { JobStatus, ScoreDocument, NoteEdit, DocumentSummary } from '../types';

let _base: string | null = null;

async function base(): Promise<string> {
  if (_base) return _base;
  // In Electron the base comes from the main process; fall back for plain web.
  _base = (await window.pdf2midi?.apiBase?.()) ?? 'http://127.0.0.1:8765';
  return _base;
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch((await base()) + path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async health(): Promise<boolean> {
    try {
      await j('/');
      return true;
    } catch {
      return false;
    }
  },

  importByPath(path: string): Promise<JobStatus> {
    return j<JobStatus>('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  },

  getJob(id: string): Promise<JobStatus> {
    return j<JobStatus>(`/jobs/${id}`);
  },

  getDocument(id: string): Promise<ScoreDocument> {
    return j<ScoreDocument>(`/documents/${id}`);
  },

  listDocuments(): Promise<DocumentSummary[]> {
    return j<DocumentSummary[]>(`/documents`);
  },

  editDocument(id: string, edits: NoteEdit[]): Promise<ScoreDocument> {
    return j<ScoreDocument>(`/documents/${id}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edits),
    });
  },

  async musicxmlUrl(id: string, rev = 0): Promise<string> {
    return (await base()) + `/documents/${id}/musicxml.xml?rev=${rev}`;
  },

  async midiUrl(id: string): Promise<string> {
    return (await base()) + `/documents/${id}/midi`;
  },

  async pageUrl(id: string, page: number): Promise<string> {
    return (await base()) + `/documents/${id}/page/${page}`;
  },

  /** Poll a job to completion, returning the finished document. */
  async waitForDocument(jobId: string, onTick?: (s: JobStatus) => void): Promise<ScoreDocument> {
    for (;;) {
      const job = await this.getJob(jobId);
      onTick?.(job);
      if (job.state === 'done' && job.document_id) {
        return this.getDocument(job.document_id);
      }
      if (job.state === 'error') {
        throw new Error(job.error || 'OMR job failed');
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  },
};
