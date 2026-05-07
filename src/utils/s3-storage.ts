import fs from "node:fs/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { PgMemoryConfig } from "../types.js";

/**
 * Uploads local files to S3-compatible storage (like Cloudflare R2).
 */
export async function uploadImagesToS3(
  mediaDir: string,
  filenames: string[],
  s3Config: NonNullable<NonNullable<PgMemoryConfig["media"]>["s3"]>
) {
  const client = new S3Client({
    region: "auto",
    endpoint: s3Config.endpoint,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    },
  });

  const results = await Promise.all(
    filenames.map(async (filename) => {
      const filePath = `${mediaDir}/${filename}`;
      try {
        const body = await fs.readFile(filePath);
        // Determine content type based on extension
        const ext = filename.split(".").pop()?.toLowerCase();
        const contentType = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";

        await client.send(
          new PutObjectCommand({
            Bucket: s3Config.bucket,
            Key: filename,
            Body: body,
            ContentType: contentType,
          })
        );
        return { filename, success: true };
      } catch (err) {
        console.error(`[pg-memo] Failed to upload ${filename} to R2:`, err);
        return { filename, success: false, error: err };
      }
    })
  );

  return results;
}
