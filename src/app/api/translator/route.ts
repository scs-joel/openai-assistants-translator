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
    const instructions = `
    You are an expert translator specializing in Japanese game dialogue to English. Your task is to provide accurate and engaging English translations that capture the original meaning, character voice, emotional tone, and context.

    **Translation Guidelines:**

    * **Character Preservation:** Maintain the unique voice and personality of each character.
    * **Emotional Nuance:** Accurately convey hesitations (...), emphasis, and strong emotions using natural English expressions.
    * **Contextual Accuracy:** Ensure the translation fits seamlessly within the game's narrative and situation.
    * **Natural English:** Prioritize fluent and idiomatic English that resonates with native speakers.

    **Output Requirements:**

    * Provide only the translated text.
    * Preserve the original JSON structure and formatting.
    * Output ONLY the translated JSON data, keeping the keys identical.
    `;
    const prompt = `${initialPrompt}

                    Here is the data to translate (rows ${currentIndex + 1} to ${currentIndex + csvChunk.length} out of ${totalRows} total rows):
                    ${JSON.stringify(csvChunk, null, 2)}`;

    // Create the API request
    const response = await openai.responses.create({
      model: model || "gpt-4o", // Use provided model or fallback to gpt-4
      instructions: instructions,
      input: [
        {
          role: "developer",
          content: instructions,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      store: true,
      ...(previousResponseId && { previous_response_id: previousResponseId }),
      temperature: temperature ?? 1, // Use provided temperature or fallback to 1
    });

    const secondResponse = await openai.responses.create({
      model: model || "gpt-4o", // Use provided model or fallback to gpt-4
      previous_response_id: response.id,
      input: [
        // {
        //   role: "developer",
        //   content: instructions,
        // },
        {
          role: "user",
          content: refinementPrompt,
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
