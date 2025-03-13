import { NextRequest } from "next/server";

import { assistantId } from "@/config/assistant-config";
import { openai } from "@/config/openai";

export const runtime = "nodejs";

// Send a new message to a thread
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { content } = await request.json();
  const { threadId } = await params;

  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: content,
  });

  const stream = openai.beta.threads.runs.stream(threadId, {
    assistant_id: assistantId,
  });

  return new Response(stream.toReadableStream());
}
