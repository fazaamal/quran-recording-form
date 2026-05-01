type CreateUploadUrlsReq = {
  recordings: { stimulusId: string; contentType: string }[];
  signature: { contentType: string };
};

type CreateUploadUrlsRes = {
  signature: { putUrl: string; s3Key: string };
  recordings: Record<string, { putUrl: string; s3Key: string }>;
};

type SubmitResponseReq = {
  participant: {
    tajweedLevel: string;
    yearsReading: number;
    age: number;
    ethnicity: string;
    hadTajweedClasses: boolean;
  };
  signature: { s3Key: string };
  recordings: {
    stimulusId: string;
    stimulusTextAr: string;
    kind: "letter" | "word";
    letter: "dad" | "ayn";
    harakah: "fatha" | "kasra" | "damma" | "sukoon";
    s3Key: string;
    contentType: string;
    durationMs: number;
  }[];
};

type SubmitResponseRes = { responseId: string };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function apiCreateUploadUrls(body: CreateUploadUrlsReq): Promise<CreateUploadUrlsRes> {
  const res = await fetch("/api/create-upload-urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<CreateUploadUrlsRes>(res);
}

export async function apiSubmitResponse(body: SubmitResponseReq): Promise<SubmitResponseRes> {
  const res = await fetch("/api/submit-response", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<SubmitResponseRes>(res);
}

export async function apiAdminList(headers: Record<string, string>) {
  const res = await fetch("/api/admin-list", { headers });
  return json<{ responses: any[] }>(res);
}

export async function apiAdminResponse(headers: Record<string, string>, id: string) {
  const res = await fetch(`/api/admin-response?id=${encodeURIComponent(id)}`, { headers });
  return json<{ response: any; recordings: any[] }>(res);
}

export async function apiAdminExportCsv(headers: Record<string, string>) {
  const res = await fetch("/api/admin-export-csv", { headers });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  return await res.blob();
}

