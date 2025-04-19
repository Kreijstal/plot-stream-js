/**
 * D3 Zoom and Pan handling for StreamingChart.
 */

/**
 * Initializes the D3 zoom behavior.
 * @param {object} d3 - The D3 library object.
 * @param {number} width - The chart drawing area width.
 * @param {number} height - The chart drawing area height.
 * @param {function} onZoomStart - Callback for zoom start.
 * @param {function} onZoom - Callback during zoom/pan.
 * @param {function} onZoomEnd - Callback for zoom end.
 * @returns {object} - The configured D3 zoom behavior instance.
 */
function initializeZoom(d3, width, height, onZoomStart, onZoom, onZoomEnd) {
    const zoomBehavior = d3.zoom()
        .scaleExtent([0.01, 500]) // Wider zoom limits for "infinite" feel
        .extent([[0, 0], [width, height]])
        // Keep double-click zoom disabled unless specifically needed
        .on("start.zoom", onZoomStart) // Attach start handler
        .on("zoom", onZoom)         // Attach the main handler
        .on("end.zoom", onZoomEnd);   // Attach end handler

    return zoomBehavior;
}

/**
 * Applies the zoom behavior to the target overlay element.
 * @param {object} zoomOverlay - The D3 selection of the zoom overlay rectangle.
 * @param {object} zoomBehavior - The configured D3 zoom behavior instance.
 * @param {boolean} enableZoom - Whether zooming is currently enabled.
 * @param {boolean} enablePan - Whether panning is currently enabled.
 */
function applyZoomBehavior(zoomOverlay, zoomBehavior, enableZoom, enablePan) {
    if (enableZoom || enablePan) {
        zoomOverlay.call(zoomBehavior);
        // Conditionally disable zoom or pan if needed (more complex)
        // For now, if either is enabled, enable the whole behavior.
        // We can filter events in the handler if necessary.
        zoomOverlay.style("cursor", enablePan ? "grab" : "default"); // Set cursor based on pan
        zoomOverlay.on("dblclick.zoom", null); // Keep double-click zoom disabled
    } else {
        zoomOverlay.on(".zoom", null); // Detach all zoom behavior listeners
        zoomOverlay.style("cursor", "default");
    }
}

/**
 * Updates the zoom behavior's extents when the chart resizes.
 * @param {object} zoomBehavior - The D3 zoom behavior instance.
 * @param {number} width - The new chart drawing area width.
 * @param {number} height - The new chart drawing area height.
 */
function updateZoomExtents(zoomBehavior, width, height) {
    if (zoomBehavior) {
        zoomBehavior.extent([[0, 0], [width, height]]);
    }
}

/**
 * Handles the zoom/pan event, updating scales and triggering redraws.
 * This function now applies the transform directly to the *current* scales.
 * @param {object} event - The D3 zoom event object.
 * @param {object} scales - Object containing the *current* xScale and yScale.
 * @param {object} initialScales - Object containing copies of the scales *before* the current zoom gesture started.
 * @param {function} redrawAxesAndGrid - Function to redraw axes and grid.
 * @param {function} redrawLines - Function to redraw data lines.
 */
function handleZoom(event, scales, initialScales, redrawAxesAndGrid, redrawLines) {
    const transform = event.transform;

    // Rescale the initial scales based on the current transform
    // This correctly handles both zoom (relative to pointer) and pan
    scales.xScale = transform.rescaleX(initialScales.xScale);
    scales.yScale = transform.rescaleY(initialScales.yScale);

    // Redraw components based on the new scales
    redrawAxesAndGrid();
    redrawLines();

    // No need to return transform, the chart instance gets it from the event
}

module.exports = {
    initializeZoom,
    applyZoomBehavior,
    updateZoomExtents,
    handleZoom
};