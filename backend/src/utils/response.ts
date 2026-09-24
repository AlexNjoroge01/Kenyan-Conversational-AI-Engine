import type { Response } from "express";

export function sendJson<T>(res: Response, body: T, status = 200): void {
  res.status(status).json(body);
}

export function sendAudio(res: Response, audio: Buffer, contentType: string, filename: string): void {
  res
    .status(200)
    .set({
      "Content-Type": contentType,
      "Content-Length": String(audio.length),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    })
    .send(audio);
}
