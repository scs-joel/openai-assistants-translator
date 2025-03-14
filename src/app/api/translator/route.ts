// File: app/api/translate/route.js
//import OpenAI from "openai";

export const maxDuration = 60; // Set to the maximum allowed by your Vercel plan
import { openai } from "@/config/openai";

export async function POST(request) {
  try {
    const {
      data,
      sourceLanguage,
      targetLanguage,
      previousResponseId,
      totalRows,
      currentIndex,
      apikey,
    } = await request.json();

    // Initialize the OpenAI client
    openai.apiKey = apikey;
    // const openai = new OpenAI({
    //   apiKey: openaiApiKey,
    // });

    // Parse the CSV data chunk
    const csvChunk = JSON.parse(data);

    // Build context and instructions for translation
    const prompt = `You are a specialized translator for Japanese game dialog to English. Your task is to:

                    1. Translate the following CSV data into natural, conversational English
                    2. Preserve character voice, emotional tone, and cultural context
                    3. Handle hesitations (...), emphasis, and strong emotions authentically
                    4. Focus on how English speakers would naturally express these ideas
                    5. Remember you are being given a script
                    6. Output only the translations with no explanations.
                    7. Only translate the text content, keeping all numbers, dates, and special characters as they are.
                    8. Maintain the exact same structure and format.
                    9. Respond ONLY with the translated JSON data, maintaining the exact same keys.

                    When translating, consider the character's personality and background when available.

                    Here is the data to translate (rows ${currentIndex + 1} to ${currentIndex + csvChunk.length} out of ${totalRows} total rows):
                    ${JSON.stringify(csvChunk, null, 2)}`;

    // Create the API request
    const response = await openai.responses.create({
      model: "gpt-4o-mini", // You can use a different model as needed
      input: prompt,
      store: true,
      ...(previousResponseId && { previous_response_id: previousResponseId }),
      temperature: 0.7,
    });

    const secondResponse = await openai.responses.create({
      model: "gpt-4o-mini",
      previous_response_id: response.id,
      input: [
        {
          role: "user",
          content: `Make the English translation sound natural while keeping the overall context in mind.
                    1. Only translate the text content, keeping all numbers, dates, and special characters as they are.
                    2. Maintain the exact same structure and format.
                    3. Respond ONLY with the translated JSON data, maintaining the exact same keys.
                    `,
        },
      ],
      store: true,
      temperature: 0.7,
    });
    console.log("received translation");

    // Parse the response to get the translated data
    let translatedData;
    try {
      // The response should be a JSON string
      const outputText = secondResponse.output_text.trim();

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
