import { NextRequest, NextResponse } from 'next/server';

import { translateGameDialog } from '@/translation/services/translator';

export async function POST(request: NextRequest) {
  try {
    // Check if the request is a multipart form
    if (!request.headers.get('content-type')?.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Request must be multipart/form-data' },
        { status: 400 },
      );
    }

    // Parse the form data
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Check if the file is a CSV
    if (!file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json(
        { error: 'File must be a CSV' },
        { status: 400 },
      );
    }

    // Read the file content
    const fileContent = await file.text();

    // Optional: get a custom assistant ID from the request
    const assistantId = (formData.get('assistantId') as string) || null;

    // Process the translation
    const result = await translateGameDialog(
      fileContent,
      file.name,
      assistantId,
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing translation:', error);
    return NextResponse.json(
      { error: error.message || 'An error occurred during translation' },
      { status: 500 },
    );
  }
}
