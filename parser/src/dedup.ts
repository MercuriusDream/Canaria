export class RecentEventCache {
  private readonly seen: string[] = [];

  constructor(private readonly maxSize: number) {}

  record(eventId: string): boolean {
    if (!eventId) return false;

    const existingIndex = this.seen.indexOf(eventId);
    if (existingIndex >= 0) {
      // Move to most recent
      this.seen.splice(existingIndex, 1);
      this.seen.push(eventId);
      return false;
    }

    this.seen.push(eventId);
    if (this.seen.length > this.maxSize) {
      this.seen.shift();
    }
    return true;
  }
}
