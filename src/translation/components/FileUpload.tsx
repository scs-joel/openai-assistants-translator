"use client";
import React, { useState } from "react";

import { useTranslation } from "@/translation/hooks/useTranslation";

const FileUpload: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [assistantId, setAssistantId] = useState<string>("");
  const {
    translateFile,
    downloadTranslatedFile,
    isLoading,
    error,
    translationStats,
    translatedCsvData,
  } = useTranslation();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleAssistantIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAssistantId(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      return;
    }

    await translateFile(file, assistantId || undefined);
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Game Dialog Translator</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="file" className="mb-1 block text-sm font-medium">
            CSV File
          </label>
          <input
            type="file"
            id="file"
            accept=".csv"
            onChange={handleFileChange}
            className="block w-full rounded border border-gray-300 p-2 text-sm"
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            CSV file with Japanese dialog text.
            <br /> 1. Text to translated should be under a column called
            &apos;Japanese&apos;
            <br /> 2. Destinated column for translated text should be called
            &apos;English&apos;
          </p>
        </div>

        <div>
          <label
            htmlFor="assistantId"
            className="mb-1 block text-sm font-medium"
          >
            Assistant ID (Optional)
          </label>
          <input
            type="text"
            id="assistantId"
            value={assistantId}
            onChange={handleAssistantIdChange}
            className="block w-full rounded border border-gray-300 p-2 text-sm"
            placeholder="OpenAI Assistant ID (optional)"
          />
          <p className="mt-1 text-xs text-gray-500">
            If blank, a new assistant will be created or the default one will be
            used
          </p>
        </div>

        <button
          type="submit"
          disabled={isLoading || !file}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:bg-blue-300"
        >
          {isLoading ? "Translating..." : "Translate Dialog"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded border border-red-400 bg-red-100 p-4 text-red-700">
          {error}
        </div>
      )}

      {translationStats && (
        <div className="mt-6">
          <h2 className="mb-2 text-xl font-semibold">Translation Results</h2>
          <div className="rounded bg-gray-50 p-4">
            <p>
              <strong>Total Rows:</strong> {translationStats.total_rows}
            </p>
            <p>
              <strong>Translated Rows:</strong>{" "}
              {translationStats.translated_rows}
            </p>
            <p>
              <strong>Refined Rows:</strong> {translationStats.refined_rows}
            </p>
          </div>

          {translatedCsvData && (
            <button
              onClick={downloadTranslatedFile}
              className="mt-4 rounded bg-green-600 px-4 py-2 text-white"
            >
              Download Translated CSV
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default FileUpload;
