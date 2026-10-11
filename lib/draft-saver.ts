// In-memory only: never persists sensitive drafts in browser storage.
export class DraftSaver {
  id?: string;
  revision?: number;
  private latest?: object;
  private saved?: object;
  private queue: Promise<void> = Promise.resolve();
  get unsaved() { return this.latest !== this.saved; }
  constructor(private send: (input: Record<string, unknown>) => Promise<{id?: string; revision?: number}>, private status: (value: string) => void, id?: string, revision?: number) { this.id=id; this.revision=revision; }
  change(snapshot: object) { this.latest = snapshot; this.status("Ungespeicherte Änderung …"); }
  save(snapshot: object) {
    const next = this.queue.catch(() => {}).then(async () => {
      if (this.saved === snapshot) return;
      if (this.latest === snapshot) this.status("Wird gespeichert …");
      try {
        const result = await this.send({ ...snapshot, action: "save", id: this.id, revision: this.revision });
        if (!result.id || !Number.isInteger(result.revision)) throw new Error("Serverbestätigung unvollständig.");
        this.id = result.id; this.revision = result.revision; this.saved = snapshot;
        if (this.latest === snapshot) this.status("Gespeichert");
      } catch (error) {
        if (this.latest === snapshot) this.status(`Nicht gespeichert — erneut versuchen. ${error instanceof Error ? error.message : "Verbindung prüfen."}`);
        throw error;
      }
    });
    this.queue = next;
    return next;
  }
}
