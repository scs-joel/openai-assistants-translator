import { openai } from "@/config/openai";

function generateCheckerSchema(keys) {
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
    properties[key] = { type: "boolean" };
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
      language,
      apikey,
      model,
      temperature,
    } = await request.json();

    // Initialize the OpenAI client
    openai.apiKey = apikey;

    // Parse the CSV data chunk
    const csvChunk = JSON.parse(data);

    const instructions = `
      You are an expert proofreader. Your task is to identify any spelling or grammar mistakes in the provided text.
      Do not make any corrections, only indicate if mistakes exist.
      Return true if there are any mistakes, false if the text is correct.
    `;

    const prompt = `
      Check the following text for any spelling or grammar mistakes.
      Do not correct any mistakes, only indicate if they exist.
      Return true if there are any mistakes, false if the text is correct.

      Here is the data to check:
      ${JSON.stringify(csvChunk, null, 2)}`;

    const checkerSchema = generateCheckerSchema(columns);

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
      temperature: temperature ?? 0.5,
      text: {
        format: {
          type: "json_schema",
          name: "checker",
          schema: checkerSchema,
          strict: true,
        },
      },
    });

    let processedData;
    try {
      const outputText = response.output_text.trim();
      const parsedData = JSON.parse(outputText);
      processedData = parsedData.rows;
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

    // Return processed data
    return Response.json({
      checkedData: processedData,
      message: `Successfully checked ${processedData.length} rows`,
    });
  } catch (error) {
    console.error("Checker API error:", error);
    return Response.json(
      {
        error: "Checking failed",
        message: error.message,
      },
      { status: 500 },
    );
  }
}