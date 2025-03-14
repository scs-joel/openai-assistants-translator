// File: app/api/translate/route.js
import OpenAI from "openai";

export const maxDuration = 60; // Set to the maximum allowed by your Vercel plan

export async function POST(request) {
  try {
    const {
      data,
      sourceLanguage,
      targetLanguage,
      previousResponseId,
      totalRows,
      currentIndex,
    } = await request.json();

    // Initialize the OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Parse the CSV data chunk
    const csvChunk = JSON.parse(data);

    // Build context and instructions for translation
    const prompt = `You are a professional translator. Translate the following CSV data from ${sourceLanguage === "auto" ? "the detected language" : sourceLanguage} to ${targetLanguage}.

                    Only translate the text content, keeping all numbers, dates, and special characters as they are.
                    Maintain the exact same structure and format.
                    Respond ONLY with the translated JSON data, maintaining the exact same keys.

                    Here is the data to translate (rows ${currentIndex + 1} to ${currentIndex + csvChunk.length} out of ${totalRows} total rows):
                    ${JSON.stringify(csvChunk, null, 2)}`;

    // Create the API request
    const response = await openai.responses.create({
      model: "gpt-4o", // You can use a different model as needed
      input: prompt,
      store: true,
      ...(previousResponseId && { previous_response_id: previousResponseId }),
      temperature: 0.7,
    });

    // Parse the response to get the translated data
    let translatedData;
    try {
      // The response should be a JSON string
      const outputText = response.output_text.trim();

      // Extract JSON from the response if it's wrapped in code blocks
      const jsonMatch = outputText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonString = jsonMatch ? jsonMatch[1] : outputText;

      translatedData = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("Failed to parse translation result:", parseError);
      return Response.json(
        {
          error: "Failed to parse translation result",
          message: parseError.message,
        },
        { status: 500 },
      );
    }

    // Return the translated data and the response ID for continuity
    return Response.json({
      translatedData,
      responseId: response.id,
      message: `Successfully translated rows ${currentIndex + 1} to ${currentIndex + translatedData.length}`,
    });
  } catch (error) {
    console.error("Translation API error:", error);
    return Response.json(
      {
        error: "Translation failed",
        message: error.message,
      },
      { status: 500 },
    );
  }
}
