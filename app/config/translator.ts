export const translatorConfig = {
  assistant_id: process.env.OPENAI_ASSISTANT_ID || null,
  messages: {
    first_message:
      "Please translate the Japanese game dialog entries in the attached file into English. Make the English translation sound natural while keeping the overall context in mind. Keep the [Line N] format in your response so I can match translations to the original text.",
    second_message:
      "Make the English translation sound natural while keeping the overall context in mind.",
  },
  columns: {
    source_column: "Japanese",
    target_column: "English",
    refinement_column: "Refined",
  },
};
