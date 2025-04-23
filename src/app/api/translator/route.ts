import { NextRequest, NextResponse } from 'next/server'; // Import request/response types

import { openai } from "@/config/openai";

export const maxDuration = 300; // Vercel timeout

// Helper function to generate schema for OpenAI JSON mode (remains the same)
function generateStringArraySchema(keys: string[]) {
  // ... (keep existing schema generation function)
  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    return {
      type: "object",
      properties: {
         rows: { type: "array", items: { type: "object", properties: {}, required: [], additionalProperties: true } } // Allow additional props initially
      },
      required: ["rows"]
    };
  }

  const properties: { [key: string]: { type: string } } = {};
  keys.forEach((key) => {
    properties[key] = { type: "string" };
  });

  return {
    type: "object",
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: properties,
          required: keys, // Require original keys initially
          additionalProperties: true, // Allow adding Refined/Errors/Markers later
        },
      },
    },
    required: ["rows"],
    additionalProperties: false, // Root object should not have extra props
  };
}

// Helper function to create schema for spell check results
function createSpellCheckSchema(count: number) {
    return {
        type: "object",
        properties: {
            results: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        errors: {
                            type: "string",
                            description: "List of spelling/grammar errors found, or 'No errors found'."
                        }
                    },
                    required: ["errors"]
                },
                minItems: count,
                maxItems: count
            }
        },
        required: ["results"]
    };
}


