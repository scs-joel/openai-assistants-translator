"use client";
import React, { useState } from "react";
import { useTranslation } from "@/app/hooks/useTranslation";

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
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">
        Japanese Game Dialog Translator
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="file" className="block text-sm font-medium mb-1">
            CSV File
          </label>
          <input
            type="file"
            id="file"
            accept=".csv"
            onChange={handleFileChange}
            className="block w-full text-sm border border-gray-300 rounded p-2"
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            CSV file with Japanese dialog text. Should include a column with
            Japanese text.
          </p>
        </div>

        <div>
          <label
            htmlFor="assistantId"
            className="block text-sm font-medium mb-1"
          >
            Assistant ID (Optional)
          </label>
          <input
            type="text"
            id="assistantId"
            value={assistantId}
            onChange={handleAssistantIdChange}
            className="block w-full text-sm border border-gray-300 rounded p-2"
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
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-blue-300"
        >
          {isLoading ? "Translating..." : "Translate Dialog"}
        </button>
      </form>

      {error && (
        <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {translationStats && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-2">Translation Results</h2>
          <div className="bg-gray-50 p-4 rounded">
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
              className="mt-4 px-4 py-2 bg-green-600 text-white rounded"
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
