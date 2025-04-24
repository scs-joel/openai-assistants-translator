//import OpenAI from "openai";

export const maxDuration = 300; // Set to the maximum allowed by your Vercel plan
import { openai } from "@/config/openai";

function generateStringArraySchema(keys) {
  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    return {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    };
  }

  const properties = {};
  const required = [];

  keys.forEach((key) => {
    properties[key] = { type: "string" };
    required.push(key);
  });

  return {
    type: "object",
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: properties,
          required: required,
          additionalProperties: false,
        },
      },
    },
    required: ["rows"],
    additionalProperties: false,
  };
}

export async function POST(request) {
  try {
    const {
      data,
      columns,
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
      operationMode,
    } = await request.json();

    // Initialize the OpenAI client
    openai.apiKey = apikey;
    // const openai = new OpenAI({
    //   apiKey: openaiApiKey,
    // });

    // Parse the CSV data chunk
    const csvChunk = JSON.parse(data);

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

    const prompt = `${initialPrompt || ''}

      Here is the data to translate (rows ${currentIndex + 1} to ${currentIndex + csvChunk.length} out of ${totalRows} total rows):
      ${JSON.stringify(csvChunk, null, 2)}`;

    const csvSchema = generateStringArraySchema(columns);

    // Create the API request
    const response = await openai.responses.create({
      model: model || "gpt-4o",
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
      temperature: temperature ?? 0.5,
      text: {
        format: {
          type: "json_schema",
          name: "translations",
          schema: csvSchema,
          strict: true,
        },
      },
    });

    let processedData;
    try {
      const outputText = response.output_text.trim();
      const parsedData = JSON.parse(outputText);

      if (refinementPrompt) {
        // Handle translation with refinement
        const secondResponse = await openai.responses.create({
          model: model || "gpt-4o",
          previous_response_id: response.id,
          input: refinementPrompt,
          store: true,
          temperature: temperature ?? 0.5,
          text: {
            format: {
              type: "json_schema",
              name: "translations",
              schema: csvSchema,
              strict: true,
            },
          },
        });

        const secondOutputText = secondResponse.output_text.trim();
        const refinedData = JSON.parse(secondOutputText);
        const lastProperty = Object.keys(refinedData.rows[0]).pop();

        processedData = parsedData.rows.map((row, index) => ({
          ...row,
          ["Refined"]: refinedData.rows[index][lastProperty],
        }));
      } else {
        // Handle direct translation
        processedData = parsedData.rows;
      }
    } catch (parseError) {
      console.error("Failed to parse results:", parseError);
      return Response.json(
        {
          error: "Failed to parse results",
          message: parseError.message,
        },
        { status: 500 },
      );
    }

    // Return processed data and the response ID for continuity
    return Response.json({
      translatedData: processedData,
      responseId: response.id,
      message: `Successfully processed rows ${currentIndex + 1} to ${currentIndex + processedData.length}`,
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
