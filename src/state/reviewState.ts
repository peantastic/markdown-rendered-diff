import type * as vscode from 'vscode';
import { hash } from '../baseline/baseline';
import type { Baseline } from '../baseline/baseline';

export interface Prefs { mode: 'unified' | 'split'; collapse: boolean }

/** Trạng thái review lưu theo workspace: file đã xem (gắn với nội dung), thay đổi đã xem, mốc so sánh. */
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
  setSeen(root: string, rel: string, id: string, v: boolean) {
    const s = new Set(this.seen(root, rel));
    if (v) s.add(id); else s.delete(id);
    // giữ tối đa 2000 id mỗi file
    void this.ws.update('seen:' + this.k(root, rel), [...s].slice(-2000));
  }

  baseline(def: Baseline): Baseline {
    return this.ws.get<Baseline>('baseline') ?? def;
  }
  setBaseline(b: Baseline) { void this.ws.update('baseline', b); }

  prefs(): Prefs {
    const saved = this.global.get<Partial<Prefs>>('prefs') ?? {};
    return { mode: saved.mode ?? 'unified', collapse: saved.collapse ?? true };
  }
  setPrefs(p: Partial<Prefs>) { void this.global.update('prefs', { ...this.prefs(), ...p }); }
}
