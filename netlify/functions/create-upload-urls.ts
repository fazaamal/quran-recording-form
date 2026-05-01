import type { Handler } from "@netlify/functions";
import { newId, nowIso, presignPut, requireEnv } from "./_shared";

type Req = {
  recordings: { stimulusId: string; contentType: string }[];
  signature: { contentType: string };
};

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
    const body = JSON.parse(event.body || "{}") as Req;
    if (!Array.isArray(body.recordings) || !body.signature?.contentType) {
      return { statusCode: 400, body: "Invalid request" };
    }

    // Optional env var to keep uploads under a prefix
    const prefix = process.env["S3_PREFIX"] ?? "qrf";
    const day = nowIso().slice(0, 10);
    const sessionId = newId("session");
    const root = `${prefix}/${day}/${sessionId}`;

    const signatureKey = `${root}/signature.png`;
    const signaturePutUrl = await presignPut({
      key: signatureKey,
      contentType: body.signature.contentType,
    });

    const recordings: Record<string, { putUrl: string; s3Key: string }> = {};
    for (const r of body.recordings) {
      if (!r.stimulusId || !r.contentType) continue;
      const ext =
        r.contentType.includes("mp4") ? "m4a" : r.contentType.includes("mpeg") ? "mp3" : "webm";
      const key = `${root}/audio/${r.stimulusId}.${ext}`;
      const putUrl = await presignPut({ key, contentType: r.contentType });
      recordings[r.stimulusId] = { putUrl, s3Key: key };
    }

    // Fail fast if required env missing (helps in local dev)
    requireEnv("AWS_REGION");
    requireEnv("S3_BUCKET");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signature: { putUrl: signaturePutUrl, s3Key: signatureKey },
        recordings,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: e instanceof Error ? e.message : "Server error" };
  }
};

