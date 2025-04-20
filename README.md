# plot-stream-js

[![License: AGPL-3](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
<!-- Add other badges if applicable (NPM version, build status, etc.) -->
<!-- [![NPM Version](https://img.shields.io/npm/v/plot-stream-js.svg)](https://www.npmjs.com/package/plot-stream-js) -->

A JavaScript library for plotting real-time, streaming data efficiently using D3.js (v7). Designed for scenarios where data arrives continuously and needs to be visualized with low latency and interactive features like zooming and panning.

**Note:** This library requires D3.js v7 as a **peer dependency**. You must install D3 alongside this library.

## Features

*   **Real-time Data Plotting:** Optimized for handling continuously arriving data points.
*   **D3.js Powered:** Leverages the flexibility and power of D3.js v7 for scales, axes, and rendering.
*   **Dynamic Updates:** Update chart and series configurations on the fly.
*   **Data Pruning:** Automatically limits the number of data points stored per series (`maxDataPointsPerSeries`) to manage memory usage.

## Installation

You need Node.js and npm (or yarn) installed.

Since `d3` is a peer dependency, you need to install it explicitly in your project along with `plot-stream-js`.

```bash
npm install d3 https://github.com/Kreijstal/plot-stream-js.git
# or
yarn add d3 https://github.com/Kreijstal/plot-stream-js.git
```

## Basic Usage

Here's how to set up a basic streaming chart:

1.  **HTML:** Create a container element for the chart.
    ```html
    <!DOCTYPE html>
    <html>
    <head>
        <title>Plot Stream JS Example</title>
        <style>
            #chart-container {
                width: 800px;
                height: 400px;
                border: 1px solid #ccc;
            }
        </style>
    </head>
    <body>
        <div id="chart-container"></div>
        <!-- Load D3 and your bundled JS file -->
        <script src="https://d3js.org/d3.v7.min.js"></script>
        <script src="your-bundle.js"></script>
    </body>
    </html>
    ```

2.  **JavaScript (`your-bundle.js` or equivalent):**

    ```javascript
    // 1. Load Libraries
    // Assuming D3 is loaded globally or imported via a module system
    // const d3 = require('d3'); // If using Node/CommonJS modules directly
    const createStreamingChart = require('plot-stream-js'); // Import the factory

    // 2. Get the StreamingChart class (injecting D3)
    // Check if d3 is available (globally or imported)
    if (typeof d3 === 'undefined') {
      throw new Error("D3.js (v7) is required and was not found.");
    }
    const { StreamingChart } = createStreamingChart(d3);

    // 3. Prepare a Container
    const container = document.getElementById('chart-container');

    if (!container) {
        console.error("Chart container element not found!");
    } else {
        // 4. Configure the Chart
        const chartConfig = {
            xAxis: {
                label: "Time (s)",
                // range: { min: 0, max: 10 }, // Optional fixed range
                maxTrackX: 20, // Show the last 20 seconds when following
                minDomainWidth: 0.1, // Min zoom level X
            },
            yAxis: {
                label: "Value",
                // range: { min: -1.5, max: 1.5 }, // Optional fixed range
                minDomainHeight: 0.1 // Min zoom level Y
            },
            series: {
                // Pre-define series styles
                signalA: { label: "Signal A", color: "steelblue", lineWidth: 2 },
                signalB: { label: "Signal B", color: "darkorange", lineWidth: 1.5 }
            },
            legend: {
                visible: true,
                position: "top-right" // "top-left", "top-right", "bottom-left", "bottom-right"
            },
            interactions: {
                zoom: true, // Enable scroll/pinch zoom (combined X/Y)
                pan: true   // Enable drag panning
                // Independent zoom: Alt+Scroll (Y), Shift+Scroll (X)
            },
            maxDataPointsPerSeries: 1000, // Keep the latest 1000 points per series
            debug: false // Set to true for console logs
        };

        // 5. Initialize the Chart
        const chart = new StreamingChart(container, chartConfig);

        // 6. Stream Data (Example using setInterval)
        let time = 0;
        const intervalId = setInterval(() => {
            time += 0.1;
            const valueA = Math.sin(time) + (Math.random() - 0.5) * 0.2;
            const valueB = Math.cos(time * 0.5) + (Math.random() - 0.5) * 0.1;

            // Format data: { seriesId: { x: [x1, x2,...], y: [y1, y2,...] } }
            const newData = {
                signalA: { x: [time], y: [valueA] },
                signalB: { x: [time], y: [valueB] }
            };

            // Add data to the chart
            chart.addData(newData);

            // Example: Stop after 60 seconds
            if (time > 60) {
                clearInterval(intervalId);
                console.log("Data stream stopped.");
                // Consider calling chart.destroy() here if the chart is permanently done
            }
        }, 100); // Add data every 100ms

        // 7. Cleanup (IMPORTANT!)
        // In a real application (like a SPA), ensure you call destroy when the
        // component unmounts or the chart is removed from the DOM.
        // This prevents memory leaks from observers and event listeners.
        // Example (conceptual):
        // someComponentFramework.onUnmount(() => {
        //    clearInterval(intervalId); // Stop data source
        //    chart.destroy();
        // });

        // For simple scripts, you might tie it to window unload:
        window.addEventListener('beforeunload', () => {
           clearInterval(intervalId);
           if (chart && !chart.isDestroyed) { // Check if destroy hasn't been called
              chart.destroy();
           }
        });
    }
    ```

## API Documentation

Key public methods of the `StreamingChart` instance:

*   **`constructor(targetElement: HTMLElement | undefined, initialConfig: object = {})`**
    *   Creates a new chart instance.
    *   `targetElement`: The DOM element to render the chart into. If `undefined`, the chart runs in headless mode (no rendering).
    *   `initialConfig`: An optional configuration object. Merged with defaults.

*   **`addData(data: object)`**
    *   Adds new data points to the chart.
    *   `data`: An object where keys are `seriesId`s and values are objects `{ x: number[], y: number[] }`.
    *   Example: `chart.addData({ series1: { x: [1, 2], y: [10, 11] }, series2: { x: [1.5], y: [5] } })`

*   **`setView(view: object, options: object = {})`**
    *   Programmatically sets the visible domain (viewport) of the chart. Turns "Follow" mode OFF.
    *   `view`: An object specifying the desired domain:
        *   `xMin`: Minimum X value.
        *   `xMax`: Maximum X value.
        *   `yMin`: Minimum Y value. If `null` or `undefined` (along with `yMax`), Y-axis auto-scales based on data within the `[xMin, xMax]` range.
        *   `yMax`: Maximum Y value. If `null` or `undefined` (along with `yMin`), Y-axis auto-scales.
    *   `options`: Currently unused placeholder.

*   **`resetView(options: object = {})`**
    *   Resets the chart view to the default state: enables "Follow" mode and auto-scales axes based on current data and configuration (`maxTrackX`, axis ranges).
    *   `options`: Currently unused placeholder.

*   **`clearData()`**
    *   Removes all data points from all series in the chart.

*   **`updateSeriesConfig(seriesId: string, config: object)`**
    *   Updates the configuration for a specific series (e.g., `color`, `lineWidth`, `label`).
    *   `seriesId`: The ID of the series to update.
    *   `config`: An object containing the configuration properties to merge.

*   **`updateChartConfig(config: object)`**
    *   Updates the main chart configuration. Merges the provided `config` object with the current configuration. Handles updates to axes, legend, interactions, etc.
    *   `config`: An object containing the configuration properties to merge. Can include a nested `series` object to update multiple series configs at once.

*   **`redraw()`**
    *   Forces a complete redraw of the chart based on the current data, configuration, and view state. Usually called internally, but can be used manually if needed after complex state changes.

*   **`destroy()`**
    *   Cleans up the chart instance. Removes the SVG element, detaches event listeners and the resize observer. **Essential for preventing memory leaks in dynamic applications.**

## Configuration

The chart can be configured via the `initialConfig` object passed to the constructor or updated later using `updateChartConfig`. Key options include:

*   `xAxis`, `yAxis`:
    *   `label`: Axis title (string).
    *   `range`: `{ min: number | null, max: number | null }`. Sets fixed axis limits. Use `null` for auto-scaling.
    *   `showGridLines`: `boolean` (default: `true`).
    *   `maxTrackX`: `number` (default: `Infinity`). For `xAxis` only. Maximum time duration (in X units) to display when "Follow" mode is active.
    *   `minDomainWidth`/`minDomainHeight`: `number`. Minimum allowed span for the axis when zooming.
    *   `maxDomainWidth`/`maxDomainHeight`: `number`. Maximum allowed span for the axis when zooming.
*   `series`: An object where keys are `seriesId`s and values are configuration objects:
    *   `label`: Legend label (string, defaults to `seriesId`).
    *   `color`: Line color (string, e.g., 'red', '#ff0000', defaults to D3 category10).
    *   `lineWidth`: Line thickness (number, default: `1.5`).
*   `legend`:
    *   `visible`: `boolean` (default: `true`).
    *   `position`: `'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'` (default: `'top-right'`).
*   `interactions`:
    *   `zoom`: `boolean` (default: `true`). Enables standard zoom/pinch.
    *   `pan`: `boolean` (default: `true`). Enables drag-to-pan.
*   `maxDataPointsPerSeries`: `number` (default: `1000`). Maximum points to keep per series. Older points are discarded.
*   `debug`: `boolean` (default: `false`). Enables verbose logging to the console.

Refer to `src/config.js` for the full default configuration structure.

## Development

1.  Clone the repository:
    ```bash
    git clone https://github.com/Kreijstal/plot-stream-js.git
    cd plot-stream-js
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See the [LICENSE](https://www.gnu.org/licenses/agpl-3.0.en.html) file or website for details. This means if you use this library in a network service, you generally must make the source code available.

## Acknowledgements

*   Built using the powerful [D3.js](https://d3js.org/) library.
