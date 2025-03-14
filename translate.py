import pandas as pd
import time
import sys
import os
import json
import argparse
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential


def get_config():
    """Get configuration from environment variables or config file"""
    config = {
        'api_key': os.getenv('OPENAI_API_KEY'),
        'system_prompt': None,
        'refinement_prompt': None,
        'model': "gpt-4o-mini",  # Default model
        'context_size': 30  # Default number of lines to include in context
    }

    config_file = 'config.json'
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r') as f:
                file_config = json.load(f)
                # Update config with file values if they exist
                for key in ['api_key', 'system_prompt', 'refinement_prompt', 'model', 'context_size']:
                    if key in file_config:
                        config[key] = file_config[key]
        except Exception as e:
            print(f"Warning: Error reading config file: {e}")

    if not config['api_key']:
        print("Error: OpenAI API key not found. Please set OPENAI_API_KEY environment variable or create a config.json file.")
        sys.exit(1)

    # Set default system prompt if none provided
    if not config['system_prompt']:
        config['system_prompt'] = (
            "You are translating Japanese game dialog into natural, conversational English. "
            "Your goal is to capture the authentic voice of each character while preserving the original meaning, emotion, and cultural context. "
            "When characters express hesitation (...), emphasis, or strong emotions, reflect these elements faithfully in your English version. "
            "Focus on how English speakers would naturally express the same ideas rather than making literal translations. "
            "Output only the translated lines with no explanations, formatting each line with [Line N] exactly as in the input. "
        )

    # Set default refinement prompt if none provided
    if not config['refinement_prompt']:
        config['refinement_prompt'] = (
            "You are refining English translations of Japanese game dialog. "
            "With both the original Japanese text and initial English translation provided, your task is to enhance the naturalness and flow while maintaining character voice and emotional tone. "
            "Consider the broader context of the conversation and relationships between characters. "
            "Prioritize creating dialog that sounds authentic to English speakers while preserving the intended meaning and character personalities. "
            "Avoid overly formal phrasing unless it matches the character's speaking style. "
            "Output only the refined translations without explanations, formatting each line with [Line N] as in the input. "
        )

    return config


# Initialize configuration and OpenAI client
config = get_config()
client = OpenAI(api_key=config['api_key'])

# Constants
MAX_RETRIES = 5
BACKOFF_MULTIPLIER = 1
SAVE_EVERY = 10  # Save progress after this many successful entries


@retry(stop=stop_after_attempt(MAX_RETRIES), wait=wait_exponential(multiplier=BACKOFF_MULTIPLIER))
def translate_dialog_batch(dialog_entry, source_lang="ja", target_lang="en"):
    """
    Specialized function for translating game dialog.
    Handles a single dialog entry in one API call.

    Args:
        dialog_entry: Entry to translate
        source_lang: Source language code
        target_lang: Target language code
    """
    if not dialog_entry or not dialog_entry.get('text'):
        return {"translation": ""}

    # Format with character name for better context
    formatted_input = ""

    char_name = dialog_entry.get('character', '')
    text = dialog_entry.get('text', '')

    if not text or pd.isna(text):
        return {"translation": ""}

    # Include character name if available for context
    if char_name and not pd.isna(char_name):
        formatted_input = f"{char_name}: {text}"
    else:
        formatted_input = text

    try:
        response = client.chat.completions.create(
            model=config['model'],
            messages=[
                {"role": "system", "content": config['system_prompt']},
                {"role": "user", "content": formatted_input}
            ],
            temperature=0.7  # Lower temperature for more consistent translations
        )

        translated_content = response.choices[0].message.content.strip()
        return {"translation": translated_content}

    except Exception as e:
        print(f"\nError in translation: {e}")
        raise


