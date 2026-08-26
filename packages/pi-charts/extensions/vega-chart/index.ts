/**
 * Vega-Lite Chart Extension
 *
 * Renders Vega-Lite specifications as PNG images in terminals that support
 * inline images (Ghostty, Kitty, iTerm2, WezTerm).
 *
 * Philosophy (inspired by Bostock & Heer):
 * - Declarative: The agent constructs a Vega-Lite JSON spec
 * - Composable: Full control over marks, encodings, scales, layers
 * - Data-driven: Inline data or separate TSV input
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// Compute reference path using ESM import.meta.url
const VEGA_REFERENCE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'vega-lite-reference.md');

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'vega_chart',
    label: 'Vega-Lite Chart',
    description: `Render a Vega-Lite specification as a PNG image.

Dependencies are auto-installed via uv (Python package manager):
- uv itself is auto-installed if missing
- Python 3, altair, pandas, vl-convert-python are managed by uv
If setup fails, the tool returns installation instructions - do NOT fall back to ASCII charts.

IMPORTANT: Before using this tool, read the complete reference documentation at:
${VEGA_REFERENCE_PATH}

The reference contains critical information about:
- Data types (N, O, Q, T) and encoding channels
- All mark types and their properties
- Common pitfalls (dot-notation fields, label truncation, facet issues)
- Professional chart patterns with complete working examples
- Theming and best practices

Pass a complete Vega-Lite JSON spec. The agent has full control over:
- Mark types: bar, line, point, area, rect, arc, rule, text, boxplot, etc.
- Encodings: x, y, color, size, shape, opacity, row, column, etc.
- Scales: linear, log, sqrt, pow, time, utc, ordinal, band, point
- Aggregations: count, sum, mean, median, min, max, distinct, etc.
- Transforms: filter, calculate, aggregate, fold, pivot, window, etc.
- Composition: layer, hconcat, vconcat, facet, repeat

Data can be inline in the spec (values) or passed separately as TSV.

Example spec structure:
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": { "values": [...] },
  "mark": "bar",
  "encoding": {
    "x": { "field": "category", "type": "nominal" },
    "y": { "field": "value", "type": "quantitative" }
  }
}

Reference: https://vega.github.io/vega-lite/docs/`,
    promptSnippet: 'Render Vega-Lite JSON specs as PNG charts from inline data or TSV.',
    parameters: Type.Object({
      spec: Type.String({
        description:
          'Vega-Lite JSON specification (complete spec with $schema, data, mark, encoding)',
      }),
      tsv_data: Type.Optional(
        Type.String({
          description: 'Optional TSV data - if provided, replaces spec.data.values',
        })
      ),
      width: Type.Optional(Type.Number({ description: 'Chart width in pixels (default: 600)' })),
      height: Type.Optional(Type.Number({ description: 'Chart height in pixels (default: 400)' })),
      save_path: Type.Optional(
        Type.String({
          description: 'Optional file path to save the PNG chart (in addition to displaying it)',
        })
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const {
        spec,
        tsv_data,
        width = 600,
        height = 400,
        save_path,
      } = params as {
        spec: string;
        tsv_data?: string;
        width?: number;
        height?: number;
        save_path?: string;
      };

      if (signal?.aborted) {
        return { content: [{ type: 'text', text: 'Cancelled' }], details: {} };
      }

      const getErrorMessage = (err: unknown): string => {
        if (err instanceof Error) return err.message;
        if (typeof err === 'string') return err;
        if (err && typeof err === 'object' && 'message' in err) {
          return String((err as { message?: unknown }).message);
        }
        return 'Unknown error';
      };

      const getErrorStderr = (err: unknown): string | undefined => {
        if (err && typeof err === 'object' && 'stderr' in err) {
          const stderr = (err as { stderr?: unknown }).stderr;
          return typeof stderr === 'string' ? stderr : undefined;
        }
        return undefined;
      };

      try {
        const findUvExecutable = (): string | undefined => {
          try {
            const locator = process.platform === 'win32' ? 'where.exe' : 'which';
            const located = execFileSync(locator, ['uv'], { encoding: 'utf-8' })
              .split(/\r?\n/)
              .find(Boolean);
            if (located) return located.trim();
          } catch {
            // Fall through to installer default locations.
          }

          const home = process.env.USERPROFILE ?? process.env.HOME;
          const executable = process.platform === 'win32' ? 'uv.exe' : 'uv';
          const candidates = [
            home ? join(home, '.local', 'bin', executable) : undefined,
            home ? join(home, '.cargo', 'bin', executable) : undefined,
            process.platform === 'win32' && process.env.LOCALAPPDATA
              ? join(process.env.LOCALAPPDATA, 'Programs', 'uv', executable)
              : undefined,
            process.platform !== 'win32' ? '/usr/local/bin/uv' : undefined,
          ];
          return candidates.find((candidate): candidate is string =>
            Boolean(candidate && existsSync(candidate))
          );
        };

        // Check Python and dependencies, auto-install if needed using uv.
        const ensureDependencies = (): { uvExecutable?: string; error?: string } => {
          let uvExecutable = findUvExecutable();
          if (!uvExecutable) {
            try {
              if (process.platform === 'win32') {
                execFileSync(
                  'powershell.exe',
                  [
                    '-NoProfile',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-Command',
                    'irm https://astral.sh/uv/install.ps1 | iex',
                  ],
                  { encoding: 'utf-8', stdio: 'inherit' }
                );
              } else {
                execSync('curl -LsSf https://astral.sh/uv/install.sh | sh', {
                  encoding: 'utf-8',
                  stdio: 'inherit',
                });
              }
              uvExecutable = findUvExecutable();
            } catch {
              // Report the actionable installation error below.
            }
          }

          if (!uvExecutable) {
            const installCommand =
              process.platform === 'win32'
                ? 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
                : 'curl -LsSf https://astral.sh/uv/install.sh | sh';
            return {
              error: `uv (Python package manager) not found and auto-install failed.\nPlease install uv: ${installCommand}`,
            };
          }

          try {
            execFileSync(
              uvExecutable,
              [
                'run',
                '--with',
                'altair',
                '--with',
                'pandas',
                '--with',
                'vl-convert-python',
                'python',
                '-c',
                'import altair; import pandas; import vl_convert',
              ],
              { encoding: 'utf-8', stdio: 'pipe' }
            );
            return { uvExecutable };
          } catch (err: unknown) {
            const errorMsg = getErrorMessage(err);
            return {
              error: `Failed to setup Python environment with uv.\nPlease run manually: uv run --with altair --with pandas --with vl-convert-python python\n\nError: ${errorMsg}`,
            };
          }
        };

        const deps = ensureDependencies();
        if (!deps.uvExecutable) {
          const errorText = deps.error ?? 'Dependencies not installed';
          return {
            content: [{ type: 'text', text: errorText }],
            details: { error: 'Dependencies not installed' },
            isError: true,
          };
        }

        // Parse and validate the spec
        type VegaSpec = {
          $schema?: string;
          width?: number;
          height?: number;
          data?: { values?: unknown[] };
          [key: string]: unknown;
        };

        let vegaSpec: VegaSpec;
        try {
          const parsed = JSON.parse(spec);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Spec must be a JSON object');
          }
          vegaSpec = parsed as VegaSpec;
        } catch (e) {
          return {
            content: [{ type: 'text', text: `Invalid JSON in spec: ${getErrorMessage(e)}` }],
            details: { error: 'Invalid JSON' },
            isError: true,
          };
        }

        // Add schema if missing
        if (!vegaSpec.$schema) {
          vegaSpec.$schema = 'https://vega.github.io/schema/vega-lite/v5.json';
        }

        // Set dimensions if not specified
        if (!vegaSpec.width) vegaSpec.width = width;
        if (!vegaSpec.height) vegaSpec.height = height;

        const tmpNonce = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
        const tmpSpec = join(tmpdir(), `vega-spec-${tmpNonce}.json`);
        const tmpTsv = join(tmpdir(), `vega-data-${tmpNonce}.tsv`);
        const tmpPng = join(tmpdir(), `vega-chart-${tmpNonce}.png`);
        const tmpScript = join(tmpdir(), `vega-render-${tmpNonce}.py`);

        // If TSV data provided, we'll load it in Python
        if (tsv_data) {
          writeFileSync(tmpTsv, tsv_data);
        }

        writeFileSync(tmpSpec, JSON.stringify(vegaSpec, null, 2));

        // Python script to render with Altair
        const pythonScript = `
import altair as alt
import pandas as pd
import json

import sys

# Paths are passed as arguments to avoid shell and source-code quoting issues.
spec_path, output_path, tsv_path = sys.argv[1:4]

# Load the Vega-Lite spec
with open(spec_path, 'r') as f:
    spec = json.load(f)

# If TSV data provided, load it and inject into spec
tsv_path = tsv_path or None
if tsv_path:
    df = pd.read_csv(tsv_path, sep='\\t')
    # Convert DataFrame to list of dicts for Vega-Lite
    spec['data'] = {'values': df.to_dict(orient='records')}

# Create chart from spec
chart = alt.Chart.from_dict(spec)

# Save as PNG with retina scale
chart.save(output_path, scale_factor=2)
print('OK')
`;
        writeFileSync(tmpScript, pythonScript);

        const result = execFileSync(
          deps.uvExecutable,
          [
            'run',
            '--with',
            'altair',
            '--with',
            'pandas',
            '--with',
            'vl-convert-python',
            'python',
            tmpScript,
            tmpSpec,
            tmpPng,
            tsv_data ? tmpTsv : '',
          ],
          {
            encoding: 'utf-8',
            timeout: 60000, // Longer timeout for first run when uv downloads packages
            maxBuffer: 10 * 1024 * 1024,
          }
        );

        if (!result.includes('OK')) {
          throw new Error('Chart generation failed');
        }

        // Read the PNG file as base64
        const pngBuffer = readFileSync(tmpPng);
        const base64Data = pngBuffer.toString('base64');

        // If save_path provided, copy the PNG to that location
        let savedPath: string | undefined;
        if (save_path) {
          const { copyFileSync, mkdirSync } = await import('node:fs');
          const { dirname } = await import('node:path');
          try {
            // Ensure directory exists
            mkdirSync(dirname(save_path), { recursive: true });
            copyFileSync(tmpPng, save_path);
            savedPath = save_path;
          } catch (saveErr: unknown) {
            // Don't fail the whole operation, just note the error
            console.error(`Failed to save to ${save_path}: ${getErrorMessage(saveErr)}`);
          }
        }

        // Clean up temp files
        try {
          unlinkSync(tmpSpec);
        } catch {}
        try {
          unlinkSync(tmpTsv);
        } catch {}
        try {
          unlinkSync(tmpPng);
        } catch {}
        try {
          unlinkSync(tmpScript);
        } catch {}

        const dataPoints = tsv_data
          ? tsv_data.trim().split('\n').length - 1
          : Array.isArray(vegaSpec.data?.values)
            ? vegaSpec.data?.values.length
            : 0;

        const textMsg = savedPath
          ? `Rendered Vega-Lite chart (${dataPoints} data points) - saved to ${savedPath}`
          : `Rendered Vega-Lite chart (${dataPoints} data points)`;

        return {
          content: [
            { type: 'image', data: base64Data, mimeType: 'image/png' },
            { type: 'text', text: textMsg },
          ],
          details: { dataPoints, width: vegaSpec.width, height: vegaSpec.height, savedPath },
        };
      } catch (error: unknown) {
        // Try to extract Python error details
        const errorMsg = getErrorStderr(error) ?? getErrorMessage(error);
        return {
          content: [{ type: 'text', text: `Error rendering chart: ${errorMsg}` }],
          details: { error: errorMsg },
          isError: true,
        };
      }
    },
  });
}
