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
      enableSpellCheck,
    } = await request.json();

    // Initialize the OpenAI client
    openai.apiKey = apikey;
    // const openai = new OpenAI({
    //   apiKey: openaiApiKey,
    // });

    // Parse the CSV data chunk
    const csvChunk = JSON.parse(data);

    const instructions = operationMode === 'translate'
      ? `
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
        `
      : `
        You are an expert in English language and grammar. Your task is to check the provided text for spelling and grammatical errors.

        **Guidelines:**

        * Check for spelling mistakes
        * Check for grammatical errors
        * Check for punctuation issues
        * Check for word usage and context
        * Check for consistency in style and tone

        **Output Requirements:**

        * For each text entry, provide a list of errors found
        * If no errors are found, output "No errors found"
        * Preserve the original JSON structure
        * Add an "errors" field to each entry with the findings
        `;

    const prompt = operationMode === 'translate'
      ? `${initialPrompt || ''}

          Here is the data to translate (rows ${currentIndex + 1} to ${currentIndex + csvChunk.length} out of ${totalRows} total rows):
          ${JSON.stringify(csvChunk, null, 2)}`
      : `
          Here is the data to check for spelling and grammar errors (rows ${currentIndex + 1} to ${currentIndex + csvChunk.length} out of ${totalRows} total rows):
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

      if (operationMode === 'translate' && refinementPrompt) {
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
        // Handle direct translation or spell check
        processedData = parsedData.rows;
      }

      // If spell check is enabled, add error markers
      if (enableSpellCheck) {
        processedData = processedData.map(row => {
          const errors = row.Errors || "No errors found";
          // Add a star marker in the cell to the right if there are errors
          const rowWithMarker = { ...row };
          if (errors !== "No errors found") {
            // Find the last column that has content
            const lastColumn = Object.keys(row).reduce((last, key) => {
              return row[key] ? key : last;
            }, "");
            // Add a star marker in the next column
            const nextColumn = String.fromCharCode(lastColumn.charCodeAt(0) + 1);
            rowWithMarker[nextColumn] = "*";
          }
          return {
            ...rowWithMarker,
            ["Errors"]: errors
          };
        });
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