@retry(stop=stop_after_attempt(MAX_RETRIES), wait=wait_exponential(multiplier=BACKOFF_MULTIPLIER))
def translate_dialog_context(dialog_entries, source_lang="ja", target_lang="en", is_refinement=False, initial_translations=None, source_texts=None):
    """
    Specialized function for translating game dialog with context.
    Handles multiple dialog entries in one API call to maintain context.

    Args:
        dialog_entries: List of entries to translate
        source_lang: Source language code
        target_lang: Target language code
        is_refinement: Whether this is a refinement step
        initial_translations: Initial translations to refine (only used if is_refinement=True)
        source_texts: Original source texts (used for refinement context)
    """
    if not dialog_entries:
        return []

    # Format with line numbers and character names for better context
    formatted_input = "# DIALOG TO TRANSLATE:\n\n" if not is_refinement else "# TRANSLATIONS TO REFINE:\n\n"

    for i, entry in enumerate(dialog_entries):
        char_name = entry.get('character', '')

        if is_refinement and initial_translations and source_texts:
            # Include both original Japanese and initial translation for refinement
            source_text = source_texts[i]
            initial_translation = initial_translations[i].get(
                'translation', '')

            if char_name and not pd.isna(char_name):
                formatted_input += f"[Line {i+1}] {char_name}:\n"
                formatted_input += f"Japanese: {source_text}\n"
                formatted_input += f"Initial Translation: {initial_translation}\n\n"
            else:
                formatted_input += f"[Line {i+1}]:\n"
                formatted_input += f"Japanese: {source_text}\n"
                formatted_input += f"Initial Translation: {initial_translation}\n\n"
        else:
            # Use the original text for initial translation
            text = entry.get('text', '')

            if not text or pd.isna(text):
                continue

            # Include character name if available for context
            if char_name and not pd.isna(char_name):
                formatted_input += f"[Line {i+1}] {char_name}: {text}\n\n"
            else:
                formatted_input += f"[Line {i+1}]: {text}\n\n"

    if formatted_input == "# DIALOG TO TRANSLATE:\n\n" or formatted_input == "# TRANSLATIONS TO REFINE:\n\n":
        return [{"translation": ""} for _ in dialog_entries]

    try:
        # Choose the appropriate system prompt based on whether this is refinement or initial translation
        system_prompt = config['refinement_prompt'] if is_refinement else config['system_prompt']

        response = client.chat.completions.create(
            model=config['model'],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": formatted_input}
            ],
            temperature=0.7  # Lower temperature for more consistent translations
        )

        translated_content = response.choices[0].message.content.strip()

        # Parse the response
        translations = []
        current_lines = translated_content.split("[Line ")

        # Process each translated line
        for i in range(len(dialog_entries)):
            found_translation = ""
            line_number = i + 1  # 1-based index

            # Look for the matching line number in the translations
            for line in current_lines:
                if line.startswith(f"{line_number}]"):
                    # Extract everything after the ]: part
                    parts = line.split("]: ", 1)
                    if len(parts) > 1:
                        found_translation = parts[1].strip()
                    elif ":" in line:  # Try another format where character name might be included
                        parts = line.split(":", 1)
                        if len(parts) > 1:
                            found_translation = parts[1].strip()
                    break

            translations.append({"translation": found_translation})

        return translations

    except Exception as e:
        print(
            f"\nError in {'refinement' if is_refinement else 'context translation'}: {e}")
        raise


