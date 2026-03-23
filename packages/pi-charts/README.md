# @walterra/pi-charts

Vega-Lite chart extension for [pi coding agent](https://github.com/badlogic/pi-mono) - render data visualizations as inline terminal images.

## Installation

```bash
pi install npm:@walterra/pi-charts
```

This installs the package globally and adds it to your pi settings.

## Compatibility

- Tested with `pi` **0.62.0**

## Features

- **Declarative Visualizations**: Use Vega-Lite JSON specs to describe charts
- **Auto Dependencies**: Python, altair, pandas, vl-convert auto-installed via `uv`
- **Inline Display**: Charts render directly in terminals supporting inline images (Ghostty, Kitty, iTerm2, WezTerm)
- **Save to File**: Optionally save charts to PNG files

## Tool: `vega_chart`

Renders a Vega-Lite specification as a PNG image.

### Parameters

| Parameter   | Type   | Required | Description                                   |
| ----------- | ------ | -------- | --------------------------------------------- |
| `spec`      | string | ✅       | Vega-Lite JSON specification                  |
| `tsv_data`  | string |          | Optional TSV data to replace spec.data.values |
| `width`     | number |          | Chart width in pixels (default: 600)          |
| `height`    | number |          | Chart height in pixels (default: 400)         |
| `save_path` | string |          | Optional file path to save the PNG            |

### Example

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {
    "values": [
      { "category": "A", "value": 28 },
      { "category": "B", "value": 55 },
      { "category": "C", "value": 43 }
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": { "field": "category", "type": "nominal" },
    "y": { "field": "value", "type": "quantitative" }
  }
}
```

## Reference Documentation

See [vega-lite-reference.md](./extensions/vega-chart/vega-lite-reference.md) for documentation on:

- Data types and encoding channels
- All mark types and properties
- Common pitfalls to avoid
- Professional chart patterns
- Theming and best practices

## License

MIT
