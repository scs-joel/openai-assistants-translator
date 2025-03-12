import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Check if the OpenAI API key is configured
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OpenAI API key is not configured" },
      { status: 500 }
    );
  }

  // Rate limiting logic could be added here
  // For example, checking headers, implementing a token bucket algorithm, etc.

  // Check file size
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File size exceeds 10MB limit" },
      { status: 413 }
    );
  }

  return NextResponse.next();
}

// Configure the middleware to run only for the translation API route
export const config = {
  matcher: "/api/translate",
};
