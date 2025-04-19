/**
 * Main entry point for the StreamingChart library (CommonJS).
 * Requires D3.js (v7) to be passed in.
 */

// Require the main chart class implementation
const { StreamingChart: StreamingChartImpl } = require('./src/chart');

/**
 * Factory function to create the StreamingChart class.
 * @param {object} d3 - The D3 library instance (v7 required).
 * @returns {{StreamingChart: StreamingChart}} - An object containing the StreamingChart class constructor.
 * @throws {Error} If d3 is not provided.
 */
module.exports = function(d3) {
  if (!d3) {
    throw new Error("D3 library (v7 required) must be provided.");
  }

  // Return the class, effectively injecting the d3 dependency via the constructor
  // when the user calls `new StreamingChart(...)`.
  return {
    StreamingChart: class StreamingChart extends StreamingChartImpl {
        constructor(targetElement, initialConfig = {}) {
            // Pass d3 along with other arguments to the implementation's constructor
            super(d3, targetElement, initialConfig);
        }
    }
  };
};