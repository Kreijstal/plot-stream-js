/**
 * D3 Zoom and Pan handling for StreamingChart.
 */

/**
 * Initializes the D3 zoom behavior.
 * @param {object} d3 - The D3 library object.
 * @param {number} width - The chart drawing area width.
 * @param {number} height - The chart drawing area height.
 * @param {function} onZoom - The callback function to execute when a zoom event occurs.
 * @returns {object} - The configured D3 zoom behavior instance.
 */
function initializeZoom(d3, width, height, onZoom) {
    const zoomBehavior = d3.zoom()
        .scaleExtent([0.1, 100]) // Zoom limits
        .extent([[0, 0], [width, height]])
        .on("zoom", onZoom); // Attach the handler passed from the chart instance

    return zoomBehavior;
}

/**
 * Applies the zoom behavior to the target overlay element.
 * @param {object} zoomOverlay - The D3 selection of the zoom overlay rectangle.
 * @param {object} zoomBehavior - The configured D3 zoom behavior instance.
 * @param {boolean} enableZoom - Whether zooming is currently enabled.
 */
function applyZoomBehavior(zoomOverlay, zoomBehavior, enableZoom) {
    if (enableZoom) {
        zoomOverlay
            .call(zoomBehavior)
            .on("dblclick.zoom", null) // Disable double-click reset
            .on("mousedown.zoom", null) // Disable drag to pan
            .on("touchstart.zoom", null); // Disable touch to pan
    } else {
        zoomOverlay.on(".zoom", null); // Detach zoom behavior
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
        zoomBehavior
            .extent([[0, 0], [width, height]]);
    }
}

/**
 * Handles the zoom event, updating scales and triggering redraws.
 * This function now ONLY handles wheel/scroll events for zooming.
 * @param {object} event - The D3 zoom event object.
 * @param {object} d3 - The D3 library object.
 * @param {object} config - The chart configuration.
 * @param {object} scales - Object containing xScale and yScale.
 * @param {function} getFullXDomain - Function to get the full X data extent.
 * @param {function} getFullYDomain - Function to get the full Y data extent.
 * @param {function} redrawAxesAndGrid - Function to redraw axes and grid.
 * @param {function} redrawLines - Function to redraw data lines.
 * @param {object} previousTransform - The previous D3 zoom transform state.
 * @returns {object} - The new zoom transform state.
 */
function handleZoom(event, d3, config, scales, getFullXDomain, getFullYDomain, redrawAxesAndGrid, redrawLines, previousTransform) {
    if (!previousTransform) previousTransform = d3.zoomIdentity;
    if (!config.interactions.zoom) return previousTransform;

    const currentTransform = event.transform;
    const sourceEvent = event.sourceEvent;

    // Only process wheel events for zooming
    if (sourceEvent && sourceEvent.type === 'wheel') {
        if (config.interactions.zoom) {
            const fullX = getFullXDomain();
            const fullY = getFullYDomain();

            // Apply zoom transform
            const newXScale = currentTransform.rescaleX(scales.xScale.copy().domain(fullX));
            const newYScale = currentTransform.rescaleY(scales.yScale.copy().domain(fullY));

            // Update the actual scales
            scales.xScale.domain(newXScale.domain());
            scales.yScale.domain(newYScale.domain());

            // Redraw
            redrawAxesAndGrid();
            redrawLines();

            return currentTransform;
        }
    }

    // For any other event type, maintain previous state
    return previousTransform;
}

module.exports = {
    initializeZoom,
    applyZoomBehavior,
    updateZoomExtents,
    handleZoom
};