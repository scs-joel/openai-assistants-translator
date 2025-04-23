"use client";

import Papa from "papaparse";
import React, { useEffect, useRef, useState } from "react"; // Import useEffect

import { cn } from "@/utils";

export default function Translator() {
  const [openaiApiKey, setOpenAIApiKey] = useState<string>("");

  const [file, setFile] = useState<File | null>(null); // Type the file state
  const [fileName, setFileName] = useState<string>("");
  const [csvData, setCsvData] = useState<any[]>([]); // Use any[] for flexibility initially
  const [initialColumns, setInitialColumns] = useState<string[]>([]); // Store original columns
  const [processedColumns, setProcessedColumns] = useState<string[]>([]); // Store columns after processing (incl. Errors/Markers)
  const [processedData, setProcessedData] = useState<any[]>([]); // Renamed from translatedData
  const [sourceLanguage, setSourceLanguage] = useState("ja");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [isProcessing, setIsProcessing] = useState(false); // Renamed from isTranslating
  const [progress, setProgress] = useState(0);
  const [lastResponseId, setLastResponseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState("gpt-4o"); // Changed default
  const [temperature, setTemperature] = useState(0.5);
  const [showPrompts, setShowPrompts] = useState(false);
  const [enableRefinement, setEnableRefinement] = useState(false);
  const [enableSpellCheck, setEnableSpellCheck] = useState(false);
  const [spellCheckColumn, setSpellCheckColumn] = useState<string>(""); // State for column to check
  const [operationMode, setOperationMode] = useState<
    "translate" | "spellcheck"
  >("translate");
  const [initialPrompt, setInitialPrompt] = useState(
    `Translate the following Japanese text to English.
Make the English translation sound natural while keeping the overall context in mind.
When translating, consider the character's personality and background when available.`,
  );
  const [refinementPrompt, setRefinementPrompt] = useState(
    `Refine the following English translation to make it sound more natural and engaging, keeping the overall context and character voice in mind. Only output the refined text.`, // Adjusted refinement prompt
  );

  const fileInputRef = useRef<HTMLInputElement>(null); // Type the ref

  // Determine available columns for spell check dropdown
  const availableColumnsForSpellCheck = processedColumns.length > 0 ? processedColumns : initialColumns;

  // Effect to reset spellCheckColumn if it becomes invalid
  useEffect(() => {
    if (spellCheckColumn && !availableColumnsForSpellCheck.includes(spellCheckColumn)) {
      setSpellCheckColumn(""); // Reset if the column disappears (e.g., new file upload)
    }
    // Ensure a default is selected if possible and needed
    if (!spellCheckColumn && availableColumnsForSpellCheck.length > 0) {
      // Optionally set a default, e.g., the last column or a specific one like 'Refined' if it exists
      const defaultCandidate = availableColumnsForSpellCheck.includes("Refined") ? "Refined" : availableColumnsForSpellCheck.at(-1);
      if (defaultCandidate) {
        setSpellCheckColumn(defaultCandidate)
      }
    }
  }, [availableColumnsForSpellCheck, spellCheckColumn]);


  // Effect to update processedColumns when initialColumns changes (new file)
  useEffect(() => {
    setProcessedColumns(initialColumns);
    setSpellCheckColumn(""); // Reset spell check column on new file
  }, [initialColumns]);

  const handleOpenAIApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setOpenAIApiKey(e.target.value);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]; // Use optional chaining
    if (selectedFile) {
      setFile(selectedFile);
      setFileName(selectedFile.name);
      parseCSV(selectedFile);
    }
  };

  const parseCSV = (fileToParse: File) => { // Type the parameter
    Papa.parse(fileToParse, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const columns = results.meta.fields || []; // Ensure columns is an array
        setInitialColumns(columns);
        setProcessedColumns(columns); // Initialize processed columns
        setCsvData(results.data as any[]); // Type assertion
        setProcessedData([]);
        setProgress(0);
        setLastResponseId(null);
        setError(null); // Clear previous errors
        // Reset spell check column, let useEffect handle default
        setSpellCheckColumn("");
      },
      error: (error: any) => { // Type the error
        console.error("CSV Parsing Error:", error);
        setError(`Error parsing CSV: ${error.message}`);
        // Clear states on error
        setInitialColumns([]);
        setProcessedColumns([]);
        setCsvData([]);
        setProcessedData([]);
        setFileName("");
        setFile(null);
      },
    });
  };

  const processCSV = async () => { // Renamed from translateCSV
    if (csvData.length === 0) {
      setError("Please upload a CSV file first.");
      return;
    }
    if (!openaiApiKey) {
      setError("Please enter your OpenAI API Key.");
      return;
    }
    if ((enableSpellCheck || operationMode === 'spellcheck') && !spellCheckColumn) {
      setError("Please select a column to perform spell check on.");
      return;
    }

    setIsProcessing(true);
    setError(null);

    // Start from where we left off or from the beginning
    const startIndex = processedData.length;

    try {
      const CHUNK_SIZE = 10; // Smaller chunk size might be safer for complex operations

      for (let i = startIndex; i < csvData.length; i += CHUNK_SIZE) {
        const chunk = csvData.slice(i, i + CHUNK_SIZE);

        // Use the latest set of columns for the request
        // This ensures if 'Refined' was added in a previous chunk, it's known
        const columnsForRequest = processedColumns.length > startIndex ? processedColumns : initialColumns;

        const response = await fetch("/api/translator", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: JSON.stringify(chunk), // Send only the current chunk
            columns: columnsForRequest, // Send the current known columns
            sourceLanguage,
            targetLanguage,
            previousResponseId: lastResponseId,
            totalRows: csvData.length,
            currentIndex: i,
            apikey: openaiApiKey,
            initialPrompt: (operationMode === 'translate' && showPrompts) ? initialPrompt : undefined,
            refinementPrompt: (operationMode === 'translate' && showPrompts && enableRefinement) ? refinementPrompt : undefined,
            model,
            temperature,
            operationMode,
            enableSpellCheck: enableSpellCheck || operationMode === 'spellcheck', // Spell check is always enabled in spellcheck mode
            spellCheckColumn: (enableSpellCheck || operationMode === 'spellcheck') ? spellCheckColumn : undefined,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`API request failed: ${response.statusText} - ${errorData.message || 'Unknown error'}`);
        }

        const result = await response.json();

        // --- CRITICAL: Update columns state based on the backend response ---
        if (result.finalColumns && result.finalColumns.length > processedColumns.length) {
          setProcessedColumns(result.finalColumns);
          // If spellCheckColumn was just created (e.g. "Refined"), update state if necessary
          if (result.finalColumns.includes(spellCheckColumn) && spellCheckColumn && !availableColumnsForSpellCheck.includes(spellCheckColumn)) {
            // No need to explicitly set here, useEffect will handle it if needed.
          }
        }

        // Append new data
        setProcessedData((prev) => [...prev, ...result.processedData]);
        setLastResponseId(result.responseId);
        setProgress(
          Math.min(
            100,
            Math.round(((i + result.processedData.length) / csvData.length) * 100)
          )
        );

        // If we're at the end, processing is complete for this run
        if (i + CHUNK_SIZE >= csvData.length) {
          setIsProcessing(false);
          // Keep lastResponseId in case user wants to refine/check *again* later? Or clear it?
          // setLastResponseId(null); // Option: Clear ID once fully processed
        }
      }
      // If loop finishes because startIndex >= csvData.length
      if (startIndex >= csvData.length && csvData.length > 0) {
        setIsProcessing(false);
        console.log("All rows already processed.");
      }

    } catch (err: any) { // Type the error
      console.error("Processing Error:", err);
      setError(`Processing error: ${err.message}`);
      setIsProcessing(false);
    }
  };

  const downloadProcessedCSV = () => { // Renamed
    if (processedData.length === 0) {
      setError("No processed data to download.");
      return;
    }

    // Use the final set of columns for unparsing
    const csv = Papa.unparse({
      fields: processedColumns,
      data: processedData
    });
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" }); // Add BOM for Excel UTF-8 compatibility
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${operationMode}_${fileName}`); // Modify filename based on mode
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Determine Button Text
  const getButtonText = () => {
    if (isProcessing) return "Processing...";
    const baseText = operationMode === 'translate' ? 'Translate' : 'Spell Check';
    if (processedData.length > 0 && processedData.length < csvData.length) return `Continue ${baseText}`;
    if (processedData.length === csvData.length && csvData.length > 0) return `Reprocess ${baseText}`; // Or maybe 'Process Again'
    return `Start ${baseText}`;
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-6 md:p-12 lg:p-24"> {/* Added padding adjustments */}
      <div className="z-10 w-full max-w-6xl items-center justify-between font-mono text-sm"> {/* Increased max-width */}
        <h1 className="text-3xl md:text-4xl font-bold mb-8 text-center">
          CSV {operationMode === 'translate' ? 'Translator & Checker' : 'Spell Checker'}
        </h1>

        {/* API Key Input */}
        <div className="mb-4">
          <label
            htmlFor="openaiApiKey"
            className="mb-1 block text-sm font-medium"
          >
            OpenAI API Key <span className="text-red-500">*</span>
          </label>
          <input
            type="password" // Use password type for keys
            id="openaiApiKey"
            value={openaiApiKey}
            onChange={handleOpenAIApiKeyChange}
            className="block w-full rounded border border-gray-300 p-2 text-sm shadow-sm" // Added shadow
            placeholder="sk-..."
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            Required to use the OpenAI API. Your key is not stored.
          </p>
        </div>

        {/* Operation Mode Selection */}
        <div className="mb-4 rounded border border-gray-200 p-4">
          <label className="mb-2 block text-sm font-medium">Operation Mode</label>
          <div className="flex flex-col sm:flex-row gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={operationMode === "translate"}
                onChange={() => setOperationMode("translate")}
                className="h-4 w-4"
              />
              Translate (+ Optional Checks)
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={operationMode === "spellcheck"}
                onChange={() => {
                  setOperationMode("spellcheck");
                  setEnableSpellCheck(true); // Automatically enable check flag
                  setEnableRefinement(false); // Disable refinement in this mode
                  setShowPrompts(false); // Hide prompts in this mode
                }}
                className="h-4 w-4"
              />
              Spell Check Only
            </label>
          </div>
        </div>

        {/* Translation Options (only show if mode is 'translate') */}
        {operationMode === "translate" && (
          <div className="mb-4 rounded border border-gray-200 p-4 space-y-4">
            <h3 className="text-md font-semibold mb-2">Translation Options</h3>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="showPrompts"
                checked={showPrompts}
                onChange={(e) => {
                  setShowPrompts(e.target.checked);
                  if (!e.target.checked) {
                    setEnableRefinement(false); // Disable refinement if prompts are hidden
                  }
                }}
                className="h-4 w-4 rounded"
              />
              <label htmlFor="showPrompts" className="cursor-pointer">Show & Customize Prompts</label>
            </div>

            {showPrompts && (
              <>
                <div className="pl-6"> {/* Indent prompt textareas */}
                  <label className="mb-1 block text-sm font-medium">
                    Initial Translation Prompt
                  </label>
                  <textarea
                    value={initialPrompt}
                    onChange={(e) => setInitialPrompt(e.target.value)}
                    className="block w-full rounded border border-gray-300 p-2 text-sm h-24 font-mono shadow-sm"
                    placeholder="Enter the initial translation prompt"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Guides the initial translation. Use {$`$\{sourceLanguage\}`} and {$`$\{targetLanguage\}`}.
                  </p>
                </div>

                <div className="flex items-center gap-2 pl-6"> {/* Indent refinement checkbox */}
                  <input
                    type="checkbox"
                    id="enableRefinement"
                    checked={enableRefinement}
                    onChange={(e) => setEnableRefinement(e.target.checked)}
                    disabled={!showPrompts} // Already handled by parent conditional, but good practice
                    className={`h-4 w-4 rounded ${!showPrompts ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  />
                  <label
                    htmlFor="enableRefinement"
                    className={cn(!showPrompts ? "opacity-50" : "", "cursor-pointer")}
                  >
                    Enable Refinement Step
                  </label>
                </div>

                {enableRefinement && (
                  <div className="pl-12"> {/* Further indent refinement prompt */}
                    <label className="mb-1 block text-sm font-medium">
                      Refinement Prompt
                    </label>
                    <textarea
                      value={refinementPrompt}
                      onChange={(e) => setRefinementPrompt(e.target.value)}
                      className="block w-full rounded border border-gray-300 p-2 text-sm h-24 font-mono shadow-sm"
                      placeholder="Enter the refinement prompt"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Guides the second pass refinement. Applied to the output of the initial translation.
                    </p>
                  </div>
                )}
              </>
            )}
            {/* Language selection - kept disabled as per original */}
            <div className="flex flex-col sm:flex-row justify-start gap-4 pt-4 border-t border-gray-100">
              <div>
                <label className="block mb-1 text-sm font-medium">Source Language:</label>
                <select
                  value={sourceLanguage}
                  // onChange={(e) => setSourceLanguage(e.target.value)} // Keep disabled
                  className="border p-2 rounded bg-gray-100 text-gray-500 w-36 shadow-sm cursor-not-allowed"
                  disabled
                >
                  {/* <option value="auto">Auto-detect</option> */}
                  <option value="ja">Japanese</option>
                  {/* Add other options if needed */}
                </select>
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium">Target Language:</label>
                <select
                  value={targetLanguage}
                  // onChange={(e) => setTargetLanguage(e.target.value)} // Keep disabled
                  className="border p-2 rounded bg-gray-100 text-gray-500 w-36 shadow-sm cursor-not-allowed"
                  disabled
                >
                  <option value="en">English</option>
                  {/* Add other options if needed */}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Spell Check Options (Show always, but content depends on mode) */}
        <div className="mb-4 rounded border border-gray-200 p-4 space-y-4">
          <h3 className="text-md font-semibold mb-2">Spell & Grammar Check Options</h3>
          {operationMode === 'translate' && ( // Checkbox only needed in translate mode
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enableSpellCheck"
                checked={enableSpellCheck}
                onChange={(e) => setEnableSpellCheck(e.target.checked)}
                className="h-4 w-4 rounded cursor-pointer"
              />
              <label htmlFor="enableSpellCheck" className="cursor-pointer">Enable Spell/Grammar Check</label>
            </div>
          )}

          {(enableSpellCheck || operationMode === 'spellcheck') && (
            <div className="pl-6"> {/* Indent dropdown */}
              <label htmlFor="spellCheckColumn" className="block mb-1 text-sm font-medium">
                Column to Check <span className="text-red-500">*</span>
              </label>
              <select
                id="spellCheckColumn"
                value={spellCheckColumn}
                onChange={(e) => setSpellCheckColumn(e.target.value)}
                className={cn(
                  "border p-2 rounded w-full sm:w-64 shadow-sm",
                  availableColumnsForSpellCheck.length === 0 && "opacity-50 cursor-not-allowed"
                )}
                disabled={availableColumnsForSpellCheck.length === 0 || isProcessing}
              >
                <option value="" disabled>-- Select Column --</option>
                {availableColumnsForSpellCheck
                  .filter(col => col !== 'Errors' && !col.endsWith('_Marker')) // Exclude helper columns
                  .map((col) => (
                    <option key={col} value={col}>{col}</option>
                  ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Select the column containing the text you want to check. An 'Errors' column and marker columns (*) will be added.
              </p>
              {availableColumnsForSpellCheck.length === 0 && file && (
                <p className="mt-1 text-xs text-orange-500">
                  Waiting for columns to be parsed from the CSV file.
                </p>
              )}
              {availableColumnsForSpellCheck.length === 0 && !file && (
                <p className="mt-1 text-xs text-orange-500">
                  Upload a CSV file to see available columns.
                </p>
              )}
            </div>
          )}
        </div>


        {/* Model and Temperature */}
        <div className="mb-8 flex flex-col sm:flex-row justify-center gap-4 sm:gap-8">
          <div>
            <label className="block mb-1 text-sm font-medium">Model:</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="border p-2 rounded w-full sm:w-64 shadow-sm" // Adjusted width
              disabled={isProcessing}
            >
              <option value="gpt-4o">GPT-4o (Recommended)</option>
              <option value="gpt-4o-mini">GPT-4o Mini (Faster, Cheaper)</option>
              {/* <option value="gpt-4-turbo">GPT-4 Turbo</option> */}
              {/* Add other models if needed */}
            </select>
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium">Temperature:</label>
            <div className="flex items-center space-x-2">
              <input
                type="range"
                min="0"
                max="1.5" // Max 1.5 is often sufficient
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-32 cursor-pointer"
                disabled={isProcessing}
              />
              <span className="w-12 text-center text-sm font-medium">{temperature.toFixed(1)}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Lower = More deterministic, Higher = More creative/varied.
            </p>
          </div>
        </div>

        {/* File Input */}
        <div className="mb-8 flex flex-col items-center gap-4">
          <button
            onClick={() => fileInputRef.current?.click()} // Use optional chaining
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded shadow transition duration-150 ease-in-out"
          >
            {fileName ? "Change CSV File" : "Select CSV File"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
          {fileName && <p className="text-center text-sm text-gray-600">Selected: {fileName}</p>}
          {!file && <p className="text-center text-sm text-gray-500">Upload a CSV file to begin.</p>}
        </div>


        {/* Action Button */}
        <div className="mb-8 flex justify-center">
          <button
            onClick={processCSV} // Use renamed function
            className={cn(
              "text-white font-bold py-2 px-6 rounded shadow transition duration-150 ease-in-out",
              isProcessing ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700",
              (!file || !openaiApiKey || ((enableSpellCheck || operationMode === 'spellcheck') && !spellCheckColumn)) && !isProcessing && "opacity-50 cursor-not-allowed" // Disable if file or API key missing, or spell check configured incorrectly
            )}
            disabled={isProcessing || !file || !openaiApiKey || ((enableSpellCheck || operationMode === 'spellcheck') && !spellCheckColumn)}
          >
            {getButtonText()}
          </button>
        </div>

        {/* Error Display */}
        {error && <div className="mb-8 text-red-600 bg-red-100 border border-red-400 p-3 rounded text-center text-sm">{error}</div>}

        {/* Progress Bar */}
        {csvData.length > 0 && (
          <div className="mb-8">
            <div className="mb-2">
              <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <p className="text-center text-sm mt-2 text-gray-600">
                {progress}% complete ({processedData.length} of{" "}
                {csvData.length} rows processed)
              </p>
            </div>
          </div>
        )}

        {/* Download Button */}
        {processedData.length > 0 && (
          <div className="mb-8 flex justify-center">
            <button
              onClick={downloadProcessedCSV} // Use renamed function
              className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-6 rounded shadow transition duration-150 ease-in-out"
            >
              Download Processed CSV
            </button>
          </div>
        )}

        {/* Preview Table */}
        {(csvData.length > 0 || processedData.length > 0) && ( // Show preview if either original or processed data exists
          <div className="overflow-x-auto shadow-md rounded-lg border border-gray-200">
            <h2 className="text-xl font-semibold mb-4 p-4 bg-gray-50 border-b">Preview</h2>
            <table className="min-w-full bg-white text-sm">
              <thead className="bg-gray-100">
                <tr>
                  {/* Use processedColumns for the header */}
                  {processedColumns.map((column, index) => (
                    <th key={`${column}-${index}`} className="border-b border-gray-200 px-4 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                      {column.replace('_Marker', ' *')} {/* Make marker column headers cleaner */}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Show processed data if available, otherwise initial CSV data */}
                {(processedData.length > 0 ? processedData : csvData)
                  // Consider limiting rows shown for performance in preview, e.g. .slice(0, 100)
                  .map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-gray-50 border-b border-gray-100 last:border-b-0">
                      {/* Iterate through processedColumns to ensure all columns are rendered */}
                      {processedColumns.map((column, colIndex) => (
                        <td key={`${column}-${colIndex}-${rowIndex}`} className="border-r border-gray-100 last:border-r-0 px-4 py-2 whitespace-pre-wrap break-words max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg" // Allow wrapping, set max width
                          style={{ backgroundColor: column.endsWith('_Marker') && row[column] === '*' ? 'yellow' : 'transparent' }} // Highlight marker cells
                        >
                          {/* Display content, handle potential undefined values */}
                          {row[column] !== null && row[column] !== undefined ? String(row[column]) : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
            {(processedData.length > 0 ? processedData : csvData).length > 0 && (
              <p className="text-center text-sm text-gray-500 p-3 bg-gray-50 border-t">
                Total rows in {processedData.length > 0 ? 'processed data' : 'uploaded file'}: {(processedData.length > 0 ? processedData : csvData).length}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}