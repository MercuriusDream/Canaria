import type { EventRecord } from "@canaria/types";

export class BackupService {
  constructor(private readonly bucket?: R2Bucket) {}

  public async saveProjection(events: EventRecord[]): Promise<void> {
    if (!this.bucket) {
      console.warn("No backup bucket configured, skipping backup");
      return;
    }

    try {
      const projection = JSON.stringify({
        lastUpdated: new Date().toISOString(),
        events: events.slice(0, 1000), // Keep the backup reasonable in size
      });

      // Events are typically accessed via /events.json in the backup bucket
      await this.bucket.put("events.json", projection, {
        httpMetadata: {
          contentType: "application/json",
          cacheControl: "public, max-age=60", // Cache for 1 min on CDN
        },
      });
    } catch (error) {
      console.error("Failed to save backup projection", error);
    }
  }
}
