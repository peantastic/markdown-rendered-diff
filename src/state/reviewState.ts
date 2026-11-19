import type * as vscode from 'vscode';
import { hash, validBaseline } from '../baseline/baseline';
import type { Baseline } from '../baseline/baseline';

export interface Prefs { mode: 'unified' | 'split'; collapse: boolean }

/** Per-workspace review state: viewed files (tied to content), seen changes, baseline. */
export class ReviewState {
  constructor(private ws: vscode.Memento, private global: vscode.Memento) {}

  private k(root: string, rel: string) { return `${root}|${rel}`; }

  isViewed(root: string, rel: string, content: string): boolean {
    return this.ws.get<string>('viewed:' + this.k(root, rel)) === hash(content);
  }
  setViewed(root: string, rel: string, content: string, v: boolean) {
    void this.ws.update('viewed:' + this.k(root, rel), v ? hash(content) : undefined);
  }

  seen(root: string, rel: string): string[] {
    return this.ws.get<string[]>('seen:' + this.k(root, rel)) ?? [];
  }
  setSeen(root: string, rel: string, id: unknown, v: unknown) {
    if (typeof id !== 'string' || !/^[\w-]{1,40}$/.test(id)) return;
    const s = new Set(this.seen(root, rel));
    if (v === true) s.add(id); else s.delete(id);
    // keep at most 2000 ids per file
    void this.ws.update('seen:' + this.k(root, rel), [...s].slice(-2000));
  }

  baseline(def: Baseline): Baseline {
    const b = this.ws.get<unknown>('baseline');
    return validBaseline(b) ? b : def;
  }
  setBaseline(b: Baseline) { void this.ws.update('baseline', b); }

  prefs(): Prefs {
    const saved = this.global.get<Partial<Prefs>>('prefs') ?? {};
    return { mode: saved.mode === 'split' ? 'split' : 'unified', collapse: saved.collapse !== false };
  }
  /** Values come from the webview: keep only known keys with valid values. */
  setPrefs(p: unknown) {
    const x = (p ?? {}) as Partial<Prefs>;
    const next = { ...this.prefs() };
    if (x.mode === 'unified' || x.mode === 'split') next.mode = x.mode;
    if (typeof x.collapse === 'boolean') next.collapse = x.collapse;
    void this.global.update('prefs', next);
  }
}
