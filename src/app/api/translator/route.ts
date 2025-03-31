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
    } = await request.json();

    // Initialize the OpenAI client
    openai.apiKey = apikey;
    // const openai = new OpenAI({
    //   apiKey: openaiApiKey,
    // });

    // Parse the CSV data chunk
    const csvChunk = JSON.parse(data);

    // const instructions = `
    // You are ChatGPT, a large language model trained by OpenAI.
    // Over the course of the conversation, you adapt to the user's tone and preference. Try to match the user's vibe, tone, and generally how they are speaking. You want the conversation to feel natural. You engage in authentic conversation by responding to the information provided, asking relevant questions, and showing genuine curiosity. If natural, continue the conversation with casual conversation.

    // You are an expert translator specializing in Japanese game dialogue to English. Your task is to provide accurate and engaging English translations that capture the original meaning, character voice, emotional tone, and context.

    // **Translation Guidelines:**

    // * **Character Preservation:** Maintain the unique voice and personality of each character.
    // * **Emotional Nuance:** Accurately convey hesitations (...), emphasis, and strong emotions using natural English expressions.
    // * **Contextual Accuracy:** Ensure the translation fits seamlessly within the game's narrative and situation.
    // * **Natural English:** Prioritize fluent and idiomatic English that resonates with native speakers.

    // **Output Requirements:**

    // * Provide only the translated text.
    // * Preserve the original JSON structure and formatting.
    // * Output ONLY the translated JSON data, keeping the keys identical.
    // `;

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

    const csvSchema = generateStringArraySchema(columns);

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
      temperature: temperature ?? 0.5, // Use provided temperature or fallback to 1
      text: {
        format: {
          type: "json_schema",
          name: "translations",
          schema: csvSchema,
          strict: true,
        },
      },
    });

    const secondResponse = await openai.responses.create({
      model: model || "gpt-4o", // Use provided model or fallback to gpt-4
      previous_response_id: response.id,
      input: refinementPrompt,
      store: true,
      temperature: temperature ?? 0.5, // Use provided temperature or fallback to 1
      text: {
        format: {
          type: "json_schema",
          name: "translations",
          schema: csvSchema,
          strict: true,
        },
      },
    });
    console.log("received translation");

    // Parse both responses to get the translated data
    let firstTranslation, secondTranslation, combinedTranslations;
    try {
      // Parse first translation
      const firstOutputText = response.output_text.trim();
      firstTranslation = JSON.parse(firstOutputText);

      // Parse second translation
      const secondOutputText = secondResponse.output_text.trim();
      secondTranslation = JSON.parse(secondOutputText);

      // Get the last property name from the first row
      const lastProperty = Object.keys(secondTranslation.rows[0]).pop();

      // Combine translations by adding only the last property from refined version
      combinedTranslations = firstTranslation.rows.map((row, index) => ({
        ...row,
        ["refined"]: secondTranslation.rows[index][lastProperty],
      }));
    } catch (parseError) {
      console.error("Failed to parse translation results:", parseError);
      return Response.json(
        {
          error: "Failed to parse translation results",
          message: parseError.message,
        },
        { status: 500 },
      );
    }

    // Return combined translations and the response ID for continuity
    return Response.json({
      translatedData: combinedTranslations,
      responseId: response.id,
      message: `Successfully translated rows ${currentIndex + 1} to ${currentIndex + combinedTranslations.length}`,
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
