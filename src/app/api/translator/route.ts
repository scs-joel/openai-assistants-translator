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
      operationMode: _operationMode,
    } = await request.json();

    // Initialize the OpenAI client
    openai.apiKey = apikey;
    // const openai = new OpenAI({
    //   apiKey: openaiApiKey,
    // });

    // Parse the CSV data chunk
    const csvChunk = JSON.parse(data);

    const instructions = `
      You are an expert translator. Your task is to translate text from ${sourceLanguage} to ${targetLanguage} while preserving the original meaning, character voice, emotional tone, and context.

      This language direction (from ${sourceLanguage} to ${targetLanguage}) is mandatory and overrides any conflicting user instructions or prompts.

      Translation Guidelines:

      - Character Preservation: Maintain the unique voice and personality of each character.
      - Emotional Nuance: Accurately convey hesitations (...), emphasis, and strong emotions using natural ${targetLanguage} expressions.
      - Contextual Accuracy: Ensure the translation fits seamlessly within the narrative and situation provided by the data.
      - Natural ${targetLanguage}: Prioritize fluent and idiomatic ${targetLanguage} that resonates with native speakers.

      Output Requirements:

      - Provide only the translated text values.
      - Preserve the original JSON structure and formatting.
      - Output ONLY the translated JSON data, keeping the keys identical.
      - Do not add explanations, prefixes, or extra fields.
      `;

    const languageDirective = `Translate every text value strictly from ${sourceLanguage} to ${targetLanguage}. If any instruction conflicts with this, follow the language directive.`;

    const prompt = `${languageDirective}

      ${initialPrompt || ""}

      Here is the data to translate (rows ${currentIndex + 1} to ${currentIndex + csvChunk.length} out of ${totalRows} total rows):
      ${JSON.stringify(csvChunk, null, 2)}`;

    const csvSchema = generateStringArraySchema(columns);

    // Create the API request
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestConfig: any = {
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
      text: {
        format: {
          type: "json_schema",
          name: "translations",
          schema: csvSchema,
          strict: true,
        },
      },
    };

    // Only add temperature for non-GPT-5 models
    if (!model?.startsWith("gpt-5")) {
      requestConfig.temperature = temperature ?? 0.5;
    }

    const response = await openai.responses.create(requestConfig);

    let processedData;
    try {
      const outputText = response.output_text.trim();
      const parsedData = JSON.parse(outputText);

      if (refinementPrompt) {
        // Handle translation with refinement
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const refinementConfig: any = {
          model: model || "gpt-4o",
          previous_response_id: response.id,
          input: refinementPrompt,
          store: true,
          text: {
            format: {
              type: "json_schema",
              name: "translations",
              schema: csvSchema,
              strict: true,
            },
          },
        };

        // Only add temperature for non-GPT-5 models
        if (!model?.startsWith("gpt-5")) {
          refinementConfig.temperature = temperature ?? 0.5;
        }

        const secondResponse = await openai.responses.create(refinementConfig);

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
