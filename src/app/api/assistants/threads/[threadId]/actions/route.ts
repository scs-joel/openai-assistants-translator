import { NextRequest } from "next/server";

import { openai } from "@/config/openai";
// Send a new message to a thread
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { toolCallOutputs, runId } = await request.json();
  const { threadId } = await params;
  const stream = openai.beta.threads.runs.submitToolOutputsStream(
    threadId,
    runId,
    // { tool_outputs: [{ output: result, tool_call_id: toolCallId }] },
    { tool_outputs: toolCallOutputs },
  );

  return new Response(stream.toReadableStream());
}
