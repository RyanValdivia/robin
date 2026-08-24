import { NextResponse } from "next/server";
import { sttAvailable } from "@brain/stt.ts";
import { ttsAvailable } from "@brain/tts.ts";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ stt: sttAvailable(), tts: ttsAvailable() });
}
