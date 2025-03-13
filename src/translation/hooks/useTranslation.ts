import { useState } from "react";

interface TranslationStats {
  total_rows: number;
  translated_rows: number;
  refined_rows: number;
}

interface TranslationResponse {
  success: boolean;
  data?: string;
  stats?: TranslationStats;
  error?: string;
}

export function useTranslation() {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [translationStats, setTranslationStats] =
    useState<TranslationStats | null>(null);
  const [translatedCsvData, setTranslatedCsvData] = useState<string | null>(
    null,
  );

  const translateFile = async (
    file: File,
    openaiApiKey: string,
    assistantId?: string,
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("openaiApiKey", openaiApiKey);
      if (assistantId) {
        formData.append("assistantId", assistantId);
      }

      const response = await fetch("/api/translate", {
        method: "POST",
        body: formData,
      });

      const result: TranslationResponse = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to translate file");
      }

      if (result.success && result.data) {
        setTranslatedCsvData(result.data);
        if (result.stats) {
          setTranslationStats(result.stats);
        }
      } else {
        throw new Error(result.error || "Translation failed");
      }
    } catch (err) {
      setError(err.message || "An error occurred during translation");
    } finally {
      setIsLoading(false);
    }
  };

  const downloadTranslatedFile = () => {
    if (!translatedCsvData) return;

    const blob = new Blob([translatedCsvData], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `translated_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return {
    translateFile,
    downloadTranslatedFile,
    isLoading,
    error,
    translationStats,
    translatedCsvData,
  };
}
