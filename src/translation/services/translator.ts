import { parse } from "csv-parse";
import { stringify } from "csv-stringify/sync";
import fs from "fs";
import path from "path";

import { openai } from "@/config/openai";

import { translatorConfig } from "../config/translator";

export async function createTranslationAssistant(openaiApiKey: string) {
  // Define the assistant's instructions
  const instructions = `
  You are a specialized translator for Japanese game dialog to English. Your task is to:

  1. Translate the dialog into natural, conversational English
  2. Preserve character voice, emotional tone, and cultural context
  3. Handle hesitations (...), emphasis, and strong emotions authentically
  4. Focus on how English speakers would naturally express these ideas
  5. Remember you are being given a script
  6. Make sure to translate the entire document
  7. Output only the translations with no explanations.

  When translating, consider the character's personality and background when available.
  For each translated line, maintain the same format as the input with [Line N] identifiers.
  `;

  openai.apiKey = openaiApiKey;
  // Create the assistant
  const assistant = await openai.beta.assistants.create({
    name: "Japanese Game Dialog Translator",
    instructions: instructions,
    model: "gpt-4o",
    tools: [{ type: "file_search" }],
    temperature: 1,
  });

  console.log(`Created assistant with ID: ${assistant.id}`);
  return assistant;
}

export async function translateGameDialog(
  fileContent: string,
  fileName: string,
  openaiApiKey: string,
  assistantId: string = translatorConfig.assistant_id,
) {
  openai.apiKey = openaiApiKey;
  // Parse the CSV content
  const records: Record<string, string>[] = [];

  // Use a Promise to handle the async parsing
  await new Promise<void>((resolve, reject) => {
    parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    })
      .on("readable", function () {
        let record: Record<string, string>;
        while ((record = this.read()) !== null) {
          records.push(record);
        }
      })
      .on("error", (err) => {
        reject(err);
      })
      .on("end", () => {
        resolve();
      });
  });

  console.log(`Parsed ${records.length} rows from uploaded file`);

  // Get source_col, target_col, refinement_col from config
  const { source_column, target_column, refinement_column } =
    translatorConfig.columns;
  const { first_message, second_message } = translatorConfig.messages;

  // Get character column if it exists
  let charCol: string | null = null;
  const firstRow = records[0] || {};
  const columns = Object.keys(firstRow);

  for (const col of columns) {
    if (
      col.toLowerCase().includes("character") ||
      col.toLowerCase().includes("name") ||
      col.includes("キャラクター名")
    ) {
      charCol = col;
      break;
    }
  }

  // If source column is not in dataframe, try to find a suitable column
  let sourceCol = source_column;
  if (!columns.includes(sourceCol)) {
    for (const col of columns) {
      if (
        col.toLowerCase().includes("japanese") ||
        col.toLowerCase().includes("source") ||
        col.toLowerCase().includes("original")
      ) {
        sourceCol = col;
        break;
      }
    }
    console.log(`Source column not found in config, using: ${sourceCol}`);
  }

  // Create a text file from the CSV content
  let textContent = "# JAPANESE GAME DIALOG\n\n";

  // Write dialog entries to the text content
  records.forEach((row, i) => {
    if (!row[sourceCol]) return;

    const charName = charCol && row[charCol] ? row[charCol] : "";
    const text = row[sourceCol];

    if (charName) {
      textContent += `[Line ${i + 1} - ${charName}] : ${text}\n\n`;
    } else {
      textContent += `[Line ${i + 1}]: ${text}\n\n`;
    }
  });

  // Create a temporary file
  const tempFilePath = path.join("/tmp", `${Date.now()}-${fileName}.txt`);
  fs.writeFileSync(tempFilePath, textContent, "utf8");
  console.log(`Created temporary text file: ${tempFilePath}`);

  // Upload the text file to OpenAI
  const fileStream = fs.createReadStream(tempFilePath);
  const file = await openai.files.create({
    file: fileStream,
    purpose: "assistants",
  });
  console.log(`Uploaded file with ID: ${file.id}`);

  // Clean up temporary file
  fs.unlinkSync(tempFilePath);

  // Create a vector store for our file
  const vectorStore = await openai.vectorStores.create({
    name: "Japanese Game Dialog",
    file_ids: [file.id],
  });
  console.log(`Created vector store with ID: ${vectorStore.id}`);

  // Poll until file processing is complete
  let vs;
  do {
    vs = await openai.vectorStores.retrieve(vectorStore.id);
    if (
      vs.file_counts.completed + vs.file_counts.failed <
      vs.file_counts.total
    ) {
      console.log(
        `Processing files... ${vs.file_counts.completed}/${vs.file_counts.total} completed`,
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } while (
    vs.file_counts.completed + vs.file_counts.failed <
    vs.file_counts.total
  );
  console.log("All files processed");

  // Get or create an assistant
  let assistant;
  if (!assistantId) {
    assistant = await createTranslationAssistant(openaiApiKey);
    assistantId = assistant.id;
  }

  // Update the assistant to use the vector store
  await openai.beta.assistants.update(assistantId, {
    tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
  });
  console.log(`Updated assistant to use vector store: ${vectorStore.id}`);

  // Create a thread
  const thread = await openai.beta.threads.create();
  console.log(`Created thread with ID: ${thread.id}`);

  // Create message in the thread
  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: first_message,
  });

  // Run the assistant on the thread
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
  });

  console.log("Translation in progress...");

  // Poll for completion
  let runStatus;
  do {
    runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

    if (runStatus.status === "completed") {
      console.log("Translation completed!");
    } else if (["failed", "cancelled", "expired"].includes(runStatus.status)) {
      console.log(`Translation failed with status: ${runStatus.status}`);
      throw new Error(`Translation failed with status: ${runStatus.status}`);
    } else {
      console.log(`Current status: ${runStatus.status}. Waiting...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } while (
    !["completed", "failed", "cancelled", "expired"].includes(runStatus.status)
  );

  // Retrieve the messages
  const messages = await openai.beta.threads.messages.list(thread.id, {
    order: "asc",
  });

  // Get the response message
  const assistantMessages = messages.data.filter(
    (msg) => msg.role === "assistant",
  );
  if (assistantMessages.length === 0) {
    console.log("No response from assistant");
    return { success: false, error: "No response from assistant" };
  }

  const latestMessage = assistantMessages[0];
  let translatedContent = "";

  // Extract text content from the message
  for (const contentItem of latestMessage.content) {
    if (contentItem.type === "text") {
      translatedContent += contentItem.text.value;
    }
  }

  // Parse the initial translations
  const initialTranslations: Record<number, string> = {};
  const currentLines = translatedContent.split("[Line ");

  for (const line of currentLines) {
    if (!line.trim()) continue;

    // Extract line number and translation
    const parts = line.split("]", 2);
    if (parts.length < 2) continue;

    try {
      const lineNumber = parseInt(parts[0].trim(), 10);
      let translation = parts[1].trim();

      // Clean up any leading colons or spaces
      if (translation.startsWith(":")) {
        translation = translation.substring(1).trim();
      }

      // Adjust to 0-based index
      initialTranslations[lineNumber - 1] = translation;
    } catch (error) {
      continue;
    }
  }

  // Add initial translations to rows
  records.forEach((row, idx) => {
    if (initialTranslations[idx]) {
      row[target_column] = initialTranslations[idx];
    } else {
      row[target_column] = "";
    }
  });

  // Add a second message to the thread for refinement
  console.log("Adding second message to refine translations...");
  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: second_message,
  });

  // Run the assistant again on the thread
  const secondRun = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
  });

  console.log("Refinement in progress...");

  // Poll for completion of the second run
  let secondRunStatus;
  do {
    secondRunStatus = await openai.beta.threads.runs.retrieve(
      thread.id,
      secondRun.id,
    );

    if (secondRunStatus.status === "completed") {
      console.log("Refinement completed!");
    } else if (
      ["failed", "cancelled", "expired"].includes(secondRunStatus.status)
    ) {
      console.log(`Refinement failed with status: ${secondRunStatus.status}`);
      // We'll continue with the initial translations
      break;
    } else {
      console.log(`Current status: ${secondRunStatus.status}. Waiting...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } while (
    !["completed", "failed", "cancelled", "expired"].includes(
      secondRunStatus.status,
    )
  );

  // Retrieve all messages again to get the refined translation
  const updatedMessages = await openai.beta.threads.messages.list(thread.id, {
    order: "asc",
  });

  // Get the latest assistant message
  const refinedAssistantMessages = updatedMessages.data.filter(
    (msg) => msg.role === "assistant",
  );
  let refinedContent = "";

  if (refinedAssistantMessages.length < 2) {
    console.log(
      "No refined response from assistant, using original translation",
    );
    refinedContent = translatedContent;
  } else {
    // Get the second assistant message
    const refinedMessage = refinedAssistantMessages[1];

    // Extract text content from the refined message
    for (const contentItem of refinedMessage.content) {
      if (contentItem.type === "text") {
        refinedContent += contentItem.text.value;
      }
    }
    console.log("Retrieved refined translation");
  }

  // Parse the refined translations
  const refinedTranslations: Record<number, string> = {};
  const refinedLines = refinedContent.split("[Line ");

  for (const line of refinedLines) {
    if (!line.trim()) continue;

    // Extract line number and translation
    const parts = line.split("]", 2);
    if (parts.length < 2) continue;

    try {
      const lineNumber = parseInt(parts[0].trim(), 10);
      let translation = parts[1].trim();

      // Clean up any leading colons or spaces
      if (translation.startsWith(":")) {
        translation = translation.substring(1).trim();
      }

      // Adjust to 0-based index
      refinedTranslations[lineNumber - 1] = translation;
    } catch (error) {
      continue;
    }
  }

  // Add refined translations to rows
  records.forEach((row, idx) => {
    if (refinedTranslations[idx]) {
      row[refinement_column] = refinedTranslations[idx];
    } else {
      row[refinement_column] = "";
    }
  });

  // Convert back to CSV
  const resultCsv = stringify(records, { header: true });

  return {
    success: true,
    data: resultCsv,
    stats: {
      total_rows: records.length,
      translated_rows: Object.keys(initialTranslations).length,
      refined_rows: Object.keys(refinedTranslations).length,
    },
  };
}