def translate_csv_file(input_file, output_file=None, source_col="Japanese", target_col="English", max_rows=None,
                       refined_col="Refined", context_size=None, two_step=True, start_row=0):
    """
    Translates a CSV file containing game dialog with context.
    Args:
        input_file: Path to input CSV file
        output_file: Path to output CSV file (optional)
        source_col: Source column name or index
        target_col: Target column name for translation
        max_rows: Maximum number of rows to translate (optional)
        refined_col: Target column name for refined translation
        context_size: Number of entries to process in one context (optional)
        two_step: Whether to use the two-step translation approach
        start_row: Row to start from (for resuming partial jobs)
    """
    start_time = time.time()

    # Load the CSV
    try:
        df = pd.read_csv(input_file)
        print(f"Loaded {len(df)} rows from {input_file}")
    except Exception as e:
        print(f"Error reading CSV file: {e}")
        return False

    # Apply row limit if specified
    original_row_count = len(df)
    if max_rows is not None and max_rows > 0:
        if start_row + max_rows <= original_row_count:
            # Create a view of the dataframe with just the rows we need
            working_df = df.iloc[start_row:start_row + max_rows].copy()
            print(f"Processing {max_rows} rows starting from row {start_row}")
        else:
            # Handle case where max_rows exceeds remaining rows
            available_rows = original_row_count - start_row
            working_df = df.iloc[start_row:].copy()
            print(
                f"Requested {max_rows} rows, but only {available_rows} rows remain starting from row {start_row}")
    else:
        working_df = df.copy()
        if start_row > 0:
            working_df = working_df.iloc[start_row:].copy()
            print(f"Processing all rows starting from row {start_row}")

    # Use default context size from config if not specified
    if context_size is None:
        context_size = config.get('context_size')
        if context_size is None:
            # Default to 5 or fewer if df is smaller
            context_size = min(5, len(working_df))
            print(f"No context size specified, using default: {context_size}")

    # Set default output file if none provided
    if not output_file:
        base, ext = os.path.splitext(input_file)
        output_file = f"{base}_translated{ext}"

    # Check for required columns
    if source_col not in working_df.columns:
        print(f"Error: Source column '{source_col}' not found in CSV")
        return False

    # Create target column if it doesn't exist
    if target_col not in working_df.columns:
        working_df[target_col] = ""

    # Create refined column if using two-step approach
    if two_step and refined_col not in working_df.columns:
        working_df[refined_col] = ""

    # Get character name column if exists (for context)
    char_col = None
    for col in working_df.columns:
        if "character" in col.lower() or "name" in col.lower():
            char_col = col
            print(f"Found character column: {char_col}")
            break

    # Checkpoint file
    checkpoint_file = f"{output_file}.partial"

    # Check if we have a partial file to resume from
    if os.path.exists(checkpoint_file):
        try:
            checkpoint_df = pd.read_csv(checkpoint_file)

            # Make sure we're only updating rows that match our current working set
            if start_row > 0 or max_rows is not None:
                checkpoint_start = start_row
                checkpoint_end = start_row + len(working_df)

                # Filter checkpoint dataframe to match our current working range
                if len(checkpoint_df) >= checkpoint_end:
                    checkpoint_subset = checkpoint_df.iloc[checkpoint_start:checkpoint_end]

                    # Copy over existing translations from checkpoint
                    for i, (_, row) in enumerate(checkpoint_subset.iterrows()):
                        if i < len(working_df):
                            if target_col in checkpoint_subset.columns and not pd.isna(row[target_col]) and row[target_col]:
                                working_df.iloc[i, working_df.columns.get_loc(
                                    target_col)] = row[target_col]
                            if two_step and refined_col in checkpoint_subset.columns and not pd.isna(row[refined_col]) and row[refined_col]:
                                working_df.iloc[i, working_df.columns.get_loc(
                                    refined_col)] = row[refined_col]
            else:
                # Simple case - no row filtering
                for idx, row in checkpoint_df.iterrows():
                    if idx < len(working_df):
                        if target_col in checkpoint_df.columns and not pd.isna(row[target_col]) and row[target_col]:
                            working_df.at[idx, target_col] = row[target_col]
                        if two_step and refined_col in checkpoint_df.columns and not pd.isna(row[refined_col]) and row[refined_col]:
                            working_df.at[idx, refined_col] = row[refined_col]

            translations_count = len(
                [x for x in working_df[target_col] if not pd.isna(x) and x])
            print(
                f"Resumed from partial file with {translations_count} translations")

            if two_step and refined_col in working_df.columns:
                refinements_count = len(
                    [x for x in working_df[refined_col] if not pd.isna(x) and x])
                print(f"Resumed with {refinements_count} refined translations")
        except Exception as e:
            print(f"Error loading checkpoint file: {e}")

    # Count entries that need translation
    total_entries = len(working_df)
    empty_translations = sum(
        1 for x in working_df[target_col] if pd.isna(x) or not x)

    if two_step:
        empty_refinements = sum(
            1 for x in working_df[refined_col] if pd.isna(x) or not x)
        print(f"Found {total_entries} entries to process, {empty_translations} need translation, {empty_refinements} need refinement")
    else:
        print(
            f"Found {total_entries} entries to process, {empty_translations} need translation")

    # Statistics
    stats = {
        "processed_entries": 0,
        "start_time": start_time,
        "successful_entries": 0,
        "failed_entries": 0,
        "context_blocks": 0,
        "successful_refinements": 0,
        "failed_refinements": 0
    }

    # STEP 1: Initial Translation - Process entire dataset in bulk
    # Instead of processing in small context blocks, we'll process all untranslated entries at once
    untranslated_entries = []
    untranslated_indices = []

    # Find all entries that need translation
    for idx in range(total_entries):
        if pd.isna(working_df.iloc[idx][target_col]) or not working_df.iloc[idx][target_col].strip():
            entry = {
                "index": idx,
                "text": working_df.iloc[idx][source_col],
                "character": working_df.iloc[idx][char_col] if char_col else ""
            }
            untranslated_entries.append(entry)
            untranslated_indices.append(idx)

    # If there are entries to translate
    if untranslated_entries:
        print(
            f"\nProcessing {len(untranslated_entries)} untranslated entries in bulk...")

        # Process in chunks of context_size to avoid exceeding API limits
        for i in range(0, len(untranslated_entries), context_size):
            chunk_entries = untranslated_entries[i:i+context_size]
            chunk_indices = untranslated_indices[i:i+context_size]

            # Calculate progress
            processed = i
            progress = (processed / len(untranslated_entries)) * \
                100 if untranslated_entries else 100

            # Display progress
            sys.stdout.write(
                f"\rBulk Translation Progress: {progress:.1f}% ({processed}/{len(untranslated_entries)})")
            sys.stdout.flush()

            try:
                # Translate the chunk
                translations = translate_dialog_context(chunk_entries)

                # Update dataframe with translations
                for idx, result in zip(chunk_indices, translations):
                    translation = result.get("translation", "")
                    if translation:
                        working_df.iloc[idx, working_df.columns.get_loc(
                            target_col)] = translation
                        stats["successful_entries"] += 1
                    else:
                        stats["failed_entries"] += 1

                stats["processed_entries"] += len(chunk_entries)
                stats["context_blocks"] += 1

                # Save progress periodically
                if stats["context_blocks"] % SAVE_EVERY == 0:
                    # For partial translation: save to original dataframe first
                    if max_rows is not None or start_row > 0:
                        for idx, row in working_df.iterrows():
                            df_idx = idx + start_row
                            if df_idx < len(df):
                                df.at[df_idx, target_col] = row[target_col]
                                if two_step and refined_col in working_df.columns:
                                    df.at[df_idx, refined_col] = row[refined_col]
                        df.to_csv(checkpoint_file, index=False)
                    else:
                        working_df.to_csv(checkpoint_file, index=False)

                    print(
                        f"\nCheckpoint saved ({processed}/{len(untranslated_entries)} entries processed)")

                # Small delay to avoid rate limits
                time.sleep(0.1)

            except Exception as e:
                print(
                    f"\nError processing bulk chunk {i}-{i+len(chunk_entries)}: {e}")
                # Save current progress
                if max_rows is not None or start_row > 0:
                    for idx, row in working_df.iterrows():
                        df_idx = idx + start_row
                        if df_idx < len(df):
                            df.at[df_idx, target_col] = row[target_col]
                            if two_step and refined_col in working_df.columns:
                                df.at[df_idx, refined_col] = row[refined_col]
                    df.to_csv(checkpoint_file, index=False)
                else:
                    working_df.to_csv(checkpoint_file, index=False)

                print(f"Progress saved to {checkpoint_file}")

                # Try to process entries one by one if context translation fails
                print("Falling back to individual translation...")
                for entry_idx, entry in enumerate(chunk_entries):
                    idx = chunk_indices[entry_idx]
                    try:
                        # Use the old single-entry translation function
                        single_result = translate_dialog_batch(entry)
                        translation = single_result.get("translation", "")

                        if translation:
                            working_df.iloc[idx, working_df.columns.get_loc(
                                target_col)] = translation
                            stats["successful_entries"] += 1
                        else:
                            stats["failed_entries"] += 1

                        # Save more frequently in recovery mode
                        if entry_idx % 5 == 0:
                            if max_rows is not None or start_row > 0:
                                for recovery_idx, row in working_df.iterrows():
                                    df_idx = recovery_idx + start_row
                                    if df_idx < len(df):
                                        df.at[df_idx, target_col] = row[target_col]
                                        if two_step and refined_col in working_df.columns:
                                            df.at[df_idx,
                                                  refined_col] = row[refined_col]
                                df.to_csv(checkpoint_file, index=False)
                            else:
                                working_df.to_csv(checkpoint_file, index=False)

                        time.sleep(0.5)  # More delay in recovery mode
                    except Exception as single_err:
                        print(
                            f"Error processing single entry {idx}: {single_err}")
                        stats["failed_entries"] += 1

    # STEP 2: Refinement (if two-step approach is enabled)
    if two_step:
        print("\n\nInitial translation complete. Starting refinement process...")

        # Count entries that need refinement
        need_refinement = sum(1 for idx in range(len(working_df))
                              if not pd.isna(working_df.iloc[idx][target_col]) and working_df.iloc[idx][target_col].strip() and
                              (pd.isna(working_df.iloc[idx][refined_col]) or not working_df.iloc[idx][refined_col].strip()))

        print(f"Found {need_refinement} entries that need refinement")

        # Reset statistics for refinement
        refinement_stats = {
            "processed_entries": 0,
            "successful_entries": 0,
            "failed_entries": 0,
            "context_blocks": 0
        }

        refinement_start_time = time.time()

        # Find all entries that need refinement
        refinement_entries = []
        refinement_indices = []
        original_source_texts = []  # Store original Japanese text for context
        initial_translations = []   # Store initial translations

        for idx in range(total_entries):
            if (not pd.isna(working_df.iloc[idx][target_col]) and working_df.iloc[idx][target_col].strip() and
                    (pd.isna(working_df.iloc[idx][refined_col]) or not working_df.iloc[idx][refined_col].strip())):
                entry = {
                    "index": idx,
                    "text": working_df.iloc[idx][target_col],
                    "character": working_df.iloc[idx][char_col] if char_col else ""
                }
                refinement_entries.append(entry)
                refinement_indices.append(idx)
                original_source_texts.append(working_df.iloc[idx][source_col])
                initial_translations.append(
                    {"translation": working_df.iloc[idx][target_col]})

        # Process in chunks to avoid API limits
        for i in range(0, len(refinement_entries), context_size):
            chunk_entries = refinement_entries[i:i+context_size]
            chunk_indices = refinement_indices[i:i+context_size]
            chunk_source_texts = original_source_texts[i:i+context_size]
            chunk_initial_translations = initial_translations[i:i+context_size]

            # Calculate progress
            processed = i
            progress = (processed / len(refinement_entries)) * \
                100 if refinement_entries else 100

            # Display progress
            sys.stdout.write(
                f"\rRefinement Progress: {progress:.1f}% ({processed}/{len(refinement_entries)})")
            sys.stdout.flush()

            try:
                # Refine the translations, providing both Japanese source and initial English translation
                refined_translations = translate_dialog_context(
                    chunk_entries,
                    is_refinement=True,
                    initial_translations=chunk_initial_translations,
                    source_texts=chunk_source_texts  # Pass original Japanese text for reference
                )

                # Update dataframe with refined translations
                for idx, result in zip(chunk_indices, refined_translations):
                    refined = result.get("translation", "")
                    if refined:
                        working_df.iloc[idx, working_df.columns.get_loc(
                            refined_col)] = refined
                        refinement_stats["successful_entries"] += 1
                        stats["successful_refinements"] += 1
                    else:
                        refinement_stats["failed_entries"] += 1
                        stats["failed_refinements"] += 1

                refinement_stats["processed_entries"] += len(chunk_entries)
                refinement_stats["context_blocks"] += 1

                # Save progress periodically
                if refinement_stats["context_blocks"] % SAVE_EVERY == 0:
                    if max_rows is not None or start_row > 0:
                        for idx, row in working_df.iterrows():
                            df_idx = idx + start_row
                            if df_idx < len(df):
                                df.at[df_idx, target_col] = row[target_col]
                                if two_step:
                                    df.at[df_idx, refined_col] = row[refined_col]
                        df.to_csv(checkpoint_file, index=False)
                    else:
                        working_df.to_csv(checkpoint_file, index=False)

                    print(
                        f"\nRefinement checkpoint saved ({processed}/{len(refinement_entries)} entries processed)")

                # Small delay to avoid rate limits
                time.sleep(0.1)

            except Exception as e:
                print(
                    f"\nError processing refinement chunk {i}-{i+len(chunk_entries)}: {e}")
                # Save current progress
                if max_rows is not None or start_row > 0:
                    for idx, row in working_df.iterrows():
                        df_idx = idx + start_row
                        if df_idx < len(df):
                            df.at[df_idx, target_col] = row[target_col]
                            if two_step:
                                df.at[df_idx, refined_col] = row[refined_col]
                    df.to_csv(checkpoint_file, index=False)
                else:
                    working_df.to_csv(checkpoint_file, index=False)

                print(f"Progress saved to {checkpoint_file}")

    # Final save
    # Now merge our working_df back into the original if we used row limits
    final_df = df.copy()
    if max_rows is not None or start_row > 0:
        for idx, row in working_df.iterrows():
            df_idx = idx + start_row
            if df_idx < len(final_df):
                final_df.at[df_idx, target_col] = row[target_col]
                if two_step and refined_col in working_df.columns:
                    final_df.at[df_idx, refined_col] = row[refined_col]
    else:
        final_df = working_df.copy()

    # Save final result
    final_df.to_csv(output_file, index=False)

    # Final stats
    elapsed = time.time() - start_time
    minutes = int(elapsed / 60)
    seconds = int(elapsed % 60)

    print(f"\n\nTranslation complete!")
    print(f"Time taken: {minutes}m {seconds}s")

    if max_rows is not None or start_row > 0:
        print(
            f"Processed rows {start_row} to {start_row + len(working_df) - 1} (out of {original_row_count} total rows)")

    print(f"Successful translations: {stats['successful_entries']}")
    print(f"Failed translations: {stats['failed_entries']}")
    if two_step:
        print(f"Successful refinements: {stats['successful_refinements']}")
        print(f"Failed refinements: {stats['failed_refinements']}")
    print(f"Output saved to: {output_file}")

    return True


