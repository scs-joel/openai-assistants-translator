"use client";

import Papa from "papaparse";
import React, { useRef, useState } from "react";

import { cn } from "@/utils";

export default function Translator() {
  const [openaiApiKey, setOpenAIApiKey] = useState<string>("");

  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [csvData, setCsvData] = useState([]);
  const [columns, setColumns] = useState([]);
  const [translatedData, setTranslatedData] = useState([]);
  const [sourceLanguage, setSourceLanguage] = useState("ja");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastResponseId, setLastResponseId] = useState(null);
  const [error, setError] = useState(null);
  const [model, setModel] = useState("chatgpt-4o-latest");
  const [temperature, setTemperature] = useState(0.5);
  const [showPrompts, setShowPrompts] = useState(false);
  const [enableRefinement, setEnableRefinement] = useState(false);
  const [operationMode, setOperationMode] = useState<"translate">("translate");
  const [initialPrompt, setInitialPrompt] = useState(
    `Translate the following Japanese text to English.
Make the English translation sound natural while keeping the overall context in mind.
When translating, consider the character's personality and background when available.`,
  );
  const [refinementPrompt, setRefinementPrompt] = useState(
    `Make the English translation sound natural while keeping the overall context in mind.
    `,
  );

  const fileInputRef = useRef(null);

  const handleOpenAIApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setOpenAIApiKey(e.target.value);
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setFileName(selectedFile.name);
      parseCSV(selectedFile);
    }
  };

  const parseCSV = (file) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setColumns(results.meta.fields);
        setCsvData(results.data);
        setTranslatedData([]);
        setProgress(0);
        setLastResponseId(null);
      },
      error: (error) => {
        setError(`Error parsing CSV: ${error.message}`);
      },
    });
  };

  const translateCSV = async () => {
    if (csvData.length === 0) {
      setError("Please upload a CSV file first.");
      return;
    }

    setIsTranslating(true);
    setError(null);

    // Start from where we left off or from the beginning
    const startIndex = translatedData.length;

    try {
      // Process in chunks to handle API limits
      const CHUNK_SIZE = 20; // Adjust based on token limits

      for (let i = startIndex; i < csvData.length; i += CHUNK_SIZE) {
        const chunk = csvData.slice(i, i + CHUNK_SIZE);

        // Prepare the chunk for translation
        const chunkForTranslation = JSON.stringify(chunk);

        // Create the API request
        const response = await fetch("/api/translator", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: chunkForTranslation,
            columns: columns,
            sourceLanguage,
            targetLanguage,
            previousResponseId: lastResponseId,
            totalRows: csvData.length,
            currentIndex: i,
            apikey: openaiApiKey,
            initialPrompt: showPrompts ? initialPrompt : undefined,
            refinementPrompt: enableRefinement ? refinementPrompt : undefined,
            model,
            temperature,
            operationMode,
          }),
        });

        if (!response.ok) {
          throw new Error(`API request failed: ${response.statusText}`);
        }

        const result = await response.json();

        // Update columns based on operation mode
        if (operationMode === "translate" && enableRefinement) {
          setColumns((prev) => [...prev, "Refined"]);
        }

        // Update state with the processed chunk
        setTranslatedData((prev) => [...prev, ...result.translatedData]);
        setLastResponseId(result.responseId);
        setProgress(
          Math.min(
            100,
            Math.round(
              ((i + result.translatedData.length) / csvData.length) * 100,
            ),
          ),
        );

        // If we're at the end, we're done
        if (i + CHUNK_SIZE >= csvData.length) {
          setIsTranslating(false);
        }
      }
    } catch (err) {
      setError(`Processing error: ${err.message}`);
      setIsTranslating(false);
    }
  };

  const downloadTranslatedCSV = () => {
    if (translatedData.length === 0) {
      setError("No translated data to download.");
      return;
    }

    const csv = Papa.unparse(translatedData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `translated_${fileName}`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold mb-8 text-center">CSV Translator</h1>

        <div className="mb-4">
          <label
            htmlFor="openaiApiKey"
            className="mb-1 block text-sm font-medium"
          >
            OpenAI API Key
          </label>
          <input
            type="text"
            id="openaiApiKey"
            value={openaiApiKey}
            onChange={handleOpenAIApiKeyChange}
            className="block w-full rounded border border-gray-300 p-2 text-sm"
            placeholder="OpenAI API Key"
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            Your OpenAI Api Key. Necessary to make use of this application.
          </p>
        </div>

        <div className="mb-4 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={operationMode === "translate"}
                onChange={() => setOperationMode("translate")}
                className="h-4 w-4"
              />
              Translate
            </label>
          </div>

          {operationMode === "translate" && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="showPrompts"
                  checked={showPrompts}
                  onChange={(e) => {
                    setShowPrompts(e.target.checked);
                    if (!e.target.checked) {
                      setEnableRefinement(false);
                    }
                  }}
                  className="h-4 w-4"
                />
                <label htmlFor="showPrompts">Show Prompts</label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enableRefinement"
                  checked={enableRefinement}
                  onChange={(e) => setEnableRefinement(e.target.checked)}
                  disabled={!showPrompts}
                  className={`h-4 w-4 ${!showPrompts ? "opacity-50 cursor-not-allowed" : ""}`}
                />
                <label
                  htmlFor="enableRefinement"
                  className={!showPrompts ? "opacity-50" : ""}
                >
                  Enable Refinement
                </label>
              </div>
            </>
          )}
        </div>

        {operationMode === "translate" && showPrompts && (
          <>
            <div className="mb-8">
              <label className="mb-1 block text-sm font-medium">
                Initial Translation Prompt
              </label>
              <textarea
                value={initialPrompt}
                onChange={(e) => setInitialPrompt(e.target.value)}
                className="block w-full rounded border border-gray-300 p-2 text-sm h-24 font-mono"
                placeholder="Enter the initial translation prompt"
              />
              <p className="mt-1 text-xs text-gray-500">
                This prompt guides the initial translation of the text.
              </p>
            </div>

            {enableRefinement && (
              <div className="mb-8">
                <label className="mb-1 block text-sm font-medium">
                  Refinement Prompt
                </label>
                <textarea
                  value={refinementPrompt}
                  onChange={(e) => setRefinementPrompt(e.target.value)}
                  className="block w-full rounded border border-gray-300 p-2 text-sm h-24 font-mono"
                  placeholder="Enter the refinement prompt"
                />
                <p className="mt-1 text-xs text-gray-500">
                  This prompt guides the refinement of the translation.
                </p>
              </div>
            )}
          </>
        )}

        <div className="mb-8">
          <div className="flex items-center justify-center mb-4">
            <button
              onClick={() => fileInputRef.current.click()}
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            >
              Select CSV File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
          {fileName && <p className="text-center">Selected file: {fileName}</p>}
        </div>

        <div className="mb-8 flex justify-center space-x-4">
          <div>
            <label className="block mb-2">Source Language:</label>
            <select
              value={sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value)}
              className="border p-2 rounded bg-gray-200 text-gray-500/50 w-36"
              disabled
            >
              <option value="auto">Auto-detect</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese</option>
              <option value="ru">Russian</option>
            </select>
          </div>
          <div>
            <label className="block mb-2">Target Language:</label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="border p-2 rounded bg-gray-200 text-gray-500/50 w-36"
              disabled
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese</option>
              <option value="ru">Russian</option>
            </select>
          </div>
        </div>

        <div className="mb-8 flex justify-center space-x-4">
          <div>
            <label className="block mb-2">Model:</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="border p-2 rounded w-48"
              disabled={isTranslating}
            >
              <option value="gpt-4.1-2025-04-14">
                GPT-4.1 Flagship GPT model for complex tasks
              </option>
              <option value="chatgpt-4o-latest">
                ChatGPT-4o - Model used in ChatGPT (Most Capable & Most Expensive)
              </option>
              <option value="gpt-4o-2024-11-20">GPT-4o (Baseline)</option>
              <option value="gpt-4o-mini-2024-07-18">
                GPT-4o-mini (Fast and affordable)
              </option>

            </select>
          </div>
          <div>
            <label className="block mb-2">Temperature:</label>
            <div className="flex items-center space-x-2">
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-32"
                disabled={isTranslating}
              />
              <span className="w-12 text-center">{temperature}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              0 = More precise, 2 = More creative
            </p>
          </div>
        </div>

        <div className="mb-8 flex justify-center">
          <button
            onClick={translateCSV}
            className={`bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded ${isTranslating ? "opacity-50 cursor-not-allowed" : ""
              }`}
            disabled={isTranslating || csvData.length === 0}
          >
            {isTranslating
              ? "Translating..."
              : translatedData.length > 0
                ? "Continue Translation"
                : "Start Translation"}
          </button>
        </div>

        {error && <div className="mb-8 text-red-500 text-center">{error}</div>}

        {csvData.length > 0 && (
          <div className="mb-8">
            <div className="mb-4">
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <p className="text-center mt-2">
                {progress}% complete ({translatedData.length} of{" "}
                {csvData.length} rows)
              </p>
            </div>
          </div>
        )}

        {translatedData.length > 0 && (
          <div className="mb-8 flex justify-center">
            <button
              onClick={downloadTranslatedCSV}
              className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded"
            >
              Download Translated CSV
            </button>
          </div>
        )}

        {csvData.length > 0 && (
          <div className="overflow-x-auto">
            <h2 className="text-xl font-bold mb-4">Preview</h2>
            <table className="min-w-full bg-white border">
              <thead>
                <tr>
                  {columns.map((column, index) => (
                    <th key={index} className="border px-4 py-2">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(translatedData.length > 0 ? translatedData : csvData)
                  //.slice(0, 5)
                  .map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {columns.map((column, colIndex) => (
                        <td key={colIndex} className="border px-4 py-2">
                          {row[column]}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
            {csvData.length > 0 && (
              <p className="text-center mt-2">{csvData.length} total rows</p>
            )}
            {/* {csvData.length > 5 && (
              <p className="text-center mt-2">
                Showing first 5 rows of {csvData.length} total rows
              </p>
            )} */}
          </div>
        )}
      </div>
    </main>
  );
}