export async function POST(request: NextRequest) {
  try {
    const {
      data,
      columns, // Columns known by the frontend *before* this request
      sourceLanguage, // Only relevant for translation mode
      targetLanguage, // Only relevant for translation mode
      previousResponseId,
      totalRows,
      currentIndex,
      apikey,
      initialPrompt,   // Only relevant for translation mode
      refinementPrompt,// Only relevant for translation mode
      model = "gpt-4o",
      temperature = 0.5,
      operationMode = "translate", // Default to translate
      enableSpellCheck = false,
      spellCheckColumn, // The specific column to check
    } = await request.json();

    if (!apikey) {
        return NextResponse.json({ error: "API key is required" }, { status: 400 });
    }
     if ((enableSpellCheck || operationMode === 'spellcheck') && !spellCheckColumn) {
         return NextResponse.json({ error: "Spell check column name is required when spell check is enabled." }, { status: 400 });
     }

    // Initialize the OpenAI client
    openai.apiKey = apikey;

    // Parse the incoming CSV data chunk
    let currentChunk: any[];
    try {
         currentChunk = JSON.parse(data);
         if (!Array.isArray(currentChunk)) throw new Error("Data is not an array.");
    } catch (e: any) {
         console.error("Failed to parse incoming data chunk:", e);
         return NextResponse.json({ error: "Invalid data format received.", message: e.message }, { status: 400 });
    }

    if (currentChunk.length === 0) {
        return NextResponse.json({ processedData: [], finalColumns: columns, message: "Empty chunk received." });
    }

    let processedChunk = [...currentChunk]; // Work on a copy
    const finalColumns = [...columns]; // Start with columns known by frontend
    const currentResponseId = previousResponseId; // Track response ID chain

    // --- Step 1: Translation (if in translate mode) ---
    if (operationMode === 'translate') {
        console.log(`Starting translation for rows ${currentIndex + 1} to ${currentIndex + processedChunk.length}`);
        const translationInstructions = initialPrompt || `Translate from ${sourceLanguage} to ${targetLanguage}. Keep JSON structure.`; // Default fallback
        const translationUserPrompt = `Translate the following data:\n${JSON.stringify(processedChunk, null, 2)}`;
        const translationSchema = generateStringArraySchema(columns); // Schema based on *input* columns for translation

        try {
            const translationResponse = await openai.chat.completions.create({ // Use chat completions for better JSON mode usually
                model: model,
                messages: [
                    { role: "system", content: translationInstructions },
                    { role: "user", content: translationUserPrompt }
                ],
                response_format: { type: "json_object" }, // Request JSON output
                temperature: temperature,
                // Include previous_response_id logic if using a specific API like `openai.responses.create`
                // ...(currentResponseId && { previous_response_id: currentResponseId }),
                // store: true, // If using openai.responses.create
            });

            // currentResponseId = translationResponse.id; // Update if using openai.responses.create

            const outputText = translationResponse.choices[0]?.message?.content;
            if (!outputText) throw new Error("OpenAI returned empty content for translation.");

            const parsedTranslation = JSON.parse(outputText);
             if (!parsedTranslation.rows || !Array.isArray(parsedTranslation.rows) || parsedTranslation.rows.length !== processedChunk.length) {
                  throw new Error(`Translation output structure mismatch. Expected ${processedChunk.length} rows.`);
             }

             // Update processedChunk with translations
             // Important: Merge based on original data, assuming translation keeps all original keys
             // and adds/modifies the target language field. This needs careful mapping if keys change.
             // Assuming the translation *replaces* the source text column with the target text column
             // OR that the target language column already exists and is being filled.
             // For simplicity, let's assume the output JSON replaces the whole row content based on the schema.
             processedChunk = parsedTranslation.rows;

             console.log(`Translation successful for rows ${currentIndex + 1} to ${currentIndex + processedChunk.length}`);

        } catch (error: any) {
            console.error("Error during Initial Translation:", error);
             return NextResponse.json({ error: "Translation failed", message: error.message }, { status: 500 });
        }


        // --- Step 1b: Refinement (if enabled) ---
        if (initialPrompt && refinementPrompt) { // Condition from original frontend logic
             console.log(`Starting refinement for rows ${currentIndex + 1} to ${currentIndex + processedChunk.length}`);
             const refinementInstructions = refinementPrompt; // Use the prompt directly
             const refinementUserPrompt = `Refine the following translated data:\n${JSON.stringify(processedChunk, null, 2)}`;
             // Schema for refinement might be the same or different depending on expected output
             const refinementSchema = generateStringArraySchema(columns); // Assuming refinement modifies existing columns

             try {
                 const refinementResponse = await openai.chat.completions.create({
                     model: model,
                     messages: [
                         { role: "system", content: refinementInstructions },
                         { role: "user", content: refinementUserPrompt }
                     ],
                     response_format: { type: "json_object" },
                     temperature: temperature,
                     // ...(currentResponseId && { previous_response_id: currentResponseId }), // Chain if needed
                     // store: true,
                 });

                 // currentResponseId = refinementResponse.id; // Update ID

                 const outputText = refinementResponse.choices[0]?.message?.content;
                 if (!outputText) throw new Error("OpenAI returned empty content for refinement.");

                 const parsedRefinement = JSON.parse(outputText);
                 if (!parsedRefinement.rows || !Array.isArray(parsedRefinement.rows) || parsedRefinement.rows.length !== processedChunk.length) {
                     throw new Error(`Refinement output structure mismatch. Expected ${processedChunk.length} rows.`);
                 }

                 // ---- How to merge refinement? ----
                 // Option 1: Assume refinement output replaces the whole row data again.
                 // processedChunk = parsedRefinement.rows;

                 // Option 2: Add a new 'Refined' column (like original code attempted)
                 // This requires the AI to *only* output the refined text for a specific column.
                 // Let's try adding a 'Refined' column. Assume the refinement prompt asks AI to output JSON
                 // with ONLY the refined text under a specific key (e.g., 'refined_text').
                 // This is complex and depends heavily on prompt engineering.

                 // Let's stick to the simpler approach for now: assume refinement OVERWRITES the previous translation step's data.
                 // This means the refinement prompt needs to be very clear about preserving structure.
                  processedChunk = parsedRefinement.rows;

                 // --- OR --- If adding a "Refined" column based on the LAST property of the refined output (like original)
                 // const refinedColumnName = "Refined";
                 // if (!finalColumns.includes(refinedColumnName)) {
                 //     finalColumns.push(refinedColumnName);
                 // }
                 // processedChunk = processedChunk.map((row, index) => {
                 //     const refinedRow = parsedRefinement.rows[index];
                 //     const lastKey = Object.keys(refinedRow).pop();
                 //     return {
                 //         ...row, // Keep original translated row data
                 //         [refinedColumnName]: lastKey ? refinedRow[lastKey] : "Refinement Error" // Add refined text
                 //     };
                 // });
                 console.log(`Refinement successful for rows ${currentIndex + 1} to ${currentIndex + processedChunk.length}`);

             } catch (error: any) {
                console.error("Error during Refinement:", error);
                // Don't fail entirely, maybe just log and continue without refinement?
                console.warn("Continuing without refinement due to error.");
                // Or return error:
                // return NextResponse.json({ error: "Refinement failed", message: error.message }, { status: 500 });
             }
        }
    } // End of translation block

    // --- Step 2: Spell Check (if enabled for the mode OR mode is 'spellcheck') ---
    let spellCheckApplied = false;
    if (enableSpellCheck && spellCheckColumn) {
        console.log(`Starting spell check on column '${spellCheckColumn}' for rows ${currentIndex + 1} to ${currentIndex + processedChunk.length}`);

         // Validate spellCheckColumn exists in the current data
         if (processedChunk.length > 0 && !(spellCheckColumn in processedChunk[0])) {
            console.error(`Spell check column '${spellCheckColumn}' not found in processed data.`);
            return NextResponse.json({ error: `Spell check column '${spellCheckColumn}' not found after translation/refinement.` }, { status: 400 });
         }

        // Prepare data for spell check (just the relevant column)
        const dataToCheck = processedChunk.map((row, index) => ({
            id: index, // Include an ID to map results back easily
            text: row[spellCheckColumn] || "" // Ensure text is a string
        }));

        const spellCheckInstructions = `You are an expert English proofreader. Analyze the 'text' field in each JSON object provided by the user. Identify spelling, grammar, punctuation, and major stylistic errors. For each object, return a concise description of errors found. If no errors are found, return the exact string "No errors found".`;
        const spellCheckUserPrompt = `Analyze the following texts:\n${JSON.stringify(dataToCheck, null, 2)}`;
        const spellCheckSchema = createSpellCheckSchema(dataToCheck.length);

        try {
             const spellCheckResponse = await openai.chat.completions.create({
                 model: "gpt-4o-mini", // Use a cheaper/faster model for spell check
                 messages: [
                     { role: "system", content: spellCheckInstructions },
                     { role: "user", content: spellCheckUserPrompt }
                 ],
                 response_format: { type: "json_object", schema: spellCheckSchema }, // Use schema
                 temperature: 0.2, // Low temperature for factual checking
                 // Add chaining/store if using openai.responses.create
             });

             // currentResponseId = spellCheckResponse.id; // Update ID

             const outputText = spellCheckResponse.choices[0]?.message?.content;
             if (!outputText) throw new Error("OpenAI returned empty content for spell check.");

             const parsedSpellCheck = JSON.parse(outputText);
             const spellCheckResults = parsedSpellCheck.results;

             if (!spellCheckResults || !Array.isArray(spellCheckResults) || spellCheckResults.length !== dataToCheck.length) {
                 throw new Error(`Spell check output structure mismatch. Expected ${dataToCheck.length} results.`);
             }

             // Add 'Errors' column if it doesn't exist
             const errorsColumnName = "Errors";
             if (!finalColumns.includes(errorsColumnName)) {
                finalColumns.push(errorsColumnName);
             }

             // Process results and add markers
             const markerColumnName = `${spellCheckColumn}_Marker`;
             let markerColumnAdded = finalColumns.includes(markerColumnName); // Check if already added in a previous chunk run
             const spellCheckColIndex = finalColumns.indexOf(spellCheckColumn);

             processedChunk = processedChunk.map((row, index) => {
                 const checkResult = spellCheckResults[index];
                 const errorsFound = checkResult && checkResult.errors && checkResult.errors !== "No errors found";
                 const newRow = { ...row, [errorsColumnName]: checkResult?.errors || "Check Error" };

                 if (errorsFound && spellCheckColIndex !== -1) {
                    // Add marker column to list if not already there
                    if (!markerColumnAdded) {
                        // Insert immediately after the checked column
                        finalColumns.splice(spellCheckColIndex + 1, 0, markerColumnName);
                        markerColumnAdded = true; // Prevent adding it multiple times within this chunk
                    }
                     // Add the star marker to the row's data
                     newRow[markerColumnName] = "*";
                 } else if (markerColumnAdded) {
                    // Ensure the marker column exists even if no error, to maintain structure
                    newRow[markerColumnName] = newRow[markerColumnName] || "";
                 }

                 return newRow;
             });
             spellCheckApplied = true;
             console.log(`Spell check successful for rows ${currentIndex + 1} to ${currentIndex + processedChunk.length}`);

        } catch (error: any) {
             console.error("Error during Spell Check:", error);
             // Decide how to handle: fail, or continue without spell check?
             // Let's add an error message but continue
             processedChunk = processedChunk.map(row => ({ ...row, [finalColumns.includes("Errors") ? "Errors" : "ProcessingError"]: `Spell check failed: ${error.message}` }));
             if (!finalColumns.includes("Errors") && !finalColumns.includes("ProcessingError")) {
                 finalColumns.push("ProcessingError");
             }
             // Don't return error response, just log and include error in data
             // return NextResponse.json({ error: "Spell check failed", message: error.message }, { status: 500 });
        }

    } // End of spell check block

    // --- Step 3: Final Formatting - Ensure all rows have all final columns ---
    const finalProcessedData = processedChunk.map(row => {
        const completeRow: { [key: string]: any } = {};
        finalColumns.forEach(col => {
            completeRow[col] = row[col] ?? ""; // Use empty string if value is null/undefined
        });
        return completeRow;
    });

    // --- Step 4: Return results ---
    return NextResponse.json({
      processedData: finalProcessedData,
      finalColumns: finalColumns, // Send the potentially updated list of columns back
      responseId: currentResponseId, // Send back the last used ID for potential chaining
      message: `Successfully processed rows ${currentIndex + 1} to ${currentIndex + finalProcessedData.length}. Spell check ${spellCheckApplied ? 'applied' : 'skipped'}.`,
    });

  } catch (error: any) {
    console.error("API Route Error:", error);
    return NextResponse.json(
      {
        error: "Request failed",
        message: error.message || "An unexpected error occurred.",
      },
      { status: 500 }
    );
  }
}