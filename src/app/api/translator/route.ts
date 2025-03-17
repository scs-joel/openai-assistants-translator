// File: app/api/translate/route.js
//import OpenAI from "openai";

export const maxDuration = 300; // Set to the maximum allowed by your Vercel plan
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
      initialPrompt,
      refinementPrompt,
      model,
      temperature,
    } = await request.json();

    // Initialize the OpenAI client
    openai.apiKey = apikey;
    // const openai = new OpenAI({
    //   apiKey: openaiApiKey,
    // });

    // Parse the CSV data chunk
    const csvChunk = JSON.parse(data);

    // Build context and instructions for translation
    const prompt = `
                    You are a specialized translator for Japanese game dialog to English.

                    ${initialPrompt}

                    Keep the following in mind while completing your task.
                    1. Preserve character voice, emotional tone, and cultural context
                    2. Handle hesitations (...), emphasis, and strong emotions authentically
                    3. Focus on how English speakers would naturally express these ideas
                    4. Remember you are being given a script
                    5. Output only the translations with no explanations.
                    6. Maintain the exact same structure and format.
                    7. Respond ONLY with the translated JSON data, maintaining the exact same keys.

                    Here is the data to translate (rows ${currentIndex + 1} to ${currentIndex + csvChunk.length} out of ${totalRows} total rows):
                    ${JSON.stringify(csvChunk, null, 2)}`;

    // Create the API request
    const response = await openai.responses.create({
      model: model || "gpt-4o", // Use provided model or fallback to gpt-4
      input: prompt,
      store: true,
      ...(previousResponseId && { previous_response_id: previousResponseId }),
      temperature: temperature ?? 1, // Use provided temperature or fallback to 1
    });

    const secondResponse = await openai.responses.create({
      model: model || "gpt-4o", // Use provided model or fallback to gpt-4
      previous_response_id: response.id,
      input: [
        {
          role: "user",
          content: `${refinementPrompt}
              1. Only translate the text content, keeping all numbers, dates, and special characters as they are.
              2. Maintain the exact same structure and format.
              3. Respond ONLY with the translated JSON data, maintaining the exact same keys.
          `,
        },
      ],
      store: true,
      temperature: temperature ?? 1, // Use provided temperature or fallback to 1
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
