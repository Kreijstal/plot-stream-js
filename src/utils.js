/**
 * Utility functions for StreamingChart.
 */

// Basic color cycling using D3's schemeCategory10
// We need d3 passed in to access its scale functions.
function createColorScale(d3) {
    if (!d3 || !d3.scaleOrdinal || !d3.schemeCategory10) {
        throw new Error("Valid D3 object with scaleOrdinal and schemeCategory10 is required.");
    }
    return d3.scaleOrdinal(d3.schemeCategory10);
}

// Function to get color, ensuring consistent assignment
function getColorForSeries(colorScale, seriesId) {
    if (!colorScale) {
        throw new Error("Color scale must be initialized before getting a color.");
    }
    return colorScale(seriesId);
}

module.exports = {
    createColorScale,
    getColorForSeries
};