def main():
    parser = argparse.ArgumentParser(
        description="Translate game dialog from Japanese to English")
    parser.add_argument("--input", "-i", required=True,
                        help="Input CSV file path")
    parser.add_argument(
        "--output", "-o", help="Output CSV file path (optional)")
    parser.add_argument("--source", "-s", default="Japanese",
                        help="Source column name (default: Japanese)")
    parser.add_argument("--target", "-t", default="English",
                        help="Target column name (default: English)")
    parser.add_argument("--rows", type=int,
                        help="Maximum number of rows to translate")
    parser.add_argument("--start", type=int, default=0,
                        help="Row number to start from (default: 0)")
    parser.add_argument("--refined", "-r", default="Refined",
                        help="Refined translation column name (default: Refined)")
    parser.add_argument("--context", "-c", type=int,
                        help="Number of entries to process in one context")
    parser.add_argument("--one-step", action="store_true",
                        help="Use one-step translation instead of two-step")
    parser.add_argument("--model", type=str,
                        help="Override model specified in config")

    args = parser.parse_args()

    # Override model if specified
    if args.model:
        config['model'] = args.model
        print(f"Using model: {args.model}")

    translate_csv_file(
        args.input,
        args.output,
        args.source,
        args.target,
        args.rows,
        args.refined,
        args.context,
        two_step=not args.one_step,
        start_row=args.start
    )


if __name__ == "__main__":
    main()
